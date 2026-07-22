import { createHash } from "node:crypto";
// agent-api: pi-harness analysis skills for the disco Analyze panel (ADR-009).
import { loadConfig } from "@mev/config";
import express from "express";
import {
  BUNDLE_ANALYZER_VERSION,
  BUNDLE_PROMPT_VERSION,
  BUNDLE_SCHEMA_VERSION,
  bundleText,
  estimateTokens,
} from "./bundles.js";
import {
  type ContractCandidate,
  authorizeCandidates,
  loadCandidateCatalog,
} from "./candidateCatalog.js";
import { buildContractAnalysisConfig } from "./contractAnalysis.js";
import { listModels } from "./models.js";
import { type RunEvent, type ThinkingLevel, runAnalysis } from "./runner.js";
import { formatSignatureList, parseFunctionSignatures } from "./signatures.js";
import { SKILLS } from "./skills.js";
import {
  type CompactToolResult,
  type ConsultedBundleRevision,
  type ContractBundle,
  type ResearchKind,
  type SessionTurn,
  addBundleAddresses,
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
app.use(express.json());

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

// ADR-016: opening Discovery is a catalog/cache lookup only. This route never
// loads full source, decompiles bytecode, calls RPC, or invokes a model.
app.post("/api/agent/bundles/prepare", async (req, res) => {
  const body = req.body as {
    project?: string;
    kinds?: unknown;
  };
  const project = body.project?.trim();
  const kinds = pickKinds(body.kinds);
  if (!project || kinds.length === 0) {
    res.status(400).json({ error: "project and active kinds are required" });
    return;
  }
  startNdjson(res);
  try {
    const catalog = await loadCandidateCatalog(project);
    const cachedBundles = await getBundles(
      catalog.candidates.map((item) => item.runtimeCodehash),
      kinds,
    );
    writeNdjson(res, {
      type: "catalog",
      fingerprint: catalog.fingerprint,
      snapshot: catalog.snapshot,
    });
    writeNdjson(res, {
      type: "progress",
      phase: "resolved",
      completed: 0,
      total: catalog.candidates.length,
    });
    let completed = 0;
    for (const candidate of catalog.candidates) {
      for (const kind of kinds) {
        const bundle = cachedBundles.find(
          (item) =>
            item.codehash === candidate.runtimeCodehash &&
            item.kind === kind &&
            isCurrentBundle(item),
        );
        if (bundle) {
          const withAddress = bundle.addresses.includes(candidate.address)
            ? bundle
            : ((await addBundleAddresses(bundle.codehash, bundle.kind, [candidate.address])) ??
              bundle);
          writeNdjson(res, { type: "bundle", candidateId: candidate.id, bundle: withAddress });
        } else {
          writeNdjson(res, { type: "candidate", kind, candidate });
        }
      }
      completed++;
      writeNdjson(res, {
        type: "progress",
        phase: "completed",
        completed,
        total: catalog.candidates.length,
        address: candidate.address,
      });
    }
    writeNdjson(res, { type: "prepared" });
  } catch (err) {
    writeNdjson(res, { type: "error", message: (err as Error).message });
  } finally {
    res.end();
  }
});

function isCurrentBundle(bundle: ContractBundle): boolean {
  const versioned = bundle as ContractBundle & {
    schemaVersion?: number;
    promptVersion?: string;
    analyzerVersion?: string;
    status?: string;
  };
  return (
    versioned.status !== "stale" &&
    versioned.schemaVersion === BUNDLE_SCHEMA_VERSION &&
    versioned.promptVersion === BUNDLE_PROMPT_VERSION[bundle.kind] &&
    versioned.analyzerVersion === BUNDLE_ANALYZER_VERSION
  );
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
    effort?: unknown;
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
        thinkingLevel: pickEffort(body.effort),
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
  unresolved: ContractCandidate[],
): string {
  return [
    DISCOVERY_PROMPTS[kind],
    "Use only the supplied bundles and incident evidence. Cite bundle addresses and entry points.",
    "",
    "Selected reusable contract bundles:",
    ...bundles.map((bundle, i) => `\n=== Bundle ${i + 1} ===\n${bundleText(bundle)}`),
    // ADR-016 §3: unresolved candidates are analyzed lazily. Give the model the
    // opaque ids it may pass to request_contract_analysis, but no addresses/code
    // it could use to fabricate a request outside the authorized selection.
    ...(unresolved.length > 0
      ? [
          "",
          "Unresolved selected candidates (call request_contract_analysis with the candidateId to analyze one, only if it materially affects the verdict):",
          ...unresolved.map(
            (candidate) =>
              `- candidateId=${candidate.id} · ${candidate.name ?? "unnamed"} (${candidate.address}) · evidence=${candidate.sourceStatus}${candidate.traceRelevance ? ` · ${candidate.traceRelevance}` : ""}`,
          ),
        ]
      : []),
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
    candidateIds?: unknown;
    catalogFingerprint?: string;
    question?: string;
    traceTree?: string;
    swaps?: string;
    gas?: string;
    effort?: unknown;
    model?: unknown;
    analyzeModel?: unknown;
    analyzeEffort?: unknown;
    reset?: boolean;
  };
  const project = body.project?.trim();
  const incident = body.incident?.trim() || project;
  const kind = body.kind === "mev" || body.kind === "vuln" ? body.kind : undefined;
  const codehashes = Array.isArray(body.codehashes)
    ? body.codehashes.filter((x): x is string => typeof x === "string")
    : [];
  const candidateIds = Array.isArray(body.candidateIds)
    ? [...new Set(body.candidateIds.filter((x): x is string => typeof x === "string"))]
    : [];
  const catalogFingerprint = body.catalogFingerprint?.trim();
  if (!project || !incident || !kind || (codehashes.length === 0 && candidateIds.length === 0)) {
    res.status(400).json({
      error: "project, incident, kind, and at least one selected bundle or candidate are required",
    });
    return;
  }
  const bundles = await getBundles(codehashes, [kind]);

  // ADR-016 §3: authorize the model's lazy-analysis surface server-side. The
  // parent may request analysis only for candidates in this selection.
  let candidates: ContractCandidate[] = [];
  if (candidateIds.length > 0) {
    if (!catalogFingerprint) {
      res.status(400).json({ error: "catalogFingerprint is required when selecting candidates" });
      return;
    }
    try {
      ({ candidates } = await authorizeCandidates({
        project,
        fingerprint: catalogFingerprint,
        kind,
        candidateIds,
      }));
    } catch (err) {
      res.status(409).json({ error: (err as Error).message });
      return;
    }
  }
  if (bundles.length === 0 && candidates.length === 0) {
    res.status(409).json({ error: `no selected ${kind} bundles or candidates are available` });
    return;
  }
  // Candidates already carrying a current bundle are analyzed, not lazy.
  const bundleCodehashes = new Set(bundles.map((bundle) => bundle.codehash));
  const unresolved = candidates.filter(
    (candidate) => !bundleCodehashes.has(candidate.runtimeCodehash),
  );
  const model = pickModel(body.model);
  const effort = pickEffort(body.effort) ?? "low";
  const analyzeModel = pickModel(body.analyzeModel) ?? model;
  const analyzeEffort = pickEffort(body.analyzeEffort) ?? effort;
  const base = discoveryBase(
    kind,
    bundles,
    body.traceTree?.trim() ?? "",
    body.swaps?.trim() ?? "",
    body.gas?.trim() ?? "",
    unresolved,
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
  // The fingerprint covers selected bundles AND the authorized unresolved
  // candidate set, so changing either the selection or the tool's authority
  // starts a fresh session instead of reusing stale context/tool grants.
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        bundles: bundles.map((b) => [b.codehash, b.updatedAt]),
        candidates: [...unresolved.map((c) => c.id)].sort(),
        catalog: catalogFingerprint ?? null,
      }),
    )
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
    effort,
  ].join(":");
  // ADR-016 §3: mutable sinks the parent persists with its durable session so a
  // follow-up after restart rehydrates which reusable bundles it consulted.
  const consulted: ConsultedBundleRevision[] = [...(previous?.consultedBundleRevisions ?? [])];
  const compact: CompactToolResult[] = [...(previous?.compactToolResults ?? [])];
  const contractAnalysis =
    unresolved.length > 0
      ? buildContractAnalysisConfig({
          project,
          kind,
          candidates: unresolved,
          childModel: analyzeModel,
          childEffort: analyzeEffort,
          consulted,
          compact,
        })
      : undefined;
  startNdjson(res);
  let report = "";
  let contextUsage: Extract<RunEvent, { type: "usage" }> | undefined;
  try {
    await runAnalysis(
      {
        prompt: question,
        rehydrationPrompt,
        persistentKey,
        transcriptHeader: [
          `Discovery: ${kind}`,
          `Bundles: ${bundles.length}`,
          `Candidates: ${unresolved.length}`,
        ],
        model,
        systemPromptSuffix: DISCOVERY_PROMPTS[kind],
        // ADR-013 §6/§8: stream reasoning and offer the read-only cast tool.
        thinkingLevel: effort,
        enableCast: true,
        contractAnalysis,
      },
      (event) => {
        if (event.type === "done") report = event.report;
        else if (event.type === "usage") contextUsage = event;
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
        contextTokens: contextUsage?.tokens ?? previous?.contextTokens ?? null,
        contextWindow: contextUsage?.contextWindow ?? previous?.contextWindow ?? contextWindow,
        turns: compactSessionTurns([
          ...turns,
          { role: "user", text: question },
          { role: "assistant", text: report },
        ]),
        candidateCatalogFingerprint: catalogFingerprint ?? null,
        consultedBundleRevisions: consulted,
        compactToolResults: compact,
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
  effort?: unknown;
}

/** Accept a model override only when both fields are present strings. */
function pickModel(model: unknown): { provider: string; id: string } | undefined {
  if (typeof model !== "object" || model === null) return undefined;
  const { provider, id } = model as Record<string, unknown>;
  if (typeof provider === "string" && typeof id === "string") return { provider, id };
  return undefined;
}

function pickEffort(value: unknown): ThinkingLevel | undefined {
  return value === "off" ||
    value === "minimal" ||
    value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh"
    ? value
    : undefined;
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
        thinkingLevel: pickEffort(body.effort),
        model: pickModel(body.model),
        enableCast: true,
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
    effort?: unknown;
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
        thinkingLevel: pickEffort(body.effort),
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
    effort?: unknown;
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
        thinkingLevel: pickEffort(body.effort),
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
