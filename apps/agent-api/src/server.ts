// agent-api: pi-harness analysis skills for the disco Analyze panel (ADR-009).
import { loadConfig } from "@mev/config";
import express from "express";
import { listModels } from "./models.js";
import { type RunEvent, runAnalysis } from "./runner.js";
import { formatSignatureList, parseFunctionSignatures } from "./signatures.js";
import { SKILLS } from "./skills.js";
import { latestVerdict, listAnalyzeTranscripts, listRuns, saveRun } from "./store.js";
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
      abortSignalFor(req),
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
      abortSignalFor(req),
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
      abortSignalFor(req),
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

function abortSignalFor(req: express.Request): AbortSignal {
  const controller = new AbortController();
  req.on("close", () => controller.abort());
  return controller.signal;
}

app.listen(config.AGENT_API_PORT, () => {
  console.log(`agent-api listening on http://localhost:${config.AGENT_API_PORT}`);
});
