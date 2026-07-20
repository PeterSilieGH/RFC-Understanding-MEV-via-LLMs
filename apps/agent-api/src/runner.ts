// Embeds the pi SDK: one in-memory session per analysis run, no filesystem or
// bash tools (ADR-006/009). The only tool offered is get_function_code, and
// only when parsed source was submitted — the model pulls individual function
// bodies from that source instead of us shipping whole contracts.
//
// Base config (auth + model selection) is sourced from pi's agent dir
// (~/.pi/agent by default, or $PI_CODING_AGENT_DIR): no model or API key is
// baked into this service. The project `.pi/` supplements it — `.pi/SYSTEM.md`
// overrides the system prompt, `.pi/AGENTS.md` and `.pi/skills/` load as usual.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AuthStorage,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
  createAgentSession,
  defineTool,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type FunctionEntry, lookupFunction } from "./signatures.js";

export type RunEvent =
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; detail: string }
  | { type: "queued" }
  | { type: "flagged"; addresses: string[] }
  | { type: "done"; report: string; transcript: string }
  | { type: "error"; message: string };

export interface RunRequest {
  /** initial user prompt (task instructions + context + question) */
  prompt: string;
  /** parsed source enabling the get_function_code tool; omit to disable it */
  entries?: FunctionEntry[];
  /** compact-transcript header lines describing what was submitted */
  transcriptHeader: string[];
  /** explicit model override (from the top-bar picker); omit to use the
   * settings default (project .pi/settings.json over the global one). */
  model?: { provider: string; id: string };
  /** enable the flag_important_nodes tool (build-verdict only): the model
   * reports addresses it deems important but not yet analyzed (ADR-009). */
  collectImportant?: boolean;
}

/** 20-byte hex address, lowercased. Drops anything that isn't one. */
function normalizeAddressList(addresses: unknown): string[] {
  if (!Array.isArray(addresses)) return [];
  const out = new Set<string>();
  for (const a of addresses) {
    if (typeof a !== "string") continue;
    const plain = a.replace(/^[a-z]+:/i, "").toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(plain)) out.add(plain);
  }
  return [...out];
}

/** Shared pi config: auth + model registry from the agent dir, and a
 * settings manager with the project `.pi/settings.json` reliably merged in
 * (trust is forced on — the container's cwd is never in the host trust.json,
 * so without this the project default model / settings would be ignored). */
export async function loadPiConfig(): Promise<{
  authStorage: ReturnType<typeof AuthStorage.create>;
  modelRegistry: ReturnType<typeof ModelRegistry.create>;
  settingsManager: ReturnType<typeof SettingsManager.create>;
  cwd: string;
  agentDir: string;
}> {
  const authStorage = AuthStorage.create();
  const modelRegistry = ModelRegistry.create(authStorage);
  const cwd = process.cwd();
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir);
  settingsManager.setProjectTrusted(true);
  await settingsManager.reload();
  return { authStorage, modelRegistry, settingsManager, cwd, agentDir };
}

// Serialize runs process-wide: bound the load on the model API and keep memory
// flat (same reasoning as trace-api's discovery queue). A second request emits
// a "queued" event through the stream while it waits.
let queue: Promise<void> = Promise.resolve();
let pending = 0;

