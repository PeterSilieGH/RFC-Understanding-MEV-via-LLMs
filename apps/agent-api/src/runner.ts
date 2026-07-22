// Embeds the pi SDK: one in-memory session per analysis run. Tools are opt-in:
// get_function_code (when parsed source was submitted — the model pulls
// individual function bodies from that source instead of us shipping whole
// contracts) and, for Analyze/Discovery runs, a bounded READ-ONLY foundry `cast` tool
// (ADR-013 §8 — the one filesystem/subprocess exception to the ADR-006/009 "no
// bash tools" rule; strictly allowlisted read subcommands via execFile, never a
// shell). No arbitrary filesystem or bash access otherwise.
//
// Base config (auth + model selection) is sourced from pi's agent dir
// (~/.pi/agent by default, or $PI_CODING_AGENT_DIR): no model or API key is
// baked into this service. The project `.pi/` supplements it — `.pi/SYSTEM.md`
// overrides the system prompt, `.pi/AGENTS.md` and `.pi/skills/` load as usual.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
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
import { loadConfig } from "@mev/config";
import { Type } from "typebox";
import { type ProviderPermit, RunScheduler } from "./scheduler.js";
import { type FunctionEntry, lookupFunction } from "./signatures.js";

const execFileAsync = promisify(execFile);

// Mirrors @earendil-works/pi-agent-core's ThinkingLevel (not re-exported by the
// coding-agent package we depend on). setThinkingLevel clamps to the model's
// real capability, so requesting a level a model can't do degrades to "off".
export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type RunEvent =
  | { type: "delta"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool"; name: string; detail: string }
  | { type: "queued" }
  | { type: "flagged"; addresses: string[] }
  | { type: "done"; report: string; transcript: string }
  | { type: "usage"; tokens: number | null; contextWindow: number; percent: number | null }
  | {
      type: "subagent";
      candidateId: string;
      phase: "queued" | "started" | "cache-hit" | "bundle" | "done" | "error";
      detail?: string;
    }
  | { type: "error"; message: string };

export interface ContractAnalysisToolResult {
  status: "bundle" | "cached" | "unresolved" | "budget_exhausted" | "error";
  candidateId: string;
  bundle?: unknown;
  message?: string;
}

export interface ChildAnalysisRunner {
  run(
    request: RunRequest,
    emit?: (event: RunEvent) => void,
    signal?: AbortSignal,
  ): Promise<{
    report: string;
    transcript: string;
  }>;
}

export interface ContractAnalysisToolConfig {
  /** Candidate ids are server-issued opaque ids. The tool cannot supply an address/kind/code. */
  candidateIds: ReadonlySet<string>;
  analyze(
    candidateId: string,
    child: ChildAnalysisRunner,
  ): Promise<ContractAnalysisToolResult>;
}

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
  /** ADR-012 Discovery session cache key. A stable key keeps the live pi
   * session between turns; changing the bundle/model fingerprint starts a new
   * one so stale context is never served. */
  persistentKey?: string;
  /** Used only when a persistent session must be created/rehydrated. */
  rehydrationPrompt?: string;
  /** Kind-specific Discovery framing appended to the shared project system
   * prompt. Persistent cache keys must distinguish different suffixes. */
  systemPromptSuffix?: string;
  /** Exact system profile. Unlike suffixes, this deliberately does not load the
   * repository MEV SYSTEM.md (used by vulnerability-first Discovery). */
  systemPromptOverride?: string;
  /** Requested reasoning level (ADR-013 §6). Clamped to model capability by the
   * harness; reasoning surfaces as `reasoning` events. Omit to use the default. */
  thinkingLevel?: ThinkingLevel;
  /** Offer the bounded read-only foundry `cast` tool (ADR-013 §8). */
  enableCast?: boolean;
  /** One-level, server-authorized lazy contract analysis for Discovery. */
  contractAnalysis?: ContractAnalysisToolConfig;
}

type PiSession = Awaited<ReturnType<typeof createAgentSession>>["session"];
interface TurnContext {
  request: RunRequest;
  emit: (event: RunEvent) => void;
  signal: AbortSignal;
  permit: ProviderPermit;
  toolLog: string[];
}

interface SessionHolder {
  session: PiSession;
  current?: TurnContext;
}

