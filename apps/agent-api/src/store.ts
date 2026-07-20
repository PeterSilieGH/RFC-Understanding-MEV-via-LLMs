// App-owned storage for agent analysis runs (ADR-009). Shared Postgres
// instance (ADR-002); never touches mev-inspect-py's tables.
import { pool } from "@mev/db";

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

let ready: Promise<unknown> | undefined;

function ensureTable(): Promise<unknown> {
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
      )
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
  await ensureTable();
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

/** All analyze runs for a project, newest first (drives node ticks + verdict input). */
export async function listRuns(project: string): Promise<AgentRun[]> {
  await ensureTable();
  const res = await pool.query<RunRow>(
    "SELECT * FROM agent_runs WHERE project = $1 ORDER BY created_at DESC",
    [project],
  );
  return res.rows.map(toRun);
}

/** Analyze transcripts for a project (excludes build-preview verdicts). */
export async function listAnalyzeTranscripts(project: string): Promise<AgentRun[]> {
  await ensureTable();
  const res = await pool.query<RunRow>(
    `SELECT * FROM agent_runs
     WHERE project = $1 AND skill IN ('analyze-code', 'analyze-value')
     ORDER BY created_at ASC`,
    [project],
  );
  return res.rows.map(toRun);
}

/** Most recent verdict for a project, or null. */
export async function latestVerdict(project: string): Promise<AgentRun | null> {
  await ensureTable();
  const res = await pool.query<RunRow>(
    `SELECT * FROM agent_runs
     WHERE project = $1 AND skill = 'build-preview'
     ORDER BY created_at DESC LIMIT 1`,
    [project],
  );
  const row = res.rows[0];
  return row ? toRun(row) : null;
}