export function runAnalysis(
  req: RunRequest,
  emit: (event: RunEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const alreadyBusy = pending > 0;
  pending++;
  if (alreadyBusy) emit({ type: "queued" });
  const run = queue.then(() => execute(req, emit, signal));
  queue = run
    .catch(() => {})
    .finally(() => {
      pending--;
    });
  return run;
}

/** `.pi/SYSTEM.md` from cwd, falling back to the agent dir. Undefined = keep
 * pi's built-in prompt. Read explicitly (not via trust-gated discovery) so it
 * applies regardless of the container's project-trust state. */
function loadSystemPrompt(cwd: string, agentDir: string): string | undefined {
  for (const path of [join(cwd, ".pi", "SYSTEM.md"), join(agentDir, "SYSTEM.md")]) {
    try {
      return readFileSync(path, "utf8");
    } catch {
      // not present here - try the next location
    }
  }
  return undefined;
}

async function execute(
  req: RunRequest,
  emit: (event: RunEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const { authStorage, modelRegistry, settingsManager, cwd, agentDir } = await loadPiConfig();
  const systemPrompt = loadSystemPrompt(cwd, agentDir);

  // Explicit model override from the top-bar picker. When absent,
  // createAgentSession resolves the settings default (project .pi/settings.json
  // over global) via findInitialModel — nothing is baked into the code.
  let model: ReturnType<typeof modelRegistry.find> | undefined;
  if (req.model) {
    model = modelRegistry.find(req.model.provider, req.model.id);
    if (!model) {
      emit({
        type: "error",
        message: `model not available: ${req.model.provider}/${req.model.id}`,
      });
      return;
    }
  }

  const toolLog: string[] = [];
  const toolNames: string[] = [];
  const customTools = [];
  if (req.entries) {
    toolNames.push("get_function_code");
    customTools.push(
      buildCodeLookupTool(req.entries, (detail) => {
        toolLog.push(detail);
        emit({ type: "tool", name: "get_function_code", detail });
      }),
    );
  }
  if (req.collectImportant) {
    toolNames.push("flag_important_nodes");
    customTools.push(
      buildFlagImportantTool((addresses) => {
        toolLog.push(`flagged ${addresses.length} important node(s)`);
        emit({ type: "tool", name: "flag_important_nodes", detail: "recorded important nodes" });
        emit({ type: "flagged", addresses });
      }),
    );
  }

  // Supplement the base config with the project's .pi resources: SYSTEM.md
  // overrides the prompt, AGENTS.md and skills/ load through discovery. Share
  // the trusted settingsManager and force project trust so the project .pi
  // (skills, AGENTS.md, settings.json) loads reliably in the container, whose
  // cwd is never in the host trust.json.
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir,
    settingsManager,
    noExtensions: true, // only our custom tool; no surprise project extensions
    systemPromptOverride: systemPrompt ? () => systemPrompt : undefined,
  });
  await loader.reload({ resolveProjectTrust: async () => true });
  // loader.reload() rebuilds settings from files; re-apply our runtime tweaks.
  settingsManager.applyOverrides({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 2 },
  });

  let session: Awaited<ReturnType<typeof createAgentSession>>["session"];
  let modelFallbackMessage: string | undefined;
  try {
    ({ session, modelFallbackMessage } = await createAgentSession({
      cwd,
      agentDir,
      model,
      authStorage,
      modelRegistry,
      resourceLoader: loader,
      tools: toolNames,
      customTools,
      sessionManager: SessionManager.inMemory(),
      settingsManager,
    }));
  } catch (err) {
    emit({ type: "error", message: `could not start agent session: ${(err as Error).message}` });
    return;
  }
  if (!session.model) {
    emit({
      type: "error",
      message:
        modelFallbackMessage ?? "no model available — configure one with `pi` in the agent dir",
    });
    return;
  }

  let report = "";
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      report += event.assistantMessageEvent.delta;
      emit({ type: "delta", text: event.assistantMessageEvent.delta });
    }
  });

  const onAbort = () => void session.abort();
  signal.addEventListener("abort", onAbort);

  try {
    await session.prompt(req.prompt);
    // A provider call can fail mid-turn without throwing — the harness records
    // it on state.errorMessage and ends the turn with no text. Surface that
    // instead of emitting an empty, misleading "done".
    const assistantError = session.agent.state.errorMessage;
    if (!report.trim() && assistantError) {
      emit({ type: "error", message: assistantError });
    } else {
      const transcript = buildTranscript(req.transcriptHeader, toolLog, report);
      emit({ type: "done", report: report.trim(), transcript });
    }
  } catch (err) {
    emit({ type: "error", message: (err as Error).message });
  } finally {
    signal.removeEventListener("abort", onAbort);
    unsubscribe();
    session.dispose();
  }
}

function buildCodeLookupTool(entries: FunctionEntry[], onLookup: (detail: string) => void) {
  return defineTool({
    name: "get_function_code",
    label: "Get function code",
    description:
      "Return the source of a function from the contracts under review. " +
      "Provide the function name; optionally the contract name to disambiguate. " +
      "Use this to inspect a function you saw in the signature list.",
    parameters: Type.Object({
      name: Type.String({ description: "Function name (or constructor/fallback/receive)" }),
      contract: Type.Optional(
        Type.String({ description: "Contract/interface/library name to scope the lookup" }),
      ),
    }),
    execute: async (_id, params) => {
      const found = lookupFunction(entries, params.name, params.contract);
      const label = params.contract ? `${params.contract}.${params.name}` : params.name;
      onLookup(found ? `looked up ${label}` : `missed ${label}`);
      return {
        content: [
          {
            type: "text",
            text:
              found ??
              `No function named "${params.name}"${
                params.contract ? ` in ${params.contract}` : ""
              } was found in the submitted source.`,
          },
        ],
        details: {},
      };
    },
  });
}

function buildFlagImportantTool(onFlag: (addresses: string[]) => void) {
  return defineTool({
    name: "flag_important_nodes",
    label: "Flag important nodes",
    description:
      "Record the contract addresses from the trace tree that are important to " +
      "understanding this incident but have NOT yet been analyzed (they are not in " +
      "the 'already analyzed' list). Call once, with all such addresses. These get " +
      "an 'important' marker in the graph so the user knows what to analyze next.",
    parameters: Type.Object({
      addresses: Type.Array(Type.String(), {
        description: "Contract addresses (0x…) that warrant analysis but are not yet analyzed",
      }),
    }),
    execute: async (_id, params) => {
      const addresses = normalizeAddressList(params.addresses);
      onFlag(addresses);
      return {
        content: [
          {
            type: "text",
            text:
              addresses.length > 0
                ? `Recorded ${addresses.length} important node(s): ${addresses.join(", ")}`
                : "No valid addresses recorded.",
          },
        ],
        details: {},
      };
    },
  });
}

const MAX_TRANSCRIPT_REPORT = 4000;

/**
 * Compact transcript built programmatically (no second LLM pass): what was
 * offered, which lookups the model made, and a capped copy of the report.
 * Stored, never displayed — build-preview consumes it (ADR-009).
 */
function buildTranscript(header: string[], toolLog: string[], report: string): string {
  const parts = [...header];
  if (toolLog.length > 0) {
    parts.push("", "Function lookups:", ...toolLog.map((l) => `- ${l}`));
  }
  parts.push("", "Report:", truncate(report.trim(), MAX_TRANSCRIPT_REPORT));
  return parts.join("\n");
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n…[truncated]`;
}
