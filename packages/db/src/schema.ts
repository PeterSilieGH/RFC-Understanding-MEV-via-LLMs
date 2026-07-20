// Ownership of the MEV pipeline schema (ADR-010). These tables were previously
// created by mev-inspect-py's Alembic migrations; the native TypeScript
// inspector (@mev/inspect) now owns them. The DDL below is reproduced verbatim
// from the shape mev-inspect-py created (dumped from a live populated database)
// so `CREATE TABLE IF NOT EXISTS` is an exact no-op on volumes that still hold
// rows written by the retired Python tool. New deployments get the same schema.
//
// Deliberately NOT recreated (dead weight the explorer never reads): the broken
// USD-summary tables `mev_summary` / `latest_block_update`, the Python price
// cache `prices` / `tokens`, and the dropped `punk_*` tables (ADR-010).
//
// Quirks preserved for compatibility: `liquidations.trace_address` and
// `nft_trades.trace_address` are VARCHAR (mev-inspect-py stored them as the
// stringified list), while every other table uses INTEGER[].

/** Core decode/classify/pattern-match tables (the mev-inspect-py surface). */
export const PIPELINE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS blocks (
  block_number NUMERIC PRIMARY KEY,
  block_timestamp TIMESTAMP NOT NULL
);

CREATE TABLE IF NOT EXISTS classified_traces (
  classified_at TIMESTAMP DEFAULT now(),
  transaction_hash VARCHAR(66) NOT NULL,
  block_number NUMERIC NOT NULL,
  classification VARCHAR(256) NOT NULL,
  trace_type VARCHAR(256) NOT NULL,
  protocol VARCHAR(256),
  abi_name VARCHAR(1024),
  function_name VARCHAR(2048),
  function_signature VARCHAR(2048),
  inputs JSON,
  from_address VARCHAR(256),
  to_address VARCHAR(256),
  gas NUMERIC,
  value NUMERIC,
  gas_used NUMERIC,
  error VARCHAR(256),
  trace_address INTEGER[] NOT NULL,
  transaction_position NUMERIC,
  PRIMARY KEY (block_number, transaction_hash, trace_address)
);

CREATE TABLE IF NOT EXISTS transfers (
  created_at TIMESTAMP DEFAULT now(),
  block_number NUMERIC NOT NULL,
  transaction_hash VARCHAR(66) NOT NULL,
  trace_address INTEGER[] NOT NULL,
  protocol VARCHAR(256),
  from_address VARCHAR(256) NOT NULL,
  to_address VARCHAR(256) NOT NULL,
  token_address VARCHAR(256) NOT NULL,
  amount NUMERIC NOT NULL,
  error VARCHAR(256),
  PRIMARY KEY (block_number, transaction_hash, trace_address)
);

CREATE TABLE IF NOT EXISTS swaps (
  created_at TIMESTAMP DEFAULT now(),
  abi_name VARCHAR(1024) NOT NULL,
  transaction_hash VARCHAR(66) NOT NULL,
  block_number NUMERIC NOT NULL,
  protocol VARCHAR(256),
  contract_address VARCHAR(256) NOT NULL,
  from_address VARCHAR(256) NOT NULL,
  to_address VARCHAR(256) NOT NULL,
  token_in_address VARCHAR(256) NOT NULL,
  token_in_amount NUMERIC NOT NULL,
  token_out_address VARCHAR(256) NOT NULL,
  token_out_amount NUMERIC NOT NULL,
  trace_address INTEGER[] NOT NULL,
  error VARCHAR(256),
  transaction_position NUMERIC,
  PRIMARY KEY (block_number, transaction_hash, trace_address)
);

CREATE TABLE IF NOT EXISTS arbitrages (
  id VARCHAR(256) PRIMARY KEY,
  created_at TIMESTAMP DEFAULT now(),
  account_address VARCHAR(256) NOT NULL,
  profit_token_address VARCHAR(256) NOT NULL,
  block_number NUMERIC NOT NULL,
  transaction_hash VARCHAR(256) NOT NULL,
  start_amount NUMERIC NOT NULL,
  end_amount NUMERIC NOT NULL,
  profit_amount NUMERIC NOT NULL,
  error VARCHAR(256),
  protocols VARCHAR(256)[] DEFAULT '{}'::VARCHAR[]
);

