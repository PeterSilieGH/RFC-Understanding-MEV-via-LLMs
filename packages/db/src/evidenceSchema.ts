/**
 * Shared, snapshot-addressed evidence tables (ADR-016).
 *
 * Large or byte-sensitive bodies are kept in one content-addressed blob table.
 * Snapshot mappings always include the block hash, so a reorg creates a new
 * mapping instead of silently changing the evidence associated with an old
 * snapshot.
 */
export const EVIDENCE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS evidence_blobs (
  content_hash TEXT PRIMARY KEY,
  media_type TEXT NOT NULL,
  body BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT evidence_blobs_hash_format
    CHECK (content_hash ~ '^sha256:[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS evidence_code_artifacts (
  runtime_codehash VARCHAR(66) PRIMARY KEY,
  bytecode_content_hash TEXT NOT NULL REFERENCES evidence_blobs(content_hash),
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS evidence_snapshot_deployments (
  chain_id NUMERIC NOT NULL,
  block_number NUMERIC NOT NULL,
  block_hash VARCHAR(66) NOT NULL,
  address VARCHAR(42) NOT NULL,
  runtime_codehash VARCHAR(66) NOT NULL REFERENCES evidence_code_artifacts(runtime_codehash),
  producer TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  completeness TEXT NOT NULL CHECK (completeness IN ('complete', 'partial')),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, block_hash, address)
);
CREATE INDEX IF NOT EXISTS evidence_snapshot_deployments_number_idx
  ON evidence_snapshot_deployments (chain_id, block_number, address);
CREATE INDEX IF NOT EXISTS evidence_snapshot_deployments_codehash_idx
  ON evidence_snapshot_deployments (runtime_codehash);

CREATE TABLE IF NOT EXISTS evidence_contract_relations (
  chain_id NUMERIC NOT NULL,
  block_number NUMERIC NOT NULL,
  block_hash VARCHAR(66) NOT NULL,
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42) NOT NULL,
  relation_kind TEXT NOT NULL CHECK (relation_kind IN ('implementation', 'beacon', 'facet')),
  producer TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, block_hash, from_address, to_address, relation_kind)
);

CREATE TABLE IF NOT EXISTS evidence_source_artifacts (
  runtime_codehash VARCHAR(66) NOT NULL REFERENCES evidence_code_artifacts(runtime_codehash),
  provider TEXT NOT NULL,
  provider_revision TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('verified', 'unverified', 'error')),
  source_content_hash TEXT REFERENCES evidence_blobs(content_hash),
  abi JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  error_class TEXT,
  retry_after TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (runtime_codehash, provider, provider_revision),
  CONSTRAINT evidence_source_verified_body
    CHECK (status <> 'verified' OR source_content_hash IS NOT NULL),
  CONSTRAINT evidence_source_failure_fields
    CHECK (status = 'verified' OR error_class IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS evidence_source_retry_idx
  ON evidence_source_artifacts (retry_after)
  WHERE status <> 'verified';

CREATE TABLE IF NOT EXISTS evidence_token_metadata (
  chain_id NUMERIC NOT NULL,
  block_number NUMERIC NOT NULL,
  block_hash VARCHAR(66) NOT NULL,
  token_address VARCHAR(42) NOT NULL,
  runtime_codehash VARCHAR(66) NOT NULL REFERENCES evidence_code_artifacts(runtime_codehash),
  status TEXT NOT NULL CHECK (status IN ('resolved', 'unavailable', 'error')),
  symbol TEXT,
  name TEXT,
  decimals INTEGER CHECK (decimals >= 0 AND decimals <= 255),
  producer TEXT NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  completeness TEXT NOT NULL CHECK (completeness IN ('complete', 'partial')),
  error_class TEXT,
  retry_after TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, block_hash, token_address, runtime_codehash),
  CONSTRAINT evidence_token_resolved_fields
    CHECK (status <> 'resolved' OR decimals IS NOT NULL),
  CONSTRAINT evidence_token_failure_fields
    CHECK (status = 'resolved' OR error_class IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS evidence_token_metadata_lookup_idx
  ON evidence_token_metadata (chain_id, token_address, runtime_codehash);

CREATE TABLE IF NOT EXISTS evidence_decompilation_artifacts (
  runtime_codehash VARCHAR(66) NOT NULL REFERENCES evidence_code_artifacts(runtime_codehash),
  engine TEXT NOT NULL,
  engine_revision TEXT NOT NULL,
  options_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('complete', 'partial', 'timeout', 'unsupported', 'error')),
  pseudocode_content_hash TEXT REFERENCES evidence_blobs(content_hash),
  function_index JSONB NOT NULL DEFAULT '[]'::JSONB,
  failed_functions JSONB NOT NULL DEFAULT '[]'::JSONB,
  warnings JSONB NOT NULL DEFAULT '[]'::JSONB,
  duration_ms INTEGER CHECK (duration_ms IS NULL OR duration_ms >= 0),
  output_hash TEXT,
  error_class TEXT,
  retry_after TIMESTAMPTZ,
  attempt_count INTEGER NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (runtime_codehash, engine, engine_revision, options_hash),
  CONSTRAINT evidence_decompilation_output
    CHECK (status NOT IN ('complete', 'partial') OR pseudocode_content_hash IS NOT NULL),
  CONSTRAINT evidence_decompilation_failure
    CHECK (status IN ('complete', 'partial') OR error_class IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS evidence_decompilation_retry_idx
  ON evidence_decompilation_artifacts (retry_after)
  WHERE status NOT IN ('complete', 'partial');

CREATE TABLE IF NOT EXISTS evidence_execution_artifacts (
  chain_id NUMERIC NOT NULL,
  block_number NUMERIC NOT NULL,
  block_hash VARCHAR(66) NOT NULL,
  transaction_hash VARCHAR(66) NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  producer TEXT NOT NULL,
  completeness TEXT NOT NULL CHECK (completeness IN ('complete', 'partial')),
  capabilities JSONB NOT NULL DEFAULT '[]'::JSONB,
  calls JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, block_hash, transaction_hash, schema_version, producer)
);
CREATE INDEX IF NOT EXISTS evidence_execution_tx_idx
  ON evidence_execution_artifacts (chain_id, transaction_hash, schema_version);

CREATE TABLE IF NOT EXISTS evidence_flow_artifacts (
  chain_id NUMERIC NOT NULL,
  block_number NUMERIC NOT NULL,
  block_hash VARCHAR(66) NOT NULL,
  transaction_hash VARCHAR(66) NOT NULL,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  producer TEXT NOT NULL,
  completeness TEXT NOT NULL CHECK (completeness IN ('complete', 'partial')),
  movements JSONB NOT NULL,
  content_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (chain_id, block_hash, transaction_hash, schema_version, producer)
);
CREATE INDEX IF NOT EXISTS evidence_flow_tx_idx
  ON evidence_flow_artifacts (chain_id, transaction_hash, schema_version);
`;
