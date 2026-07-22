import { createHash } from "node:crypto";
// agent-api: pi-harness analysis skills for the disco Analyze panel (ADR-009).
import { loadConfig } from "@mev/config";
import { getProvider } from "@mev/rpc";
import { ethers } from "ethers";
import express from "express";
import {
  type BundleContractInput,
  buildBundlePrompt,
  bundleText,
  contractCodehash,
  estimateTokens,
  parseGeneratedBundles,
} from "./bundles.js";
import { listModels } from "./models.js";
import { type RunEvent, runAnalysis } from "./runner.js";
import { formatSignatureList, parseFunctionSignatures } from "./signatures.js";
import { SKILLS } from "./skills.js";
import {
  type ContractBundle,
  type ResearchKind,
  type SessionTurn,
  addBundleAddress,
  getBundles,
  getSession,
  latestVerdict,
  listAnalyzeTranscripts,
  listRuns,
  saveBundle,
  saveRun,
  saveSession,
} from "./store.js";
import {
  ANALYZE_CODE_TASK,
  ANALYZE_VALUE_TASK,
  BUILD_PREVIEW_TASK,
  VERDICT_CHAT_TASK,
} from "./tasks.js";

const config = loadConfig();
const app = express();
app.use(express.json({ limit: "8mb" })); // flattened source context can be large

app.get("/health", (_req, res) => {
  res.send("OK");
});

app.get("/api/agent/skills", (_req, res) => {
  res.json({ skills: SKILLS });
});

// Available models + the settings default, for the top-bar picker.
app.get("/api/agent/models", async (_req, res) => {
  try {
    res.json(await listModels());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

function pickKinds(value: unknown): ResearchKind[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(value.filter((kind): kind is ResearchKind => kind === "mev" || kind === "vuln")),
  ];
}

function pickContracts(value: unknown): BundleContractInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const c = item as Record<string, unknown>;
    if (typeof c.address !== "string" || typeof c.codeContext !== "string" || !c.codeContext.trim())
      return [];
    return [
      {
        address: c.address,
        name: typeof c.name === "string" ? c.name : undefined,
        codehash: typeof c.codehash === "string" ? c.codehash : undefined,
        codeContext: c.codeContext,
        valueContext: typeof c.valueContext === "string" ? c.valueContext : undefined,
      },
    ];
  });
}

type ModelRef = { provider: string; id: string } | undefined;

const bundlePreparations = new Map<string, Promise<void>>();

async function generateContractBundles(input: {
  project: string;
  identity: { contract: BundleContractInput; codehash: string };
  missing: ResearchKind[];
  targetBundleTokens: number;
  gas?: string;
  model: ModelRef;
  emit: (event: RunEvent) => void;
  signal: AbortSignal;
}): Promise<void> {
  const { project, identity, missing, targetBundleTokens, gas, model, emit, signal } = input;
  let report = "";
  let analysisError: string | undefined;
  await runAnalysis(
    {
      prompt: buildBundlePrompt(identity.contract, missing, targetBundleTokens, gas),
      entries: parseFunctionSignatures(identity.contract.codeContext),
      transcriptHeader: [
        "Skill: autonomous-bundle",
        `Target: ${identity.contract.address}`,
        `Kinds: ${missing.join(", ")}`,
      ],
      enableCast: true,
      model,
    },
    (event) => {
      if (event.type === "done") report = event.report;
      else if (event.type === "error") analysisError = event.message;
      else if (event.type === "queued" || event.type === "tool") emit(event);
    },
    signal,
  );
  if (!report) throw new Error(analysisError ?? "analysis returned no bundle output");

  const generatedBundles = parseGeneratedBundles(report, missing);
  const runId = await saveRun({
    project,
    skill: "analyze-code",
    addresses: normalizeAddresses([identity.contract.address]),
    question: `ADR-012 bundle generation: ${missing.join(", ")}`,
    report,
    transcript: report.slice(0, 4000),
  });
  for (const generated of generatedBundles) {
    const text = [
      generated.role,
      generated.entryPoints.join(" "),
      generated.flowSummary,
      generated.notes,
    ].join("\n");
    await saveBundle({
      codehash: identity.codehash,
      kind: generated.kind,
      addresses: normalizeAddresses([identity.contract.address]),
      role: generated.role,
      entryPoints: generated.entryPoints,
      flowSummary: generated.flowSummary,
      notes: generated.notes,
      tokenEstimate: estimateTokens(text),
      provenanceRunId: runId,
    });
  }
}