CREATE TABLE IF NOT EXISTS arbitrage_swaps (
  created_at TIMESTAMP DEFAULT now(),
  arbitrage_id VARCHAR(1024) NOT NULL REFERENCES arbitrages(id) ON DELETE CASCADE,
  swap_transaction_hash VARCHAR(66) NOT NULL,
  swap_trace_address INTEGER[] NOT NULL,
  PRIMARY KEY (arbitrage_id, swap_transaction_hash, swap_trace_address)
);
CREATE INDEX IF NOT EXISTS arbitrage_swaps_swaps_idx
  ON arbitrage_swaps (swap_transaction_hash, swap_trace_address);

CREATE TABLE IF NOT EXISTS sandwiches (
  id VARCHAR(256) PRIMARY KEY,
  created_at TIMESTAMP DEFAULT now(),
  block_number NUMERIC NOT NULL,
  sandwicher_address VARCHAR(256) NOT NULL,
  frontrun_swap_transaction_hash VARCHAR(256) NOT NULL,
  frontrun_swap_trace_address INTEGER[] NOT NULL,
  backrun_swap_transaction_hash VARCHAR(256) NOT NULL,
  backrun_swap_trace_address INTEGER[] NOT NULL,
  profit_token_address VARCHAR(256),
  profit_amount NUMERIC
);
CREATE INDEX IF NOT EXISTS ik_sandwiches_frontrun
  ON sandwiches (block_number, frontrun_swap_transaction_hash, frontrun_swap_trace_address);
CREATE INDEX IF NOT EXISTS ik_sandwiches_backrun
  ON sandwiches (block_number, backrun_swap_transaction_hash, backrun_swap_trace_address);

CREATE TABLE IF NOT EXISTS sandwiched_swaps (
  created_at TIMESTAMP DEFAULT now(),
  sandwich_id VARCHAR(1024) NOT NULL REFERENCES sandwiches(id) ON DELETE CASCADE,
  block_number NUMERIC NOT NULL,
  transaction_hash VARCHAR(66) NOT NULL,
  trace_address INTEGER[] NOT NULL,
  PRIMARY KEY (sandwich_id, block_number, transaction_hash, trace_address)
);
CREATE INDEX IF NOT EXISTS ik_sandwiched_swaps_secondary
  ON sandwiched_swaps (block_number, transaction_hash, trace_address);

CREATE TABLE IF NOT EXISTS liquidations (
  created_at TIMESTAMP DEFAULT now(),
  liquidated_user VARCHAR(256) NOT NULL,
  liquidator_user VARCHAR(256) NOT NULL,
  debt_token_address VARCHAR(256) NOT NULL,
  debt_purchase_amount NUMERIC NOT NULL,
  received_amount NUMERIC NOT NULL,
  protocol VARCHAR(256),
  transaction_hash VARCHAR(66) NOT NULL,
  trace_address VARCHAR(256) NOT NULL,
  block_number NUMERIC NOT NULL,
  received_token_address VARCHAR(256),
  error VARCHAR(256),
  PRIMARY KEY (transaction_hash, trace_address)
);

CREATE TABLE IF NOT EXISTS nft_trades (
  created_at TIMESTAMP DEFAULT now(),
  abi_name VARCHAR(1024) NOT NULL,
  transaction_hash VARCHAR(66) NOT NULL,
  transaction_position NUMERIC NOT NULL,
  block_number NUMERIC NOT NULL,
  trace_address VARCHAR(256) NOT NULL,
  protocol VARCHAR(256) NOT NULL,
  error VARCHAR(256),
  seller_address VARCHAR(256) NOT NULL,
  buyer_address VARCHAR(256) NOT NULL,
  payment_token_address VARCHAR(256) NOT NULL,
  payment_amount NUMERIC NOT NULL,
  collection_address VARCHAR(256) NOT NULL,
  token_id NUMERIC NOT NULL,
  PRIMARY KEY (block_number, transaction_hash, trace_address)
);

