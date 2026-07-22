// Agent persistence is part of @mev/db's checksummed migration ledger
// (ADR-016). This module owns typed projections and queries only; it never
// creates or alters tables independently.
import { type DbClient, migrate, pool } from "@mev/db";

type StoreClient = DbClient;

export type ResearchKind = "mev" | "vuln";
export type SkillId = "analyze-code" | "analyze-value" | "build-preview" | "bundle-analysis";
export type AgentRunKind = "manual" | "bundle-analysis" | "discovery";

export interface AgentRun {
  id: number;
  project: string;
  skill: SkillId;
  runKind: AgentRunKind;
  parentRunId: number | null;
  correlationId: string | null;
  modelProvider: string | null;
  modelId: string | null;
  addresses: string[];
  question: string | null;
  report: string;
  transcript: string;
  createdAt: string;
}

export interface SaveAgentRun {
  project: string;
  skill: SkillId;
  addresses: string[];
  question: string | null;
  report: string;
  transcript: string;
  runKind?: AgentRunKind;
  parentRunId?: number | null;
  correlationId?: string | null;
  modelProvider?: string | null;
  modelId?: string | null;
}

export type BundleSourceQuality = "verified" | "decompiled" | "opaque" | "legacy";
export type BundleStatus = "current" | "stale" | "retryable";

interface BundlePayloadBase {
  role: string;
  entryPoints: string[];
  [key: string]: unknown;
}

export interface MevBundlePayload extends BundlePayloadBase {
  kind: "mev";
  flowSummary: string;
  notes: string;
}

export interface VulnerabilityBundlePayload extends BundlePayloadBase {
  kind: "vuln";
  flowSummary: string;
  notes: string;
  assetsAtRisk?: unknown[];
  trustBoundaries?: unknown[];
  attackSurface?: unknown[];
  invariants?: unknown[];
  bugHypotheses?: unknown[];
  mitigations?: unknown[];
  unknowns?: unknown[];
}

export type ContractBundlePayload = MevBundlePayload | VulnerabilityBundlePayload;

/**
 * Versioned cache record with the legacy presentation fields kept as a stable
 * projection for current API/UI callers.
 */
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
  artifactRef: string;
  schemaVersion: number;
  promptVersion: string;
  analyzerVersion: string;
  sourceQuality: BundleSourceQuality;
  status: BundleStatus;
  payload: ContractBundlePayload;
  retryAfter: string | null;
  staleReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ContractBundleKey {
  codehash: string;
  kind: ResearchKind;
  artifactRef: string;
  schemaVersion: number;
  promptVersion: string;
  analyzerVersion: string;
}

export type SaveContractBundleVersion = Omit<ContractBundle, "createdAt" | "updatedAt">;

/** Existing saveBundle callers can omit all version/provenance additions. */
export type SaveContractBundle = Omit<
  ContractBundle,
  | "createdAt"
  | "updatedAt"
  | "artifactRef"
  | "schemaVersion"
  | "promptVersion"
  | "analyzerVersion"
  | "sourceQuality"
  | "status"
  | "payload"
  | "retryAfter"
  | "staleReason"
> &
  Partial<
    Pick<
      ContractBundle,
      | "artifactRef"
      | "schemaVersion"
      | "promptVersion"
      | "analyzerVersion"
      | "sourceQuality"
      | "status"
      | "payload"
      | "retryAfter"
      | "staleReason"
    >
  >;

export interface SessionTurn {
  role: "user" | "assistant";
  text: string;
}

export interface ConsultedBundleRevision extends ContractBundleKey {
  updatedAt: string;
}

export interface CompactToolResult {
  candidateId: string;
  status: "bundle" | "cached" | "unresolved" | "budget_exhausted" | "error";
  bundle?: ContractBundleKey;
  summary?: string;
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
  sessionVersion: number;
  candidateCatalogFingerprint: string | null;
  consultedBundleRevisions: ConsultedBundleRevision[];
  compactToolResults: CompactToolResult[];
  createdAt: string;
  updatedAt: string;
}