async function ensureContractBundles(input: {
  project: string;
  identity: { contract: BundleContractInput; codehash: string };
  kinds: ResearchKind[];
  targetBundleTokens: number;
  gas?: string;
  model: ModelRef;
  emit: (event: RunEvent) => void;
  signal: AbortSignal;
}): Promise<ContractBundle[]> {
  const { identity, kinds, emit } = input;
  while (true) {
    const existing = await getBundles([identity.codehash], kinds);
    const missing = kinds.filter((kind) => !existing.some((bundle) => bundle.kind === kind));
    if (missing.length === 0) return existing;

    const active = bundlePreparations.get(identity.codehash);
    if (active) {
      emit({ type: "queued" });
      await active.catch(() => {});
      continue;
    }

    const preparation = generateContractBundles({ ...input, missing });
    bundlePreparations.set(identity.codehash, preparation);
    try {
      await preparation;
    } finally {
      if (bundlePreparations.get(identity.codehash) === preparation) {
        bundlePreparations.delete(identity.codehash);
      }
    }
  }
}

// Autonomous bundle preparation (ADR-012): candidates are the whole incident
// graph, not a manual node selection. Existing (codehash, kind) rows are reused;
// all missing active kinds for one contract are emitted by one model call.
app.post("/api/agent/bundles/prepare", async (req, res) => {
  const body = req.body as {
    project?: string;
    kinds?: unknown;
    contracts?: unknown;
    gas?: string;
    model?: unknown;
  };
  const project = body.project?.trim();
  const kinds = pickKinds(body.kinds);
  const contracts = pickContracts(body.contracts);
  const gas = typeof body.gas === "string" ? body.gas.trim() || undefined : undefined;
  if (!project || kinds.length === 0 || contracts.length === 0) {
    res
      .status(400)
      .json({ error: "project, active kinds, and contracts with verified code are required" });
    return;
  }
  const signal = abortSignalFor(req, res);
  startNdjson(res);
  try {
    const model = pickModel(body.model);
    const modelList = await listModels();
    const selectedModel = model ?? modelList.default ?? undefined;
    const contextWindow =
      modelList.models.find(
        (candidate) =>
          candidate.provider === selectedModel?.provider && candidate.id === selectedModel?.id,
      )?.contextWindow ?? 128_000;
    const identities = await Promise.all(
      contracts.map(async (contract) => ({
        contract,
        codehash: await resolveContractCodehash(contract),
      })),
    );
    // Reserve prompt/verdict room, then divide the reusable-context allowance
    // across every candidate kind. This is the pre-aggregation size probe that
    // nudges generation tighter for small-window models or large incidents.
    const targetBundleTokens = Math.max(
      160,
      Math.min(700, Math.floor((contextWindow * 0.65) / (identities.length * kinds.length))),
    );
    await Promise.all(
      identities.map(async (identity) => {
        try {
          const bundles = await ensureContractBundles({
            project,
            identity,
            kinds,
            targetBundleTokens,
            gas,
            model,
            emit: (event) => writeNdjson(res, event),
            signal,
          });
          for (let bundle of bundles) {
            const address = normalizeAddresses([identity.contract.address])[0];
            if (address && !bundle.addresses.includes(address)) {
              bundle = (await addBundleAddress(bundle.codehash, bundle.kind, address)) ?? bundle;
            }
            writeNdjson(res, { type: "bundle", bundle });
          }
        } catch (err) {
          writeNdjson(res, {
            type: "warning",
            address: identity.contract.address,
            message: (err as Error).message,
          });
        }
      }),
    );
    writeNdjson(res, { type: "prepared" });
  } catch (err) {
    writeNdjson(res, { type: "error", message: (err as Error).message });
  } finally {
    res.end();
  }
});