CREATE TABLE IF NOT EXISTS miner_payments (
  created_at TIMESTAMP DEFAULT now(),
  block_number NUMERIC NOT NULL,
  transaction_hash VARCHAR(66) NOT NULL,
  transaction_index NUMERIC NOT NULL,
  miner_address VARCHAR(256) NOT NULL,
  coinbase_transfer NUMERIC NOT NULL,
  base_fee_per_gas NUMERIC NOT NULL,
  gas_price NUMERIC NOT NULL,
  gas_price_with_coinbase_transfer NUMERIC NOT NULL,
  gas_used NUMERIC NOT NULL,
  transaction_to_address VARCHAR(256),
  transaction_from_address VARCHAR(256),
  PRIMARY KEY (block_number, transaction_hash)
);
`;

// Custom detectors, previously computed post-hoc as SQL in explorer-api, now run
// in-pipeline and persisted (ADR-010). Every row carries block_number so a
// re-inspection can clear a block's rows before re-writing (matching the
// delete-by-block-range idempotency the core tables use). Profit/amount columns
// are NUMERIC (wei); raw string profits from the old detectors map cleanly.
export const DETECTOR_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS mev_jit_liquidity (
  block_number NUMERIC NOT NULL,
  sender VARCHAR(256) NOT NULL,
  mint_tx_hash VARCHAR(66) NOT NULL,
  decrease_tx_hash VARCHAR(66) NOT NULL,
  token0 VARCHAR(256) NOT NULL,
  token1 VARCHAR(256) NOT NULL,
  fee NUMERIC,
  swaps_between INTEGER NOT NULL,
  matching_pool_swaps INTEGER NOT NULL,
  PRIMARY KEY (block_number, mint_tx_hash, decrease_tx_hash)
);

CREATE TABLE IF NOT EXISTS mev_non_atomic_arbitrages (
  block_number NUMERIC NOT NULL,
  address VARCHAR(256) NOT NULL,
  first_tx_hash VARCHAR(66) NOT NULL,
  second_tx_hash VARCHAR(66) NOT NULL,
  token_address VARCHAR(256) NOT NULL,
  profit_amount NUMERIC NOT NULL,
  PRIMARY KEY (block_number, first_tx_hash, second_tx_hash, token_address)
);

CREATE TABLE IF NOT EXISTS mev_liquidation_sandwiches (
  block_number NUMERIC NOT NULL,
  liquidator VARCHAR(256) NOT NULL,
  liquidation_tx_hash VARCHAR(66) NOT NULL,
  setup_swap_tx_hash VARCHAR(66) NOT NULL,
  reverse_swap_tx_hash VARCHAR(66),
  PRIMARY KEY (block_number, liquidation_tx_hash)
);

CREATE TABLE IF NOT EXISTS mev_liquidation_races (
  block_number NUMERIC NOT NULL,
  borrower VARCHAR(256) NOT NULL,
  winner_tx_hash VARCHAR(66) NOT NULL,
  winner_address VARCHAR(256) NOT NULL,
  loser_tx_hashes VARCHAR(66)[] NOT NULL,
  PRIMARY KEY (block_number, borrower, winner_tx_hash)
);

CREATE TABLE IF NOT EXISTS mev_nft_flips (
  block_number NUMERIC NOT NULL,
  flipper VARCHAR(256) NOT NULL,
  collection_address VARCHAR(256) NOT NULL,
  token_id NUMERIC NOT NULL,
  buy_tx_hash VARCHAR(66) NOT NULL,
  sell_tx_hash VARCHAR(66) NOT NULL,
  profit_amount NUMERIC NOT NULL,
  profit_token_address VARCHAR(256) NOT NULL,
  PRIMARY KEY (block_number, buy_tx_hash, sell_tx_hash)
);
`;
