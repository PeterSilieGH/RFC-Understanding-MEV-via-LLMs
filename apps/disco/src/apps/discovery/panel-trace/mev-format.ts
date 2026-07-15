// DIVERGENCE(mev): new file. Shared MEV display helpers (labels + amount
// formatting), used by the TopBar incident identity and the trace details
// panel. Extracted from the removed TraceMevStrip.
import type { FormattedAmount } from '../../../api/traces'

export const MEV_LABELS: Record<string, string> = {
  arbitrage: 'arbitrage',
  sandwich_frontrun: 'sandwich front-run',
  sandwich_backrun: 'sandwich back-run',
  sandwiched_victim: 'sandwich victim',
  liquidation: 'liquidation',
  nft_trade: 'NFT trade',
  punk_snipe: 'punk snipe',
  jit_liquidity_add: 'JIT liquidity add',
  jit_liquidity_remove: 'JIT liquidity remove',
  non_atomic_arbitrage_open: 'non-atomic arb (open)',
  non_atomic_arbitrage_close: 'non-atomic arb (close)',
  liquidation_sandwich_setup: 'liquidation sandwich (setup)',
  liquidation_sandwich_liquidate: 'liquidation sandwich',
  liquidation_sandwich_reverse: 'liquidation sandwich (reverse)',
  liquidation_race_won: 'liquidation race won',
  liquidation_race_lost: 'liquidation race lost',
  nft_flip_buy: 'NFT flip (buy)',
  nft_flip_sell: 'NFT flip (sell)',
}

export function fmtAmount(amount: FormattedAmount): string {
  const value = amount.value.toLocaleString('en-US', {
    maximumFractionDigits: 4,
  })
  return `${value} ${amount.symbol}`
}
