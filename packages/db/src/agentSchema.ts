/** Durable agent persistence and versioned bundle cache (ADR-016). */
export const AGENT_SCHEMA_SQL = `
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
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS run_kind TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS parent_run_id INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL;
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS correlation_id TEXT;
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS model_provider TEXT;
ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS model_id TEXT;
CREATE INDEX IF NOT EXISTS agent_runs_parent_idx ON agent_runs (parent_run_id);
CREATE INDEX IF NOT EXISTS agent_runs_correlation_idx ON agent_runs (correlation_id);

CREATE TABLE IF NOT EXISTS agent_sessions (
  project TEXT NOT NULL,
  incident TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mev', 'vuln')),
  bundle_fingerprint TEXT NOT NULL,
  model_provider TEXT,
  model_id TEXT,
  context_tokens INTEGER,
  context_window INTEGER,
  turns JSONB NOT NULL DEFAULT '[]'::JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project, incident, kind)
);
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS context_tokens INTEGER;
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS context_window INTEGER;
ALTER TABLE agent_sessions
  ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE agent_sessions ADD COLUMN IF NOT EXISTS candidate_catalog_fingerprint TEXT;
ALTER TABLE agent_sessions
  ADD COLUMN IF NOT EXISTS consulted_bundle_revisions JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE agent_sessions
  ADD COLUMN IF NOT EXISTS compact_tool_results JSONB NOT NULL DEFAULT '[]'::JSONB;
ALTER TABLE agent_sessions
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE TABLE IF NOT EXISTS contract_bundle_cache (
  codehash TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('mev', 'vuln')),
  artifact_ref TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  prompt_version TEXT NOT NULL,
  analyzer_version TEXT NOT NULL,
  source_quality TEXT NOT NULL
    CHECK (source_quality IN ('verified', 'decompiled', 'opaque', 'legacy')),
  status TEXT NOT NULL CHECK (status IN ('current', 'stale', 'retryable')),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  role TEXT NOT NULL DEFAULT '',
  entry_points TEXT[] NOT NULL DEFAULT '{}',
  flow_summary TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  token_estimate INTEGER NOT NULL CHECK (token_estimate >= 0),
  provenance_run_id INTEGER REFERENCES agent_runs(id) ON DELETE SET NULL,
  retry_after TIMESTAMPTZ,
  stale_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (
    codehash, kind, artifact_ref, schema_version, prompt_version, analyzer_version
  ),
  CONSTRAINT contract_bundle_payload_kind CHECK (payload->>'kind' = kind),
  CONSTRAINT contract_bundle_retry_after CHECK (
    status = 'retryable' OR retry_after IS NULL
  )
);
CREATE INDEX IF NOT EXISTS contract_bundle_cache_lookup_idx
  ON contract_bundle_cache (codehash, kind, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS contract_bundle_cache_provenance_idx
  ON contract_bundle_cache (provenance_run_id);

CREATE TABLE IF NOT EXISTS contract_bundle_addresses (
  codehash TEXT NOT NULL,
  address TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (codehash, address)
);
CREATE INDEX IF NOT EXISTS contract_bundle_addresses_address_idx
  ON contract_bundle_addresses (address);

-- Adopt ADR-012 rows when upgrading a database that used agent-api's former
-- ad-hoc DDL. Exact deterministic opaque fallbacks become retryable, and the
-- old generic vulnerability shape becomes stale rather than silently current.
DO $migration$
BEGIN
  IF to_regclass('contract_bundles') IS NOT NULL THEN
    INSERT INTO contract_bundle_cache (
      codehash, kind, artifact_ref, schema_version, prompt_version,
      analyzer_version, source_quality, status, payload, role, entry_points,
      flow_summary, notes, token_estimate, provenance_run_id, stale_reason
    )
    SELECT
      codehash,
      kind,
      'legacy:' || codehash,
      1,
      'legacy-v1',
      'legacy',
      'legacy',
      CASE
        WHEN role = 'Unverified runtime contract' AND provenance_run_id IS NULL
          THEN 'retryable'
        WHEN kind = 'vuln' THEN 'stale'
        ELSE 'current'
      END,
      jsonb_build_object(
        'kind', kind,
        'role', role,
        'entryPoints', to_jsonb(entry_points),
        'flowSummary', flow_summary,
        'notes', notes
      ),
      role,
      entry_points,
      flow_summary,
      notes,
      token_estimate,
      provenance_run_id,
      CASE WHEN kind = 'vuln' THEN 'legacy_generic_vulnerability_schema' END
    FROM contract_bundles
    ON CONFLICT DO NOTHING;

    INSERT INTO contract_bundle_addresses (codehash, address)
    SELECT DISTINCT codehash, unnest(addresses)
    FROM contract_bundles
    ON CONFLICT DO NOTHING;
  END IF;
END
$migration$;

CREATE TABLE IF NOT EXISTS agent_jobs (
  id TEXT PRIMARY KEY,
  job_type TEXT NOT NULL CHECK (
    job_type IN ('catalog', 'parent-turn', 'contract-analysis', 'evidence')
  ),
  status TEXT NOT NULL CHECK (
    status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')
  ),
  project TEXT,
  incident TEXT,
  kind TEXT CHECK (kind IS NULL OR kind IN ('mev', 'vuln')),
  parent_job_id TEXT REFERENCES agent_jobs(id) ON DELETE SET NULL,
  correlation_id TEXT,
  job_key TEXT NOT NULL,
  job_version INTEGER NOT NULL DEFAULT 1 CHECK (job_version > 0),
  request JSONB NOT NULL DEFAULT '{}'::JSONB,
  result JSONB,
  error_class TEXT,
  error_message TEXT,
  cancellation_requested BOOLEAN NOT NULL DEFAULT false,
  lease_owner TEXT,
  lease_expires_at TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_jobs_dedup_idx
  ON agent_jobs (job_key);
CREATE INDEX IF NOT EXISTS agent_jobs_recovery_idx
  ON agent_jobs (status, lease_expires_at, created_at);
CREATE INDEX IF NOT EXISTS agent_jobs_parent_idx ON agent_jobs (parent_job_id);

CREATE TABLE IF NOT EXISTS agent_job_events (
  cursor BIGSERIAL PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES agent_jobs(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  data JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_job_events_replay_idx
  ON agent_job_events (job_id, cursor);
`;