const persistentSessions = new Map<string, SessionHolder>();
const MAX_PERSISTENT_SESSIONS = 24;

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

// Bound process-wide model pressure. Independent ephemeral runs may overlap;
// turns for one persistent Discovery session remain strictly ordered.
const scheduler = new RunScheduler(loadConfig().AGENT_MAX_CONCURRENCY);

export function runAnalysis(
  req: RunRequest,
  emit: (event: RunEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  return scheduler.run(
    req.persistentKey,
    (permit) => (signal.aborted ? Promise.resolve() : execute(req, emit, signal, permit)),
    () => emit({ type: "queued" }),
  );
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
  permit: ProviderPermit,
): Promise<void> {
  const cached = req.persistentKey ? persistentSessions.get(req.persistentKey) : undefined;
  if (cached) {
    await runSessionTurn(cached, req.prompt, req, emit, signal, permit, false);
    return;
  }
  const { authStorage, modelRegistry, settingsManager, cwd, agentDir } = await loadPiConfig();
  const systemPrompt = req.systemPromptOverride ?? loadSystemPrompt(cwd, agentDir);
  const effectiveSystemPrompt = req.systemPromptOverride
    ? req.systemPromptOverride
    : [systemPrompt, req.systemPromptSuffix].filter(Boolean).join("\n\n");

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

  const holder = {} as SessionHolder;
  const current = (): TurnContext | undefined => holder.current;
  const toolNames: string[] = [];
  const customTools = [];
  if (req.entries) {
    toolNames.push("get_function_code");
    customTools.push(
      buildCodeLookupTool(() => current()?.request.entries ?? [], (detail) => {
        const turn = current();
        turn?.toolLog.push(detail);
        turn?.emit({ type: "tool", name: "get_function_code", detail });
      }),
    );
  }
  if (req.collectImportant) {
    toolNames.push("flag_important_nodes");
    customTools.push(
      buildFlagImportantTool((addresses) => {
        const turn = current();
        turn?.toolLog.push(`flagged ${addresses.length} important node(s)`);
        turn?.emit({
          type: "tool",
          name: "flag_important_nodes",
          detail: "recorded important nodes",
        });
        turn?.emit({ type: "flagged", addresses });
      }),
    );
  }
  if (req.enableCast) {
    toolNames.push("cast");
    customTools.push(
      buildCastTool((detail) => {
        const turn = current();
        turn?.toolLog.push(detail);
        turn?.emit({ type: "tool", name: "cast", detail });
      }),
    );
  }
  if (req.contractAnalysis) {
    toolNames.push("request_contract_analysis");
    customTools.push(buildContractAnalysisTool(current));
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
    systemPromptOverride: effectiveSystemPrompt ? () => effectiveSystemPrompt : undefined,
  });
  await loader.reload({ resolveProjectTrust: async () => true });
  // loader.reload() rebuilds settings from files; re-apply our runtime tweaks.
  settingsManager.applyOverrides({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 2 },
  });

  let session: PiSession;
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

  // ADR-013 §6: request reasoning where the model supports it (clamped by the
  // harness). Only meaningful on session creation; cached persistent sessions
  // keep the level set on their first turn.
  if (req.thinkingLevel) {
    try {
      session.setThinkingLevel(req.thinkingLevel);
    } catch {
      // model without adjustable thinking — leave the default
    }
  }

  if (req.persistentKey) {
    holder.session = session;
    persistentSessions.set(req.persistentKey, holder);
    while (persistentSessions.size > MAX_PERSISTENT_SESSIONS) {
      const oldest = persistentSessions.keys().next().value as string | undefined;
      if (!oldest) break;
      persistentSessions.get(oldest)?.session.dispose();
      persistentSessions.delete(oldest);
    }
  } else {
    holder.session = session;
  }

  await runSessionTurn(
    holder,
    req.rehydrationPrompt ?? req.prompt,
    req,
    emit,
    signal,
    permit,
    !req.persistentKey,
  );
}

