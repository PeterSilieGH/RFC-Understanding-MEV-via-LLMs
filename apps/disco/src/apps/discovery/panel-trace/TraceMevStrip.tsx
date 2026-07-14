// DIVERGENCE(mev): new file. MEV badges for the traced transaction (M4):
// what the explorer's detectors found, with links that jump to the traces of
// related transactions (sandwich legs, JIT counterparts, race winners...).
import type { TxMev, TxMevEntry, FormattedAmount } from '../../../api/traces'

const MEV_LABELS: Record<string, string> = {
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

const COUNTERPART_LABELS: Record<string, string> = {
  sandwich_frontrun: 'back-run',
  sandwich_backrun: 'front-run',
  jit_liquidity_add: 'remove',
  jit_liquidity_remove: 'add',
  non_atomic_arbitrage_open: 'close',
  non_atomic_arbitrage_close: 'open',
  liquidation_sandwich_setup: 'liquidation',
  liquidation_sandwich_liquidate: 'setup swap',
  liquidation_sandwich_reverse: 'liquidation',
  nft_flip_buy: 'sell',
  nft_flip_sell: 'buy',
}

export function fmtAmount(amount: FormattedAmount): string {
  const value = amount.value.toLocaleString('en-US', {
    maximumFractionDigits: 4,
  })
  return `${value} ${amount.symbol}`
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…`
}

function relatedTxs(entry: TxMevEntry): { label: string; hash: string }[] {
  const related: { label: string; hash: string }[] = []
  if (entry.counterpartTxHash) {
    related.push({
      label: COUNTERPART_LABELS[entry.type] ?? 'counterpart',
      hash: entry.counterpartTxHash,
    })
  }
  for (const hash of entry.victimTxHashes ?? []) {
    related.push({ label: 'victim', hash })
  }
  if (entry.winnerTxHash) {
    related.push({ label: 'winner', hash: entry.winnerTxHash })
  }
  for (const hash of entry.loserTxHashes ?? []) {
    related.push({ label: 'loser', hash })
  }
  if (entry.reverseTxHash) {
    related.push({ label: 'reverse', hash: entry.reverseTxHash })
  }
  return related
}

// The explorer frontend triggers on-demand inspection when a block is opened;
// it runs on the same host (port is uniform across our deployments).
function explorerBlockUrl(blockNumber: number): string {
  return `http://${window.location.hostname}:8080/?block=${blockNumber}`
}

export function TraceMevStrip(props: {
  mev: TxMev | undefined
  isLoading: boolean
  onOpenTx: (hash: string) => void
}) {
  const { mev, isLoading, onOpenTx } = props
  if (isLoading) {
    return (
      <p className="border-coffee-600 border-b p-2 text-coffee-400 text-xs">
        Loading MEV facts…
      </p>
    )
  }
  if (!mev) {
    return null
  }

  if (!mev.inspected) {
    return (
      <p className="border-coffee-600 border-b p-2 text-aux-yellow text-xs">
        Block {mev.blockNumber ?? '?'} has not been inspected - no MEV facts
        yet.{' '}
        {mev.blockNumber !== null && (
          <a
            href={explorerBlockUrl(mev.blockNumber)}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-coffee-100"
          >
            Open it in the explorer to inspect.
          </a>
        )}
      </p>
    )
  }

  const entries = mev.transaction?.mev ?? []
  const swapCount = mev.transaction?.swaps.length ?? 0
  if (entries.length === 0 && swapCount === 0) {
    return (
      <p className="border-coffee-600 border-b p-2 text-coffee-400 text-xs">
        Block {mev.blockNumber}: no MEV detected in this transaction.
      </p>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-2 border-coffee-600 border-b p-2 text-xs">
      {entries.map((entry, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: entries are static per tx
          key={`${entry.type}-${i}`}
          className="flex items-center gap-1.5 rounded bg-coffee-600 px-2 py-0.5 text-coffee-100"
        >
          <span className="font-bold uppercase">
            {MEV_LABELS[entry.type] ?? entry.type}
          </span>
          {entry.profit && (
            <span
              className={entry.profit.value < 0 ? 'text-aux-red' : 'text-aux-green'}
            >
              {fmtAmount(entry.profit)}
            </span>
          )}
          {relatedTxs(entry).map((related) => (
            <button
              key={`${related.label}-${related.hash}`}
              type="button"
              title={`Load the trace of ${related.hash}`}
              onClick={() => onOpenTx(related.hash)}
              className="font-mono text-coffee-200 underline hover:text-coffee-100"
            >
              {related.label}: {shortHash(related.hash)}
            </button>
          ))}
        </span>
      ))}
      {swapCount > 0 && (
        <span className="rounded bg-coffee-700 px-2 py-0.5 text-coffee-300">
          {swapCount} decoded swap{swapCount === 1 ? '' : 's'} highlighted
        </span>
      )}
    </div>
  )
}
