// DIVERGENCE(mev): ADR-012 §6. Explicit user action runs the grounded config
// enrichment prompt, then writes through disco-api's normal config/template
// endpoints. Resulting descriptions and permissions render through the stock
// Values components after the existing query invalidation path refreshes.
import { useRef, useState } from 'react'
import { streamValueEnrichment } from '../../../api/agent'
import { Button } from '../../../components/Button'
import { Loader } from '../../../components/Loader'
import { buildCodeContext, buildValueContext } from '../utils/panelContext'
import { useAgentModelStore } from '../panel-agent/model-store'
import { useConfigModels } from '../hooks/useConfigModels'

export function ValueConfigEnrichment(props: {
  project: string
  address: string
}) {
  const models = useConfigModels()
  const model = useAgentModelStore((state) => state.analyzeModel)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | undefined>(undefined)
  if (!models.canModify) return null

  async function enrich() {
    if (running) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setError(null)
    try {
      const [codeContext, valueContext] = await Promise.all([
        buildCodeContext(props.project, [props.address]),
        buildValueContext(props.project, [props.address]),
      ])
      const stream = streamValueEnrichment(
        {
          project: props.project,
          address: props.address,
          config: models.configModel.files.config,
          template: models.templateModel.hasTemplate
            ? models.templateModel.files.template
            : undefined,
          codeContext,
          valueContext,
          model,
        },
        controller.signal,
      )
      for await (const event of stream) {
        if (event.type === 'enrichment') {
          models.configModel.save(event.config)
          if (event.template && models.templateModel.hasTemplate) {
            models.templateModel.save(event.template)
          }
        } else if (event.type === 'error') setError(event.message)
      }
    } catch (err) {
      if (!controller.signal.aborted) setError((err as Error).message)
    } finally {
      if (!controller.signal.aborted) setRunning(false)
    }
  }

  return (
    <div className="flex items-center gap-2 px-5 pb-2">
      <Button size="small" disabled={running} onClick={() => void enrich()}>
        {running ? 'Enriching config…' : 'Enrich descriptions & permissions'}
      </Button>
      {running && <Loader />}
      {error && <span className="text-aux-red text-xs">{error}</span>}
    </div>
  )
}