async function runSessionTurn(
  holder: SessionHolder,
  prompt: string,
  req: RunRequest,
  emit: (event: RunEvent) => void,
  signal: AbortSignal,
  permit: ProviderPermit,
  dispose: boolean,
): Promise<void> {
  const session = holder.session;
  const toolLog: string[] = [];
  holder.current = { request: req, emit, signal, permit, toolLog };
  let report = "";
  const unsubscribe = session.subscribe((event) => {
    if (event.type !== "message_update") return;
    const inner = event.assistantMessageEvent;
    if (inner.type === "text_delta") {
      report += inner.delta;
      emit({ type: "delta", text: inner.delta });
    } else if (inner.type === "thinking_delta") {
      // ADR-013 §6: reasoning is display-only — streamed but not folded into the
      // report/transcript or the durable session turns.
      emit({ type: "reasoning", text: inner.delta });
    }
  });

  const onAbort = () => void session.abort();
  signal.addEventListener("abort", onAbort);

  try {
    await session.prompt(prompt);
    // A provider call can fail mid-turn without throwing — the harness records
    // it on state.errorMessage and ends the turn with no text. Surface that
    // instead of emitting an empty, misleading "done".
    const assistantError = session.agent.state.errorMessage;
    if (!report.trim() && assistantError) {
      emit({ type: "error", message: assistantError });
    } else {
      const transcript = buildTranscript(req.transcriptHeader, toolLog, report);
      emit({ type: "done", report: report.trim(), transcript });
      const usage = session.getContextUsage();
      if (usage) emit({ type: "usage", ...usage });
    }
  } catch (err) {
    emit({ type: "error", message: (err as Error).message });
  } finally {
    signal.removeEventListener("abort", onAbort);
    unsubscribe();
    holder.current = undefined;
    if (dispose) session.dispose();
  }
}

function buildCodeLookupTool(
  getEntries: () => FunctionEntry[],
  onLookup: (detail: string) => void,
) {
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
      const entries = getEntries();
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

function buildContractAnalysisTool(getTurn: () => TurnContext | undefined) {
  return defineTool({
    name: "request_contract_analysis",
    label: "Request contract analysis",
    description:
      "Request one compact, reusable analysis bundle for a selected unresolved contract " +
      "candidate. Pass only the opaque candidateId from the incident catalog. The server " +
      "chooses the research profile and evidence; addresses, source, kind, and focus text " +
      "cannot be supplied by this tool.",
    parameters: Type.Object(
      {
        candidateId: Type.String({ description: "Opaque id from the selected candidate catalog" }),
      },
      { additionalProperties: false },
    ),
    execute: async (_id, params) => {
      const turn = getTurn();
      const config = turn?.request.contractAnalysis;
      if (!turn || !config) {
        return toolText({
          status: "error",
          candidateId: params.candidateId,
          message: "contract analysis is not available for this turn",
        } satisfies ContractAnalysisToolResult);
      }
      if (!config.candidateIds.has(params.candidateId)) {
        turn.emit({
          type: "subagent",
          candidateId: params.candidateId,
          phase: "error",
          detail: "candidate is not selected or authorized",
        });
        return toolText({
          status: "error",
          candidateId: params.candidateId,
          message: "candidate is not selected or authorized for this Discovery turn",
        } satisfies ContractAnalysisToolResult);
      }

      turn.emit({ type: "subagent", candidateId: params.candidateId, phase: "started" });
      turn.toolLog.push(`requested contract analysis ${params.candidateId}`);
      const child: ChildAnalysisRunner = {
        run: async (request, onEvent = () => {}, childSignal) => {
          let report = "";
          let transcript = "";
          let failure: string | undefined;
          // The parent model is paused while its tool runs. Reuse its permit so
          // AGENT_MAX_CONCURRENCY=1 remains live and total provider pressure does
          // not increase. Strip recursive/stateful tools from reusable children.
          const signal = childSignal
            ? AbortSignal.any([turn.signal, childSignal])
            : turn.signal;
          await turn.permit.runChild(() =>
            execute(
              {
                ...request,
                persistentKey: undefined,
                rehydrationPrompt: undefined,
                contractAnalysis: undefined,
                enableCast: false,
                collectImportant: false,
              },
              (event) => {
                onEvent(event);
                if (event.type === "done") {
                  report = event.report;
                  transcript = event.transcript;
                } else if (event.type === "error") {
                  failure = event.message;
                }
              },
              signal,
              turn.permit,
            ),
          );
          if (!report) throw new Error(failure ?? "child analysis returned no bundle");
          return { report, transcript };
        },
      };

      try {
        const result = await config.analyze(params.candidateId, child);
        turn.emit({
          type: "subagent",
          candidateId: params.candidateId,
          phase: result.status === "cached" ? "cache-hit" : result.status === "bundle" ? "bundle" : "done",
          detail: result.message,
        });
        turn.emit({ type: "subagent", candidateId: params.candidateId, phase: "done" });
        return toolText(result);
      } catch (error) {
        const message = (error as Error).message;
        turn.emit({
          type: "subagent",
          candidateId: params.candidateId,
          phase: "error",
          detail: message,
        });
        return toolText({
          status: "error",
          candidateId: params.candidateId,
          message,
        } satisfies ContractAnalysisToolResult);
      }
    },
  });
}

function toolText(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    details: {},
  };
}