async function resolveContractCodehash(contract: BundleContractInput): Promise<string> {
  if (contract.codehash && /^0x[0-9a-f]{64}$/i.test(contract.codehash)) {
    return contract.codehash.toLowerCase();
  }
  const address = normalizeAddresses([contract.address])[0];
  if (address) {
    try {
      const runtimeCode = await getProvider().getCode(address);
      if (runtimeCode !== "0x") return ethers.keccak256(runtimeCode);
    } catch {
      // Discovery can still operate while the RPC is temporarily unavailable;
      // the canonical verified-source identity is deterministic and grounded.
    }
  }
  return contractCodehash(contract);
}

app.post("/api/agent/bundles", async (req, res) => {
  const body = req.body as { codehashes?: unknown; kinds?: unknown };
  const codehashes = Array.isArray(body.codehashes)
    ? body.codehashes.filter((x): x is string => typeof x === "string")
    : [];
  const kinds = pickKinds(body.kinds);
  res.json({ bundles: await getBundles(codehashes, kinds) });
});

// Agent-backed config/template enrichment for the Values pane (ADR-012 §6).
// The model proposes complete JSONC documents; disco-api remains the writer and
// schema validator, preserving its normal untracked-submodule workflow.
app.post("/api/agent/values/enrich", async (req, res) => {
  const body = req.body as {
    project?: string;
    address?: string;
    config?: string;
    template?: string;
    codeContext?: string;
    valueContext?: string;
    model?: unknown;
  };
  const project = body.project?.trim();
  const address = body.address?.trim();
  if (!project || !address || !body.config || !body.codeContext) {
    res.status(400).json({ error: "project, address, config, and verified code are required" });
    return;
  }
  const prompt = [
    "Improve the supplied discovery config JSONC documents for the Values pane.",
    "Return JSON only with keys config and template (template may be null). Each value is the complete edited JSONC document.",
    "Add comprehensive field/contract descriptions and grounded permissions. Use custom interact descriptions for direct permissions. Use act only for permission inheritance/forwarding. Keep template config keyed to code, never deployment state; put address-specific facts in config overrides. Never hardcode or assume a permission not proven by supplied code/state. Preserve comments, imports, schemas, handlers, and unrelated settings.",
    `Project: ${project}`,
    `Address: ${address}`,
    "",
    "Current config.jsonc:",
    body.config,
    ...(body.template ? ["", "Current template.jsonc:", body.template] : []),
    "",
    "Verified code:",
    body.codeContext,
    ...(body.valueContext ? ["", "Discovered state and ABI:", body.valueContext] : []),
  ].join("\n");
  startNdjson(res);
  let report = "";
  try {
    await runAnalysis(
      {
        prompt,
        entries: parseFunctionSignatures(body.codeContext),
        transcriptHeader: ["Skill: value-config-enrichment", `Target: ${address}`],
        model: pickModel(body.model),
      },
      (event) => {
        if (event.type === "done") report = event.report;
        else if (event.type !== "delta") writeNdjson(res, event);
      },
      abortSignalFor(req, res),
    );
    if (report) {
      const cleaned = report
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "");
      const value = JSON.parse(cleaned) as { config?: unknown; template?: unknown };
      if (
        typeof value.config !== "string" ||
        (value.template !== null &&
          value.template !== undefined &&
          typeof value.template !== "string")
      ) {
        throw new Error("value enrichment returned an invalid document payload");
      }
      const id = await saveRun({
        project,
        skill: "analyze-value",
        addresses: normalizeAddresses([address]),
        question: "ADR-012 value-pane config enrichment",
        report,
        transcript: report.slice(0, 4000),
      });
      writeNdjson(res, {
        type: "enrichment",
        id,
        config: value.config,
        template: value.template ?? null,
      });
    }
  } catch (err) {
    writeNdjson(res, { type: "error", message: (err as Error).message });
  } finally {
    res.end();
  }
});

