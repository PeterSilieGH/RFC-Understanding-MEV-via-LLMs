// App-owned persistence for agent runs plus ADR-012's typed contract bundles
// and durable Discovery sessions. All data lives in the shared Postgres
// instance (ADR-002); none of the inspector-owned tables are touched.
import { pool } from "@mev/db";

export type ResearchKind = "mev" | "vuln";
export type SkillId = "analyze-code" | "analyze-value" | "build-preview";

export interface AgentRun {
  id: number;
  project: string;
  skill: SkillId;
  addresses: string[];
  question: string | null;
  report: string;
  transcript: string;
  createdAt: string;
}

export interface ContractBundle {
  codehash: string;
  kind: ResearchKind;
  addresses: string[];
  role: string;
  entryPoints: string[];
  flowSummary: string;
  notes: string;
  tokenEstimate: number;
  provenanceRunId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionTurn {
  role: "user" | "assistant";
  text: string;
}

export interface DiscoverySession {
  project: string;
  incident: string;
  kind: ResearchKind;
  bundleFingerprint: string;
  modelProvider: string | null;
  modelId: string | null;
  contextTokens: number | null;
  contextWindow: number | null;
  turns: SessionTurn[];
  updatedAt: string;
}

let ready: Promise<unknown> | undefined;

function ensureTables(): Promise<unknown> {
  if (!ready) {
    ready = pool.query(`
      CREATE TABLE IF NOT EXISTS agent_runs (
        id SERIAL PRIMARY KEY,
        project TEXT NOT NULL,
        skill TEXT NOT NULL,
        addresses TEXT[] NOT NULL DEFAULT '{}',
        question TEXT,
        report TEXT NOT NULL,
        transcript TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS contract_bundles (
        codehash TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('mev', 'vuln')),
        addresses TEXT[] NOT NULL DEFAULT '{}',
        role TEXT NOT NULL,
        entry_points TEXT[] NOT NULL DEFAULT '{}',
        flow_summary TEXT NOT NULL,
        notes TEXT NOT NULL,
        token_estimate INTEGER NOT NULL CHECK (token_estimate >= 0),
        provenance_run_id INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (codehash, kind)
      );
      CREATE INDEX IF NOT EXISTS contract_bundles_addresses_idx
        ON contract_bundles USING GIN (addresses);

      CREATE TABLE IF NOT EXISTS agent_sessions (
        project TEXT NOT NULL,
        incident TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('mev', 'vuln')),
        bundle_fingerprint TEXT NOT NULL,
        model_provider TEXT,
        model_id TEXT,
        context_tokens INTEGER,
        context_window INTEGER,
        turns JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        PRIMARY KEY (project, incident, kind)
      );
      ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS context_tokens INTEGER;
      ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS context_window INTEGER;
    `);
  }
  return ready;
}

export async function saveRun(run: {
  project: string;
  skill: SkillId;
  addresses: string[];
  question: string | null;
  report: string;
  transcript: string;
}): Promise<number> {
  await ensureTables();
  const res = await pool.query(
    `INSERT INTO agent_runs (project, skill, addresses, question, report, transcript)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [run.project, run.skill, run.addresses, run.question, run.report, run.transcript],
  );
  return res.rows[0].id as number;
}

interface RunRow {
  id: number;
  project: string;
  skill: SkillId;
  addresses: string[];
  question: string | null;
  report: string;
  transcript: string;
  created_at: string;
}

function toRun(row: RunRow): AgentRun {
  return {
    id: row.id,
    project: row.project,
    skill: row.skill,
    addresses: row.addresses,
    question: row.question,
    report: row.report,
    transcript: row.transcript,
    createdAt: row.created_at,
  };
}

export async function listRuns(project: string): Promise<AgentRun[]> {
  await ensureTables();
  const res = await pool.query<RunRow>(
    "SELECT * FROM agent_runs WHERE project = $1 ORDER BY created_at DESC",
    [project],
  );
  return res.rows.map(toRun);
}

export async function listAnalyzeTranscripts(project: string): Promise<AgentRun[]> {
  await ensureTables();
  const res = await pool.query<RunRow>(
    `SELECT * FROM agent_runs
     WHERE project = $1 AND skill IN ('analyze-code', 'analyze-value')
     ORDER BY created_at ASC`,
    [project],
  );
  return res.rows.map(toRun);
}

export async function latestVerdict(project: string): Promise<AgentRun | null> {
  await ensureTables();
  const res = await pool.query<RunRow>(
    `SELECT * FROM agent_runs
     WHERE project = $1 AND skill = 'build-preview'
     ORDER BY created_at DESC LIMIT 1`,
    [project],
  );
  return res.rows[0] ? toRun(res.rows[0]) : null;
}

interface BundleRow {
  codehash: string;
  kind: ResearchKind;
  addresses: string[];
  role: string;
  entry_points: string[];
  flow_summary: string;
  notes: string;
  token_estimate: number;
  provenance_run_id: number | null;
  created_at: string;
  updated_at: string;
}

function toBundle(row: BundleRow): ContractBundle {
  return {
    codehash: row.codehash,
    kind: row.kind,
    addresses: row.addresses,
    role: row.role,
    entryPoints: row.entry_points,
    flowSummary: row.flow_summary,
    notes: row.notes,
    tokenEstimate: row.token_estimate,
    provenanceRunId: row.provenance_run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getBundles(
  codehashes: string[],
  kinds: ResearchKind[],
): Promise<ContractBundle[]> {
  await ensureTables();
  if (codehashes.length === 0 || kinds.length === 0) return [];
  const res = await pool.query<BundleRow>(
    `SELECT * FROM contract_bundles
     WHERE codehash = ANY($1::text[]) AND kind = ANY($2::text[])
     ORDER BY kind, codehash`,
    [codehashes, kinds],
  );
  return res.rows.map(toBundle);
}

export async function saveBundle(
  bundle: Omit<ContractBundle, "createdAt" | "updatedAt">,
): Promise<ContractBundle> {
  await ensureTables();
  const res = await pool.query<BundleRow>(
    `INSERT INTO contract_bundles
       (codehash, kind, addresses, role, entry_points, flow_summary, notes,
        token_estimate, provenance_run_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (codehash, kind) DO UPDATE SET
       addresses = ARRAY(SELECT DISTINCT unnest(contract_bundles.addresses || EXCLUDED.addresses)),
       role = EXCLUDED.role,
       entry_points = EXCLUDED.entry_points,
       flow_summary = EXCLUDED.flow_summary,
       notes = EXCLUDED.notes,
       token_estimate = EXCLUDED.token_estimate,
       provenance_run_id = EXCLUDED.provenance_run_id,
       updated_at = now()
     RETURNING *`,
    [
      bundle.codehash,
      bundle.kind,
      bundle.addresses,
      bundle.role,
      bundle.entryPoints,
      bundle.flowSummary,
      bundle.notes,
      bundle.tokenEstimate,
      bundle.provenanceRunId,
    ],
  );
  return toBundle(res.rows[0]);
}

export async function addBundleAddresses(
  codehash: string,
  kind: ResearchKind,
  addresses: string[],
): Promise<ContractBundle | null> {
  await ensureTables();
  if (addresses.length === 0) return null;
  const res = await pool.query<BundleRow>(
    `UPDATE contract_bundles SET
       addresses = ARRAY(SELECT DISTINCT unnest(addresses || $3::text[]))
     WHERE codehash=$1 AND kind=$2
     RETURNING *`,
    [codehash, kind, addresses],
  );
  return res.rows[0] ? toBundle(res.rows[0]) : null;
}

interface SessionRow {
  project: string;
  incident: string;
  kind: ResearchKind;
  bundle_fingerprint: string;
  model_provider: string | null;
  model_id: string | null;
  context_tokens: number | null;
  context_window: number | null;
  turns: SessionTurn[];
  updated_at: string;
}

function toSession(row: SessionRow): DiscoverySession {
  return {
    project: row.project,
    incident: row.incident,
    kind: row.kind,
    bundleFingerprint: row.bundle_fingerprint,
    modelProvider: row.model_provider,
    modelId: row.model_id,
    contextTokens: row.context_tokens,
    contextWindow: row.context_window,
    turns: row.turns,
    updatedAt: row.updated_at,
  };
}

export async function getSession(
  project: string,
  incident: string,
  kind: ResearchKind,
): Promise<DiscoverySession | null> {
  await ensureTables();
  const res = await pool.query<SessionRow>(
    "SELECT * FROM agent_sessions WHERE project=$1 AND incident=$2 AND kind=$3",
    [project, incident, kind],
  );
  return res.rows[0] ? toSession(res.rows[0]) : null;
}

export async function saveSession(
  session: Omit<DiscoverySession, "updatedAt">,
): Promise<DiscoverySession> {
  await ensureTables();
  const res = await pool.query<SessionRow>(
    `INSERT INTO agent_sessions
       (project, incident, kind, bundle_fingerprint, model_provider, model_id,
        context_tokens, context_window, turns)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
     ON CONFLICT (project, incident, kind) DO UPDATE SET
       bundle_fingerprint=EXCLUDED.bundle_fingerprint,
       model_provider=EXCLUDED.model_provider,
       model_id=EXCLUDED.model_id,
       context_tokens=EXCLUDED.context_tokens,
       context_window=EXCLUDED.context_window,
       turns=EXCLUDED.turns,
       updated_at=now()
     RETURNING *`,
    [
      session.project,
      session.incident,
      session.kind,
      session.bundleFingerprint,
      session.modelProvider,
      session.modelId,
      session.contextTokens,
      session.contextWindow,
      JSON.stringify(session.turns),
    ],
  );
  return toSession(res.rows[0]);
}