// ADR-013 §8: bounded READ-ONLY foundry cast. Only these subcommands run; any
// state-changing / wallet / broadcast form (send, mktx, publish, rpc, wallet,
// import…) is rejected before spawning. execFile (never a shell) with an args
// array means there is no shell-injection surface.
const CAST_ALLOWED = new Set([
  "call",
  "storage",
  "balance",
  "code",
  "codesize",
  "4byte",
  "4byte-decode",
  "sig",
  "sig-event",
  "tx",
  "receipt",
  "block",
  "block-number",
  "chain-id",
  "nonce",
  "age",
  "basefee",
  "gas-price",
  "to-dec",
  "to-hex",
  "keccak",
  "abi-decode",
  "decode-abi",
]);
// Resolved via PATH (spawn uses execvp): host has it at /usr/bin/cast, the
// agent-api image installs foundry to /usr/local/bin/cast. ENOENT (not on PATH)
// degrades to "cast unavailable".
const CAST_BIN = "cast";
const CAST_TIMEOUT_MS = 20_000;
const CAST_MAX_OUTPUT = 8192;

function buildCastTool(onCall: (detail: string) => void) {
  const config = loadConfig();
  return defineTool({
    name: "cast",
    label: "cast (read-only)",
    description:
      "Run a READ-ONLY foundry `cast` command against the configured mainnet RPC to " +
      "retrieve on-chain facts you cannot get from the supplied evidence — storage slots, " +
      "balances, eth_call results, code, token metadata, tx/receipt/block data. Pass the " +
      'cast arguments as a list, e.g. ["call","0xUniPair","getReserves()(uint112,uint112,uint32)"] ' +
      'or ["storage","0xToken","0x2"]. The --rpc-url is supplied automatically; do not add it. ' +
      "Only read subcommands are permitted; state-changing/wallet/broadcast commands are rejected. " +
      "Cite any fact you take from a cast result.",
    parameters: Type.Object({
      args: Type.Array(Type.String(), {
        description:
          "cast arguments, subcommand first (e.g. call/storage/balance/code/4byte/tx/block).",
      }),
    }),
    execute: async (_id, params) => {
      const args = params.args.filter((a) => typeof a === "string");
      const sub = args[0];
      if (!sub || !CAST_ALLOWED.has(sub)) {
        onCall(`rejected cast ${sub ?? "(none)"}`);
        return castResult(
          `Refused: "${sub ?? ""}" is not an allowed read-only cast subcommand. ` +
            `Allowed: ${[...CAST_ALLOWED].join(", ")}.`,
        );
      }
      const env: NodeJS.ProcessEnv = { ...process.env, ETH_RPC_URL: config.RPC_URL };
      if (config.ETHERSCAN_API_KEY) env.ETHERSCAN_API_KEY = config.ETHERSCAN_API_KEY;
      try {
        const { stdout } = await execFileAsync(CAST_BIN, args, {
          env,
          timeout: CAST_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
        });
        onCall(`cast ${sub}`);
        return castResult(truncate(stdout.trim() || "(empty result)", CAST_MAX_OUTPUT));
      } catch (err) {
        const e = err as { code?: string; stderr?: string; message?: string };
        if (e.code === "ENOENT") {
          onCall("cast unavailable");
          return castResult(
            "cast is not available in this environment; rely on supplied material.",
          );
        }
        onCall(`cast ${sub} failed`);
        return castResult(
          `cast ${sub} failed: ${truncate((e.stderr || e.message || "unknown error").trim(), 1000)}`,
        );
      }
    },
  });
}

function castResult(text: string) {
  return { content: [{ type: "text" as const, text }], details: {} };
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