// ADR-013 §8: each prompt invites the read-only foundry `cast` tool for facts
// the bundles/evidence lack, with the standard citation requirement.
const CAST_HINT =
  "You may call the read-only `cast` tool to retrieve on-chain facts the supplied bundles/evidence do not contain (storage slots, balances, eth_call results, code, token metadata); cite anything you use.";
const DISCOVERY_PROMPTS: Record<ResearchKind, string> = {
  mev: `You are conducting grounded MEV research. Explain ordering, value flow, extraction mechanism, affected parties, uncertainty, and supporting contract evidence. Do not provide an executable extraction bot. ${CAST_HINT}`,
  vuln: `You are conducting grounded smart-contract vulnerability research. Explain trust boundaries, reachable failure modes, impact, prerequisites, uncertainty, and supporting contract evidence. Do not claim an exploit without evidence. ${CAST_HINT}`,
};

function discoveryBase(
  kind: ResearchKind,
  bundles: ContractBundle[],
  traceTree: string,
  swaps: string,
  gas: string,
): string {
  return [
    DISCOVERY_PROMPTS[kind],
    "Use only the supplied bundles and incident evidence. Cite bundle addresses and entry points.",
    "",
    "Selected reusable contract bundles:",
    ...bundles.map((bundle, i) => `\n=== Bundle ${i + 1} ===\n${bundleText(bundle)}`),
    ...(traceTree ? ["", "Structural trace tree:", traceTree] : []),
    ...(swaps ? ["", "Decoded swaps:", swaps] : []),
    ...(gas ? ["", "Incident economics (gas & builder tip):", gas] : []),
  ].join("\n");
}

