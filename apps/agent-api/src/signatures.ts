// Extract function signatures from the "copy panel context" code blob (ADR-009).
//
// The Code panel hands the model flattened verified Solidity - routinely 100k+
// tokens. Rather than ship whole sources, we parse the function/constructor
// declarations and prompt with just those; the model pulls individual bodies
// on demand via the get_function_code tool. Parsing is best-effort and
// intentionally simple (regex + brace matching over comment-stripped source):
// anything it misses degrades to "not listed", never to a crash.

export interface FunctionEntry {
  /** contract/interface/library the declaration lives in, if determinable */
  contract: string | null;
  /** function name, or "constructor" / "fallback" / "receive" */
  name: string;
  /** the full declaration up to (but not including) the body or `;` */
  signature: string;
  /** function body source, if a `{ … }` block was found (used by the lookup tool) */
  body: string | null;
}

/** Strip // line and /* … *\/ block comments without touching string content. */
export function stripComments(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const next = source[i + 1];
    // string / char literals - copy verbatim so `//` inside them survives
    if (c === '"' || c === "'") {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        out += source[i];
        if (source[i] === "\\") {
          out += source[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const CONTAINER_RE = /\b(?:contract|interface|library)\s+([A-Za-z_]\w*)/g;

/** Map every character offset to the name of the container it sits inside. */
function buildContainerMap(source: string): (offset: number) => string | null {
  interface Scope {
    name: string;
    start: number;
    end: number;
  }
  const scopes: Scope[] = [];
  CONTAINER_RE.lastIndex = 0;
  for (let match = CONTAINER_RE.exec(source); match !== null; match = CONTAINER_RE.exec(source)) {
    const name = match[1] as string;
    // find the opening brace of this container, then its matching close
    const open = source.indexOf("{", match.index);
    if (open === -1) continue;
    const end = matchBrace(source, open);
    scopes.push({ name, start: open, end: end === -1 ? source.length : end });
  }
  return (offset: number) => {
    // innermost containing scope wins
    let best: Scope | undefined;
    for (const s of scopes) {
      if (offset >= s.start && offset <= s.end) {
        if (!best || s.start > best.start) best = s;
      }
    }
    return best?.name ?? null;
  };
}

/** Given the index of an opening brace, return the index of its match, or -1. */
function matchBrace(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// function foo(...) ... , constructor(...) ... , plus the argument-less
// fallback()/receive() forms. We capture the keyword+name and the parameter
// list start; the rest of the declaration is scanned up to `{` or `;`.
const FN_RE = /\b(function\s+([A-Za-z_]\w*)|constructor|fallback|receive)\s*\(/g;

export function parseFunctionSignatures(source: string): FunctionEntry[] {
  const clean = stripComments(source);
  const containerAt = buildContainerMap(clean);
  const entries: FunctionEntry[] = [];
  const seen = new Set<string>();

  FN_RE.lastIndex = 0;
  for (let match = FN_RE.exec(clean); match !== null; match = FN_RE.exec(clean)) {
    const keyword = match[1] as string;
    const name = match[2] ?? keyword; // constructor/fallback/receive
    const parenOpen = match.index + match[0].length - 1;
    const parenClose = matchParen(clean, parenOpen);
    if (parenClose === -1) continue;

    // scan modifiers/returns after the params up to the body or terminator
    let end = parenClose + 1;
    while (end < clean.length && clean[end] !== "{" && clean[end] !== ";") end++;

    const signature = clean.slice(match.index, end).replace(/\s+/g, " ").trim();
    let body: string | null = null;
    if (clean[end] === "{") {
      const bodyEnd = matchBrace(clean, end);
      if (bodyEnd !== -1) body = clean.slice(end, bodyEnd + 1);
    }

    const contract = containerAt(match.index);
    // dedupe identical (contract, signature) pairs from flattening duplicates
    const key = `${contract ?? ""}::${signature}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push({ contract, name, signature, body });
  }
  return entries;
}

/** Index of the matching `)` for the `(` at `open`, or -1. */
function matchParen(source: string, open: number): number {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Compact signature listing for the prompt, grouped by container. */
export function formatSignatureList(entries: FunctionEntry[]): string {
  if (entries.length === 0) return "(no function declarations found)";
  const byContainer = new Map<string, FunctionEntry[]>();
  for (const e of entries) {
    const key = e.contract ?? "(top level)";
    const list = byContainer.get(key) ?? [];
    list.push(e);
    byContainer.set(key, list);
  }
  const blocks: string[] = [];
  for (const [container, list] of byContainer) {
    const lines = list.map((e) => `  ${e.signature}`).join("\n");
    blocks.push(`${container}:\n${lines}`);
  }
  return blocks.join("\n\n");
}

/**
 * Look up a function's body from parsed entries. Matches by name, optionally
 * scoped to a contract. Returns the body if the declaration had one, else the
 * signature alone (interfaces/abstract functions). null when not found.
 */
export function lookupFunction(
  entries: FunctionEntry[],
  name: string,
  contract?: string,
): string | null {
  const wanted = name.toLowerCase();
  const scope = contract?.toLowerCase();
  const matches = entries.filter((e) => {
    if (e.name.toLowerCase() !== wanted) return false;
    if (scope && (e.contract?.toLowerCase() ?? "") !== scope) return false;
    return true;
  });
  if (matches.length === 0) return null;
  return matches
    .map((e) => {
      const header = e.contract ? `// ${e.contract}` : "";
      return `${header}\n${e.signature}${e.body ? ` ${e.body}` : ";"}`.trim();
    })
    .join("\n\n");
}