export type SaveDiscoverySession = Omit<
  DiscoverySession,
  | "updatedAt"
  | "createdAt"
  | "sessionVersion"
  | "candidateCatalogFingerprint"
  | "consultedBundleRevisions"
  | "compactToolResults"
> &
  Partial<
    Pick<
      DiscoverySession,
      | "sessionVersion"
      | "candidateCatalogFingerprint"
      | "consultedBundleRevisions"
      | "compactToolResults"
    >
  >;

export type AgentJobType = "catalog" | "parent-turn" | "contract-analysis" | "evidence";
export type AgentJobStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface AgentJobEvent {
  cursor: number;
  jobId: string;
  type: string;
  at: string;
  data: Record<string, unknown>;
}

export interface AgentJob {
  id: string;
  jobType: AgentJobType;
  status: AgentJobStatus;
  project: string | null;
  incident: string | null;
  kind: ResearchKind | null;
  parentJobId: string | null;
  correlationId: string | null;
  jobKey: string;
  jobVersion: number;
  request: Record<string, unknown>;
  result: Record<string, unknown> | null;
  errorClass: string | null;
  errorMessage: string | null;
  cancelRequested: boolean;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  attemptCount: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export type SaveAgentJob = Omit<
  AgentJob,
  "createdAt" | "updatedAt" | "startedAt" | "completedAt" | "attemptCount"
> & {
  attemptCount?: number;
  startedAt?: string | null;
  completedAt?: string | null;
};

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function nullableIso(value: string | Date | null): string | null {
  return value === null ? null : toIso(value);
}

function jsonValue<T>(value: T | string): T {
  return typeof value === "string" ? (JSON.parse(value) as T) : value;
}

function assertPositiveInteger(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
}

function assertBundle(bundle: SaveContractBundleVersion): void {
  assertPositiveInteger(bundle.schemaVersion, "schemaVersion");
  if (bundle.tokenEstimate < 0 || !Number.isInteger(bundle.tokenEstimate)) {
    throw new Error("tokenEstimate must be a non-negative integer");
  }
  if (bundle.payload.kind !== bundle.kind) {
    throw new Error("bundle payload kind does not match cache key");
  }
}

interface RunRow {
  id: number;
  project: string;
  skill: SkillId;
  run_kind: AgentRunKind;
  parent_run_id: number | null;
  correlation_id: string | null;
  model_provider: string | null;
  model_id: string | null;
  addresses: string[];
  question: string | null;
  report: string;
  transcript: string;
  created_at: string | Date;
}

function toRun(row: RunRow): AgentRun {
  return {
    id: Number(row.id),
    project: row.project,
    skill: row.skill,
    runKind: row.run_kind,
    parentRunId: row.parent_run_id,
    correlationId: row.correlation_id,
    modelProvider: row.model_provider,
    modelId: row.model_id,
    addresses: row.addresses,
    question: row.question,
    report: row.report,
    transcript: row.transcript,
    createdAt: toIso(row.created_at),
  };
}

export async function saveRun(run: SaveAgentRun): Promise<number> {
  await migrate();
  const result = await pool.query<{ id: number }>(
    `INSERT INTO agent_runs
       (project, skill, run_kind, parent_run_id, correlation_id, model_provider,
        model_id, addresses, question, report, transcript)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id`,
    [
      run.project,
      run.skill,
      run.runKind ?? (run.skill === "bundle-analysis" ? "bundle-analysis" : "manual"),
      run.parentRunId ?? null,
      run.correlationId ?? null,
      run.modelProvider ?? null,
      run.modelId ?? null,
      run.addresses,
      run.question,
      run.report,
      run.transcript,
    ],
  );
  return Number(result.rows[0].id);
}

export async function listRuns(project: string): Promise<AgentRun[]> {
  await migrate();
  const result = await pool.query<RunRow>(
    "SELECT * FROM agent_runs WHERE project = $1 ORDER BY created_at DESC",
    [project],
  );
  return result.rows.map(toRun);
}

export async function listAnalyzeTranscripts(project: string): Promise<AgentRun[]> {
  await migrate();
  const result = await pool.query<RunRow>(
    `SELECT * FROM agent_runs
     WHERE project = $1 AND skill IN ('analyze-code', 'analyze-value')
     ORDER BY created_at ASC`,
    [project],
  );
  return result.rows.map(toRun);
}

export async function latestVerdict(project: string): Promise<AgentRun | null> {
  await migrate();
  const result = await pool.query<RunRow>(
    `SELECT * FROM agent_runs
     WHERE project = $1 AND skill = 'build-preview'
     ORDER BY created_at DESC LIMIT 1`,
    [project],
  );
  return result.rows[0] ? toRun(result.rows[0]) : null;
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
  artifact_ref: string;
  schema_version: number;
  prompt_version: string;
  analyzer_version: string;
  source_quality: BundleSourceQuality;
  status: BundleStatus;
  payload: ContractBundlePayload | string;
  retry_after: string | Date | null;
  stale_reason: string | null;
  created_at: string | Date;
  updated_at: string | Date;
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
    tokenEstimate: Number(row.token_estimate),
    provenanceRunId: row.provenance_run_id,
    artifactRef: row.artifact_ref,
    schemaVersion: Number(row.schema_version),
    promptVersion: row.prompt_version,
    analyzerVersion: row.analyzer_version,
    sourceQuality: row.source_quality,
    status: row.status,
    payload: jsonValue(row.payload),
    retryAfter: nullableIso(row.retry_after),
    staleReason: row.stale_reason,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

const BUNDLE_COLUMNS = `
  b.*,
  COALESCE(
    (SELECT array_agg(a.address ORDER BY a.address)
     FROM contract_bundle_addresses a WHERE a.codehash = b.codehash),
    '{}'::text[]
  ) AS addresses
`;

async function saveBundleAddresses(
  client: StoreClient,
  codehash: string,
  addresses: string[],
): Promise<void> {
  if (addresses.length === 0) return;
  await client.query(
    `INSERT INTO contract_bundle_addresses (codehash, address)
     SELECT $1, address FROM unnest($2::text[]) AS address
     ON CONFLICT DO NOTHING`,
    [codehash, addresses],
  );
}

async function selectBundleVersion(
  client: StoreClient,
  key: ContractBundleKey,
): Promise<ContractBundle> {
  const result = await client.query<BundleRow>(
    `SELECT ${BUNDLE_COLUMNS}
     FROM contract_bundle_cache b
     WHERE b.codehash=$1 AND b.kind=$2 AND b.artifact_ref=$3
       AND b.schema_version=$4 AND b.prompt_version=$5 AND b.analyzer_version=$6`,
    [
      key.codehash,
      key.kind,
      key.artifactRef,
      key.schemaVersion,
      key.promptVersion,
      key.analyzerVersion,
    ],
  );
  if (!result.rows[0]) throw new Error("saved contract bundle version was not found");
  return toBundle(result.rows[0]);
}

export async function getBundles(
  codehashes: string[],
  kinds: ResearchKind[],
): Promise<ContractBundle[]> {
  await migrate();
  if (codehashes.length === 0 || kinds.length === 0) return [];
  const result = await pool.query<BundleRow>(
    `SELECT DISTINCT ON (b.kind, b.codehash) ${BUNDLE_COLUMNS}
     FROM contract_bundle_cache b
     WHERE b.codehash = ANY($1::text[]) AND b.kind = ANY($2::text[])
       AND b.status IN ('current', 'retryable')
     ORDER BY b.kind, b.codehash,
       CASE b.status WHEN 'current' THEN 0 ELSE 1 END,
       b.updated_at DESC`,
    [codehashes, kinds],
  );
  return result.rows.map(toBundle);
}

export async function getBundleVersion(key: ContractBundleKey): Promise<ContractBundle | null> {
  await migrate();
  const result = await pool.query<BundleRow>(
    `SELECT ${BUNDLE_COLUMNS}
     FROM contract_bundle_cache b
     WHERE b.codehash=$1 AND b.kind=$2 AND b.artifact_ref=$3
       AND b.schema_version=$4 AND b.prompt_version=$5 AND b.analyzer_version=$6`,
    [
      key.codehash,
      key.kind,
      key.artifactRef,
      key.schemaVersion,
      key.promptVersion,
      key.analyzerVersion,
    ],
  );
  return result.rows[0] ? toBundle(result.rows[0]) : null;
}

export async function getBundleVersions(
  codehashes: string[],
  kinds: ResearchKind[],
): Promise<ContractBundle[]> {
  await migrate();
  if (codehashes.length === 0 || kinds.length === 0) return [];
  const result = await pool.query<BundleRow>(
    `SELECT ${BUNDLE_COLUMNS}
     FROM contract_bundle_cache b
     WHERE b.codehash = ANY($1::text[]) AND b.kind = ANY($2::text[])
     ORDER BY b.kind, b.codehash, b.updated_at DESC`,
    [codehashes, kinds],
  );
  return result.rows.map(toBundle);
}

export async function saveBundleVersion(
  bundle: SaveContractBundleVersion,
): Promise<ContractBundle> {
  await migrate();
  assertBundle(bundle);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await saveBundleAddresses(client, bundle.codehash, bundle.addresses);
    await client.query(
      `INSERT INTO contract_bundle_cache (
         codehash, kind, artifact_ref, schema_version, prompt_version,
         analyzer_version, source_quality, status, payload, role, entry_points,
         flow_summary, notes, token_estimate, provenance_run_id, retry_after,
         stale_reason
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (
         codehash, kind, artifact_ref, schema_version, prompt_version, analyzer_version
       ) DO UPDATE SET
         source_quality=EXCLUDED.source_quality,
         status=EXCLUDED.status,
         payload=EXCLUDED.payload,
         role=EXCLUDED.role,
         entry_points=EXCLUDED.entry_points,
         flow_summary=EXCLUDED.flow_summary,
         notes=EXCLUDED.notes,
         token_estimate=EXCLUDED.token_estimate,
         provenance_run_id=EXCLUDED.provenance_run_id,
         retry_after=EXCLUDED.retry_after,
         stale_reason=EXCLUDED.stale_reason,
         updated_at=now()`,
      [
        bundle.codehash,
        bundle.kind,
        bundle.artifactRef,
        bundle.schemaVersion,
        bundle.promptVersion,
        bundle.analyzerVersion,
        bundle.sourceQuality,
        bundle.status,
        JSON.stringify(bundle.payload),
        bundle.role,
        bundle.entryPoints,
        bundle.flowSummary,
        bundle.notes,
        bundle.tokenEstimate,
        bundle.provenanceRunId,
        bundle.retryAfter,
        bundle.staleReason,
      ],
    );
    const saved = await selectBundleVersion(client, bundle);
    await client.query("COMMIT");
    return saved;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function saveBundle(bundle: SaveContractBundle): Promise<ContractBundle> {
  const payload: ContractBundlePayload = bundle.payload ?? {
    kind: bundle.kind,
    role: bundle.role,
    entryPoints: bundle.entryPoints,
    flowSummary: bundle.flowSummary,
    notes: bundle.notes,
  };
  const opaque = bundle.role === "Unverified runtime contract" && bundle.provenanceRunId === null;
  return saveBundleVersion({
    ...bundle,
    artifactRef: bundle.artifactRef ?? `legacy:${bundle.codehash}`,
    schemaVersion: bundle.schemaVersion ?? 1,
    promptVersion: bundle.promptVersion ?? "legacy-v1",
    analyzerVersion: bundle.analyzerVersion ?? "legacy",
    sourceQuality: bundle.sourceQuality ?? (opaque ? "opaque" : "legacy"),
    status: bundle.status ?? (opaque ? "retryable" : "current"),
    payload,
    retryAfter: bundle.retryAfter ?? null,
    staleReason: bundle.staleReason ?? null,
  });
}

export async function setBundleStatus(
  key: ContractBundleKey,
  status: BundleStatus,
  options: { retryAfter?: string | null; staleReason?: string | null } = {},
): Promise<ContractBundle | null> {
  await migrate();
  const result = await pool.query<BundleRow>(
    `UPDATE contract_bundle_cache b SET
       status=$7,
       retry_after=CASE WHEN $7='retryable' THEN $8::timestamptz ELSE NULL END,
       stale_reason=$9,
       updated_at=now()
     WHERE b.codehash=$1 AND b.kind=$2 AND b.artifact_ref=$3
       AND b.schema_version=$4 AND b.prompt_version=$5 AND b.analyzer_version=$6
     RETURNING b.*,
       COALESCE(
         (SELECT array_agg(a.address ORDER BY a.address)
          FROM contract_bundle_addresses a WHERE a.codehash = b.codehash),
         '{}'::text[]
       ) AS addresses`,
    [
      key.codehash,
      key.kind,
      key.artifactRef,
      key.schemaVersion,
      key.promptVersion,
      key.analyzerVersion,
      status,
      options.retryAfter ?? null,
      options.staleReason ?? null,
    ],
  );
  return result.rows[0] ? toBundle(result.rows[0]) : null;
}

export async function addBundleAddresses(
  codehash: string,
  kind: ResearchKind,
  addresses: string[],
): Promise<ContractBundle | null> {
  await migrate();
  if (addresses.length === 0) return null;
  await pool.query(
    `INSERT INTO contract_bundle_addresses (codehash, address)
     SELECT $1, address FROM unnest($2::text[]) AS address
     ON CONFLICT DO NOTHING`,
    [codehash, addresses],
  );
  return (await getBundles([codehash], [kind]))[0] ?? null;
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
  turns: SessionTurn[] | string;
  session_version: number;
  candidate_catalog_fingerprint: string | null;
  consulted_bundle_revisions: ConsultedBundleRevision[] | string;
  compact_tool_results: CompactToolResult[] | string;
  created_at: string | Date;
  updated_at: string | Date;
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
    turns: jsonValue(row.turns),
    sessionVersion: Number(row.session_version),
    candidateCatalogFingerprint: row.candidate_catalog_fingerprint,
    consultedBundleRevisions: jsonValue(row.consulted_bundle_revisions),
    compactToolResults: jsonValue(row.compact_tool_results),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function getSession(
  project: string,
  incident: string,
  kind: ResearchKind,
): Promise<DiscoverySession | null> {
  await migrate();
  const result = await pool.query<SessionRow>(
    "SELECT * FROM agent_sessions WHERE project=$1 AND incident=$2 AND kind=$3",
    [project, incident, kind],
  );
  return result.rows[0] ? toSession(result.rows[0]) : null;
}

export async function saveSession(session: SaveDiscoverySession): Promise<DiscoverySession> {
  await migrate();
  const sessionVersion = session.sessionVersion ?? 1;
  assertPositiveInteger(sessionVersion, "sessionVersion");
  const result = await pool.query<SessionRow>(
    `INSERT INTO agent_sessions (
       project, incident, kind, bundle_fingerprint, model_provider, model_id,
       context_tokens, context_window, turns, session_version,
       candidate_catalog_fingerprint, consulted_bundle_revisions, compact_tool_results
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12::jsonb,$13::jsonb)
     ON CONFLICT (project, incident, kind) DO UPDATE SET
       bundle_fingerprint=EXCLUDED.bundle_fingerprint,
       model_provider=EXCLUDED.model_provider,
       model_id=EXCLUDED.model_id,
       context_tokens=EXCLUDED.context_tokens,
       context_window=EXCLUDED.context_window,
       turns=EXCLUDED.turns,
       session_version=EXCLUDED.session_version,
       candidate_catalog_fingerprint=EXCLUDED.candidate_catalog_fingerprint,
       consulted_bundle_revisions=EXCLUDED.consulted_bundle_revisions,
       compact_tool_results=EXCLUDED.compact_tool_results,
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
      sessionVersion,
      session.candidateCatalogFingerprint ?? null,
      JSON.stringify(session.consultedBundleRevisions ?? []),
      JSON.stringify(session.compactToolResults ?? []),
    ],
  );
  return toSession(result.rows[0]);
}

interface JobRow {
  id: string;
  job_type: AgentJobType;
  status: AgentJobStatus;
  project: string | null;
  incident: string | null;
  kind: ResearchKind | null;
  parent_job_id: string | null;
  correlation_id: string | null;
  job_key: string;
  job_version: number;
  request: Record<string, unknown> | string;
  result: Record<string, unknown> | string | null;
  error_class: string | null;
  error_message: string | null;
  cancellation_requested: boolean;
  lease_owner: string | null;
  lease_expires_at: string | Date | null;
  attempt_count: number;
  created_at: string | Date;
  started_at: string | Date | null;
  completed_at: string | Date | null;
  updated_at: string | Date;
}

function toJob(row: JobRow): AgentJob {
  return {
    id: row.id,
    jobType: row.job_type,
    status: row.status,
    project: row.project,
    incident: row.incident,
    kind: row.kind,
    parentJobId: row.parent_job_id,
    correlationId: row.correlation_id,
    jobKey: row.job_key,
    jobVersion: Number(row.job_version),
    request: jsonValue(row.request),
    result: row.result === null ? null : jsonValue(row.result),
    errorClass: row.error_class,
    errorMessage: row.error_message,
    cancelRequested: row.cancellation_requested,
    leaseOwner: row.lease_owner,
    leaseExpiresAt: nullableIso(row.lease_expires_at),
    attemptCount: Number(row.attempt_count),
    createdAt: toIso(row.created_at),
    startedAt: nullableIso(row.started_at),
    completedAt: nullableIso(row.completed_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function saveAgentJob(job: SaveAgentJob): Promise<AgentJob> {
  await migrate();
  assertPositiveInteger(job.jobVersion, "jobVersion");
  const result = await pool.query<JobRow>(
    `INSERT INTO agent_jobs (
       id, job_type, status, project, incident, kind, parent_job_id,
       correlation_id, job_key, job_version, request, result,
       error_class, error_message, cancellation_requested, lease_owner,
       lease_expires_at, attempt_count, started_at, completed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,
               $13,$14,$15,$16,$17,$18,$19,$20)
     ON CONFLICT (id) DO UPDATE SET
       status=EXCLUDED.status,
       project=EXCLUDED.project,
       incident=EXCLUDED.incident,
       kind=EXCLUDED.kind,
       parent_job_id=EXCLUDED.parent_job_id,
       correlation_id=EXCLUDED.correlation_id,
       job_key=EXCLUDED.job_key,
       job_version=EXCLUDED.job_version,
       request=EXCLUDED.request,
       result=EXCLUDED.result,
       error_class=EXCLUDED.error_class,
       error_message=EXCLUDED.error_message,
       cancellation_requested=EXCLUDED.cancellation_requested,
       lease_owner=EXCLUDED.lease_owner,
       lease_expires_at=EXCLUDED.lease_expires_at,
       attempt_count=EXCLUDED.attempt_count,
       started_at=EXCLUDED.started_at,
       completed_at=EXCLUDED.completed_at,
       updated_at=now()
     RETURNING *`,
    [
      job.id,
      job.jobType,
      job.status,
      job.project,
      job.incident,
      job.kind,
      job.parentJobId,
      job.correlationId,
      job.jobKey,
      job.jobVersion,
      JSON.stringify(job.request),
      job.result === null ? null : JSON.stringify(job.result),
      job.errorClass,
      job.errorMessage,
      job.cancelRequested,
      job.leaseOwner,
      job.leaseExpiresAt,
      job.attemptCount ?? 0,
      job.startedAt ?? null,
      job.completedAt ?? null,
    ],
  );
  return toJob(result.rows[0]);
}

export async function getAgentJob(id: string): Promise<AgentJob | null> {
  await migrate();
  const result = await pool.query<JobRow>("SELECT * FROM agent_jobs WHERE id=$1", [id]);
  return result.rows[0] ? toJob(result.rows[0]) : null;
}

export async function findAgentJobByDedupKey(dedupKey: string): Promise<AgentJob | null> {
  await migrate();
  const result = await pool.query<JobRow>("SELECT * FROM agent_jobs WHERE job_key=$1", [dedupKey]);
  return result.rows[0] ? toJob(result.rows[0]) : null;
}

export async function listRecoverableAgentJobs(limit = 100): Promise<AgentJob[]> {
  await migrate();
  assertPositiveInteger(limit, "limit");
  const result = await pool.query<JobRow>(
    `SELECT * FROM agent_jobs
     WHERE status IN ('queued', 'running')
       AND (lease_expires_at IS NULL OR lease_expires_at < now())
     ORDER BY created_at ASC LIMIT $1`,
    [limit],
  );
  return result.rows.map(toJob);
}

export async function claimAgentJob(
  id: string,
  leaseOwner: string,
  leaseMs: number,
): Promise<AgentJob | null> {
  await migrate();
  assertPositiveInteger(leaseMs, "leaseMs");
  const result = await pool.query<JobRow>(
    `UPDATE agent_jobs SET
       status='running',
       lease_owner=$2,
       lease_expires_at=now() + $3 * interval '1 millisecond',
       attempt_count=attempt_count + 1,
       started_at=COALESCE(started_at, now()),
       updated_at=now()
     WHERE id=$1 AND status IN ('queued', 'running')
       AND (lease_expires_at IS NULL OR lease_expires_at < now() OR lease_owner=$2)
     RETURNING *`,
    [id, leaseOwner, leaseMs],
  );
  return result.rows[0] ? toJob(result.rows[0]) : null;
}

export async function requestAgentJobCancellation(id: string): Promise<AgentJob | null> {
  await migrate();
  const result = await pool.query<JobRow>(
    `UPDATE agent_jobs SET cancellation_requested=true, updated_at=now()
     WHERE id=$1 RETURNING *`,
    [id],
  );
  return result.rows[0] ? toJob(result.rows[0]) : null;
}

export async function completeAgentJob(
  id: string,
  resultPayload: Record<string, unknown>,
): Promise<AgentJob | null> {
  await migrate();
  const result = await pool.query<JobRow>(
    `UPDATE agent_jobs SET
       status='succeeded', result=$2::jsonb, error_class=NULL, error_message=NULL,
       lease_owner=NULL, lease_expires_at=NULL, completed_at=now(), updated_at=now()
     WHERE id=$1 RETURNING *`,
    [id, JSON.stringify(resultPayload)],
  );
  return result.rows[0] ? toJob(result.rows[0]) : null;
}

export async function failAgentJob(
  id: string,
  errorClass: string,
  errorMessage: string,
): Promise<AgentJob | null> {
  await migrate();
  const result = await pool.query<JobRow>(
    `UPDATE agent_jobs SET
       status='failed', error_class=$2, error_message=$3,
       lease_owner=NULL, lease_expires_at=NULL, completed_at=now(), updated_at=now()
     WHERE id=$1 RETURNING *`,
    [id, errorClass, errorMessage],
  );
  return result.rows[0] ? toJob(result.rows[0]) : null;
}