// Persistent, kind-parameterized Discovery verdict/chat. Durable turns rehydrate
// after restart; a live pi session is reused while its model + bundle fingerprint
// is unchanged. The client sends only the new question on follow-ups.
app.post("/api/agent/discovery", async (req, res) => {
  const body = req.body as {
    project?: string;
    incident?: string;
    kind?: unknown;
    codehashes?: unknown;
    question?: string;
    traceTree?: string;
    swaps?: string;
    gas?: string;
    model?: unknown;
    reset?: boolean;
  };
  const project = body.project?.trim();
  const incident = body.incident?.trim() || project;
  const kind = body.kind === "mev" || body.kind === "vuln" ? body.kind : undefined;
  const codehashes = Array.isArray(body.codehashes)
    ? body.codehashes.filter((x): x is string => typeof x === "string")
    : [];
  if (!project || !incident || !kind || codehashes.length === 0) {
    res.status(400).json({ error: "project, incident, kind, and selected bundles are required" });
    return;
  }
  const bundles = await getBundles(codehashes, [kind]);
  if (bundles.length === 0) {
    res.status(409).json({ error: `no selected ${kind} bundles are available` });
    return;
  }
  const model = pickModel(body.model);
  const base = discoveryBase(
    kind,
    bundles,
    body.traceTree?.trim() ?? "",
    body.swaps?.trim() ?? "",
    body.gas?.trim() ?? "",
  );
  const modelList = await listModels();
  const selectedModel = model ?? modelList.default ?? undefined;
  const contextWindow =
    modelList.models.find(
      (candidate) =>
        candidate.provider === selectedModel?.provider && candidate.id === selectedModel?.id,
    )?.contextWindow ?? 128_000;
  const inputTokens = estimateTokens(base);
  if (inputTokens > Math.floor(contextWindow * 0.85)) {
    res.status(413).json({
      error: `selected bundles consume ${inputTokens} of ${contextWindow} context tokens; deselect lower-relevance bundles`,
      inputTokens,
      contextWindow,
    });
    return;
  }
  const fingerprint = createHash("sha256")
    .update(JSON.stringify(bundles.map((b) => [b.codehash, b.updatedAt])))
    .digest("hex");
  const previous = await getSession(project, incident, kind);
  const compatible =
    previous &&
    !body.reset &&
    previous.bundleFingerprint === fingerprint &&
    previous.modelProvider === (model?.provider ?? null) &&
    previous.modelId === (model?.id ?? null);
  const turns: SessionTurn[] = compatible ? previous.turns : [];
  const question =
    body.question?.trim() ||
    (turns.length === 0
      ? `Produce the ${kind === "mev" ? "MEV" : "vulnerability"} Discovery verdict for this incident.`
      : "Reassess the verdict using the currently selected evidence.");
  const history = turns
    .map((turn) => `${turn.role === "user" ? "User" : "Assistant"}: ${turn.text}`)
    .join("\n\n");
  const rehydrationPrompt = [
    base,
    ...(history ? ["", "Durable conversation so far:", history] : []),
    "",
    `User: ${question}`,
  ].join("\n");
  const persistentKey = [
    project,
    incident,
    kind,
    fingerprint,
    model?.provider ?? "default",
    model?.id ?? "default",
  ].join(":");
  startNdjson(res);
  let report = "";
  try {
    await runAnalysis(
      {
        prompt: question,
        rehydrationPrompt,
        persistentKey,
        transcriptHeader: [`Discovery: ${kind}`, `Bundles: ${bundles.length}`],
        model,
        systemPromptSuffix: DISCOVERY_PROMPTS[kind],
        // ADR-013 §6/§8: stream reasoning and offer the read-only cast tool.
        thinkingLevel: "low",
        enableCast: true,
      },
      (event) => {
        if (event.type === "done") report = event.report;
        writeNdjson(res, event);
      },
      abortSignalFor(req, res),
    );
    if (report) {
      const saved = await saveSession({
        project,
        incident,
        kind,
        bundleFingerprint: fingerprint,
        modelProvider: model?.provider ?? null,
        modelId: model?.id ?? null,
        turns: compactSessionTurns([
          ...turns,
          { role: "user", text: question },
          { role: "assistant", text: report },
        ]),
      });
      writeNdjson(res, { type: "session", session: saved });
    }
  } catch (err) {
    writeNdjson(res, { type: "error", message: (err as Error).message });
  } finally {
    res.end();
  }
});

function compactSessionTurns(turns: SessionTurn[]): SessionTurn[] {
  const out: SessionTurn[] = [];
  let chars = 0;
  for (const turn of turns.slice(-24).reverse()) {
    if (chars + turn.text.length > 60_000 && out.length >= 2) break;
    out.push(turn);
    chars += turn.text.length;
  }
  return out.reverse();
}

app.get("/api/agent/discovery/session", async (req, res) => {
  const project = typeof req.query.project === "string" ? req.query.project : "";
  const incident = typeof req.query.incident === "string" ? req.query.incident : project;
  const kind = req.query.kind === "mev" || req.query.kind === "vuln" ? req.query.kind : undefined;
  if (!project || !kind)
    return void res.status(400).json({ error: "project and kind are required" });
  res.json({ session: await getSession(project, incident, kind) });
});

