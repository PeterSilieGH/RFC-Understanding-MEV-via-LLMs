// DIVERGENCE(mev): new file (ADR-009). Top-bar model picker — lists the models
// available to agent-api (those with a working credential in the pi agent dir)
// and selects the one used for analyze / verdict runs. Seeds from the agent-api
// settings default (project .pi/settings.json over global) on first load; the
// choice persists across reloads via the model store.
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { getAgentModels } from '../../../api/agent'
import { Select } from '../../../components/Select'
import { modelKey, useAgentModelStore } from '../panel-agent/model-store'

export function ModelSelect() {
  const selected = useAgentModelStore((s) => s.selected)
  const setSelected = useAgentModelStore((s) => s.setSelected)

  const modelsResponse = useQuery({
    queryKey: ['agent-models'],
    queryFn: getAgentModels,
    staleTime: 5 * 60_000,
  })

  const models = modelsResponse.data?.models ?? []
  const defaultRef = modelsResponse.data?.default ?? undefined

  // Seed the picker from the settings default the first time models load.
  useEffect(() => {
    if (!selected && defaultRef) setSelected(defaultRef)
  }, [selected, defaultRef, setSelected])

  const value = selected ? modelKey(selected) : undefined

  const onChange = (key: string) => {
    const model = models.find((m) => modelKey(m) === key)
    if (model) setSelected({ provider: model.provider, id: model.id })
  }

  if (modelsResponse.isError) {
    return (
      <div className="flex items-center text-aux-red text-xs" title="agent-api unreachable">
        model: n/a
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1" title="Model for Analyze / verdict runs">
      <span className="text-coffee-400 text-xs max-lg:hidden">Model</span>
      <Select.Root
        value={value}
        onValueChange={onChange}
        disabled={models.length === 0}
      >
        <Select.Trigger
          placeholder={modelsResponse.isFetching ? 'Loading…' : 'Select model'}
        />
        <Select.Content>
          {models.map((m) => (
            <Select.Item key={modelKey(m)} value={modelKey(m)}>
              {m.label}
            </Select.Item>
          ))}
        </Select.Content>
      </Select.Root>
    </div>
  )
}
