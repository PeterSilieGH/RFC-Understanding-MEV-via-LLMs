// DIVERGENCE(mev): ADR-012 value-pane enrichment. The durable, grounded bundle
// summaries are shown beside discovery's config/template-derived descriptions
// and permissions. Config remains the authority; these notes are visibly
// provenance-labelled agent enrichment and never masquerade as observed state.
import { useMemo } from 'react'
import { useAgentMarksStore } from '../panel-agent/store'
import { Folder } from './Folder'

export function BundleEnrichment(props: { project: string; address: string }) {
  const plain = props.address.replace(/^[a-z]+:/i, '').toLowerCase()
  // Select the stored array itself so useSyncExternalStore sees a stable
  // snapshot; deriving a fresh `.filter()` result inside the Zustand selector
  // causes React error #185 (an infinite subscription render loop).
  const projectBundles = useAgentMarksStore(
    (state) => state.byProject[props.project]?.bundles,
  )
  const bundles = useMemo(
    () =>
      (projectBundles ?? []).filter((bundle) =>
        bundle.addresses.includes(plain),
      ),
    [projectBundles, plain],
  )
  if (bundles.length === 0) return null
  return (
    <Folder title="Agent enrichment">
      <div className="flex flex-col gap-3 bg-coffee-900 px-5 py-3 text-sm">
        {bundles.map((bundle) => (
          <section key={`${bundle.codehash}:${bundle.kind}`} className="flex flex-col gap-1">
            <span className="font-bold text-aux-orange text-xs uppercase">
              {bundle.kind === 'mev' ? 'MEV' : 'Vulnerability'} · {bundle.role}
            </span>
            <p className="text-coffee-200">{bundle.flowSummary}</p>
            <p className="text-coffee-300">{bundle.notes}</p>
            {bundle.entryPoints.length > 0 && (
              <p className="font-mono text-coffee-400 text-xs">
                Entry points: {bundle.entryPoints.join(', ')}
              </p>
            )}
            <span className="text-coffee-500 text-[10px]">
              Grounded bundle · run {bundle.provenanceRunId ?? 'unknown'} · {bundle.codehash.slice(0, 12)}…
            </span>
          </section>
        ))}
      </div>
    </Folder>
  )
}