// Runs for a project, newest first; drives the node ticks and verdict display.
app.get("/api/agent/runs", async (req, res) => {
  const project = typeof req.query.project === "string" ? req.query.project : "";
  if (!project) {
    res.status(400).json({ error: "project query param required" });
    return;
  }
  try {
    const runs = await listRuns(project);
    const verdict = runs.find((r) => r.skill === "build-preview") ?? null;
    res.json({
      runs: runs.map((r) => ({
        id: r.id,
        skill: r.skill,
        addresses: r.addresses,
        createdAt: r.createdAt,
      })),
      verdict: verdict
        ? { id: verdict.id, report: verdict.report, createdAt: verdict.createdAt }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

interface AnalyzeBody {
  project?: string;
  skill?: string;
  addresses?: string[];
  question?: string;
  /** "copy panel context" text of the Code panel for the selected nodes */
  codeContext?: string;
  /** "copy panel context" text of the Values panel for the selected nodes */
  valueContext?: string;
  /** model override from the top-bar picker; omit for the settings default */
  model?: { provider: string; id: string };
}

/** Accept a model override only when both fields are present strings. */
function pickModel(model: unknown): { provider: string; id: string } | undefined {
  if (typeof model !== "object" || model === null) return undefined;
  const { provider, id } = model as Record<string, unknown>;
  if (typeof provider === "string" && typeof id === "string") return { provider, id };
  return undefined;
}

// NDJSON stream: one JSON RunEvent per line. fetch-readable (not EventSource:
// the context payload needs a request body). nginx disables buffering here.
app.post("/api/agent/analyze", async (req, res) => {
  const body = req.body as AnalyzeBody;
  const project = body.project?.trim();
  const skill = body.skill;
  if (!project || (skill !== "analyze-code" && skill !== "analyze-value")) {
    res.status(400).json({ error: "project and a valid analyze skill are required" });
    return;
  }

  const context = skill === "analyze-code" ? body.codeContext : body.valueContext;
  if (!context || context.trim().length === 0) {
    res.status(400).json({
      error:
        skill === "analyze-code"
          ? "no code context — select nodes with verified source"
          : "no value context — select nodes with discovered state",
    });
    return;
  }

  const addresses = normalizeAddresses(body.addresses ?? []);
  const question = body.question?.trim() || null;

  // analyze-code parses the code for signatures + the lookup tool. analyze-value
  // still enables lookups when code context was submitted alongside the state.
  const codeForLookup = skill === "analyze-code" ? context : body.codeContext;
  const entries = codeForLookup ? parseFunctionSignatures(codeForLookup) : [];

  const prompt = buildAnalyzePrompt(skill, context, entries.length > 0, question);
  const transcriptHeader = [
    `Skill: ${skill}`,
    `Targets: ${addresses.length > 0 ? addresses.join(", ") : "(unspecified)"}`,
    skill === "analyze-code"
      ? `Signatures offered: ${entries.length}`
      : `Value context: ${context.length} chars`,
    ...(question ? [`Question: ${question}`] : []),
  ];

  startNdjson(res);
  let finalReport = "";
  let finalTranscript = "";

  const emit = (event: RunEvent) => {
    if (event.type === "done") {
      finalReport = event.report;
      finalTranscript = event.transcript;
    }
    writeNdjson(res, event);
  };

  try {
    await runAnalysis(
      {
        prompt,
        entries: entries.length > 0 ? entries : undefined,
        transcriptHeader,
        model: pickModel(body.model),
      },
      emit,
      abortSignalFor(req, res),
    );
    if (finalReport) {
      const id = await saveRun({
        project,
        skill,
        addresses,
        question,
        report: finalReport,
        transcript: finalTranscript,
      });
      writeNdjson(res, { type: "saved", id });
    }
  } catch (err) {
    writeNdjson(res, { type: "error", message: (err as Error).message });
  } finally {
    res.end();
  }
});

// Build a verdict from the project's stored analyze transcripts. Streams like
// analyze so the UI shows progress; persists as a build-preview run.
app.post("/api/agent/verdict", async (req, res) => {
  const body = req.body as {
    project?: string;
    model?: unknown;
    /** compact call-tree (signatures + links) for the incident's legs */
    traceTree?: string;
    /** decoded swaps per leg (protocol, pool, token amounts in/out) */
    swaps?: string;
    /** addresses already covered by analyze-code / analyze-value */
    analyzed?: string[];
  };
  const project = body.project?.trim();
  if (!project) {
    res.status(400).json({ error: "project is required" });
    return;
  }

  const transcripts = await listAnalyzeTranscripts(project);
  if (transcripts.length === 0) {
    res.status(409).json({
      error: "no analyze runs yet — run Analyze code / Analyze value on the nodes first",
    });
    return;
  }

  const combined = transcripts
    .map((t, i) => `=== Analysis ${i + 1} (${t.skill}) ===\n${t.transcript}`)
    .join("\n\n");
  const traceTree = typeof body.traceTree === "string" ? body.traceTree.trim() : "";
  const swaps = typeof body.swaps === "string" ? body.swaps.trim() : "";
  const analyzed = normalizeAddresses(body.analyzed ?? []);
  const parts = [BUILD_PREVIEW_TASK, ""];
  if (traceTree) {
    parts.push(
      "Structural trace tree of the incident (signatures + call links):",
      "",
      traceTree,
      "",
    );
  }
  if (swaps) {
    parts.push(
      "Decoded swaps of the incident (protocol, pool, token amounts in → out):",
      "",
      swaps,
      "",
    );
  }
  parts.push(
    `Contracts already analyzed (do not flag these as important): ${
      analyzed.length > 0 ? analyzed.join(", ") : "(none)"
    }`,
    "",
    "Prior analyses for this transaction/incident:",
    "",
    combined,
  );
  const prompt = parts.join("\n");

  startNdjson(res);
  let finalReport = "";
  let finalTranscript = "";
  let flagged: string[] = [];
  const emit = (event: RunEvent) => {
    if (event.type === "done") {
      finalReport = event.report;
      finalTranscript = event.transcript;
    }
    if (event.type === "flagged") {
      // exclude anything already analyzed — belt-and-suspenders over the prompt
      flagged = event.addresses.filter((a) => !analyzed.includes(a));
    }
    writeNdjson(res, event);
  };

  try {
    await runAnalysis(
      {
        prompt,
        transcriptHeader: [
          "Skill: build-preview",
          `Combined ${transcripts.length} analyses`,
          traceTree ? "Trace tree: provided" : "Trace tree: none",
          swaps ? "Swaps: provided" : "Swaps: none",
        ],
        model: pickModel(body.model),
        collectImportant: true,
      },
      emit,
      abortSignalFor(req, res),
    );
    if (finalReport) {
      const id = await saveRun({
        project,
        skill: "build-preview",
        addresses: flagged,
        question: null,
        report: finalReport,
        transcript: finalTranscript,
      });
      writeNdjson(res, { type: "saved", id });
    }
  } catch (err) {
    writeNdjson(res, { type: "error", message: (err as Error).message });
  } finally {
    res.end();
  }
});

// Follow-up chat about a stored verdict. agent-api is stateless (ADR-009): the
// session that produced the verdict is gone, so we reconstruct its context —
// the stored verdict report, the analyze transcripts, the trace tree + swaps
// the client re-sends, and the conversation so far — into a single prompt and
// run a fresh session. Streams like the other endpoints; nothing is persisted
// (follow-ups are ephemeral and must not pollute the analyze transcripts).
app.post("/api/agent/verdict/chat", async (req, res) => {
  const body = req.body as {
    project?: string;
    model?: unknown;
    question?: string;
    history?: { role?: string; text?: string }[];
    traceTree?: string;
    swaps?: string;
  };
  const project = body.project?.trim();
  const question = body.question?.trim();
  if (!project || !question) {
    res.status(400).json({ error: "project and question are required" });
    return;
  }

  const verdict = await latestVerdict(project);
  if (!verdict) {
    res.status(409).json({ error: "no verdict yet — build one before asking follow-ups" });
    return;
  }

  const transcripts = await listAnalyzeTranscripts(project);
  const combined = transcripts
    .map((t, i) => `=== Analysis ${i + 1} (${t.skill}) ===\n${t.transcript}`)
    .join("\n\n");
  const traceTree = typeof body.traceTree === "string" ? body.traceTree.trim() : "";
  const swaps = typeof body.swaps === "string" ? body.swaps.trim() : "";

  const parts = [VERDICT_CHAT_TASK, "", "The verdict you produced:", "", verdict.report, ""];
  if (traceTree) {
    parts.push("Structural trace tree of the incident:", "", traceTree, "");
  }
  if (swaps) {
    parts.push("Decoded swaps (protocol, pool, token amounts in → out):", "", swaps, "");
  }
  if (combined) {
    parts.push("Underlying per-contract analyses:", "", combined, "");
  }
  const history = Array.isArray(body.history) ? body.history : [];
  const priorTurns = history
    .filter((t) => typeof t.text === "string" && t.text.trim().length > 0)
    .map((t) => `${t.role === "assistant" ? "Assistant" : "User"}: ${t.text?.trim()}`);
  if (priorTurns.length > 0) {
    parts.push("Conversation so far:", "", ...priorTurns, "");
  }
  parts.push("User's follow-up question:", "", question);
  const prompt = parts.join("\n");

  startNdjson(res);
  try {
    await runAnalysis(
      {
        prompt,
        transcriptHeader: ["Skill: verdict-chat"],
        model: pickModel(body.model),
      },
      (event) => writeNdjson(res, event),
      abortSignalFor(req, res),
    );
  } catch (err) {
    writeNdjson(res, { type: "error", message: (err as Error).message });
  } finally {
    res.end();
  }
});

// Latest stored verdict (Preview panel shows it on load).
app.get("/api/agent/verdict", async (req, res) => {
  const project = typeof req.query.project === "string" ? req.query.project : "";
  if (!project) {
    res.status(400).json({ error: "project query param required" });
    return;
  }
  try {
    const verdict = await latestVerdict(project);
    res.json({
      verdict: verdict
        ? { id: verdict.id, report: verdict.report, createdAt: verdict.createdAt }
        : null,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

function buildAnalyzePrompt(
  skill: "analyze-code" | "analyze-value",
  context: string,
  hasSignatures: boolean,
  question: string | null,
): string {
  const parts: string[] = [];
  if (skill === "analyze-code") {
    parts.push(
      ANALYZE_CODE_TASK,
      "",
      "Function signatures declared in the contracts under review:",
      "",
      formatSignatureList(parseFunctionSignatures(context)),
    );
  } else {
    parts.push(ANALYZE_VALUE_TASK, "", "Contract state and ABI under review:", "", context);
    if (hasSignatures) {
      parts.push("", "Contract source was also submitted; use get_function_code for bodies.");
    }
  }
  if (question) {
    parts.push("", `The user specifically asks: ${question}`);
  }
  return parts.join("\n");
}

function normalizeAddresses(addresses: string[]): string[] {
  const out = new Set<string>();
  for (const a of addresses) {
    if (typeof a !== "string") continue;
    // accept eth:0x… and plain 0x…, store plain lowercase (ADR-004/009)
    const plain = a.replace(/^[a-z]+:/i, "").toLowerCase();
    if (/^0x[0-9a-f]{40}$/.test(plain)) out.add(plain);
  }
  return [...out];
}

function startNdjson(res: express.Response): void {
  res.status(200);
  res.setHeader("Content-Type", "application/x-ndjson");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("X-Accel-Buffering", "no"); // belt-and-suspenders with nginx
  res.flushHeaders?.();
}

function writeNdjson(
  res: express.Response,
  event: RunEvent | { type: string; [k: string]: unknown },
): void {
  res.write(`${JSON.stringify(event)}\n`);
}

function abortSignalFor(req: express.Request, res: express.Response): AbortSignal {
  const controller = new AbortController();
  req.once("aborted", () => controller.abort());
  res.once("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  return controller.signal;
}

app.listen(config.AGENT_API_PORT, () => {
  console.log(`agent-api listening on http://localhost:${config.AGENT_API_PORT}`);
});
