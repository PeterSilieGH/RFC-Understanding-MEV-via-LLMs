// DIVERGENCE(mev): new file (ADR-009; generalized in the settings amendment).
// A reusable agent-model picker. It lists the models available to agent-api
// (those with a working credential in the pi agent dir) and is driven by an
// external value/onChange, so Global app settings can mount two of them — one
// for Analyze, one for Incident reporting. Seeds its value from the agent-api
// settings default (project .pi/settings.json over global) the first time
// models load; react-query caches the fetch, so mounting several shares it.
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { type AgentModelRef, getAgentModels } from '../../../api/agent'
import { Select } from '../../../components/Select'
import { modelKey } from '../panel-agent/model-store'

export function AgentModelSelect({
  label,
  title,
  value,
  onChange,
}: {
  label: string
  title: string
  value: AgentModelRef | undefined
  onChange: (model: AgentModelRef | undefined) => void
}) {
  const modelsResponse = useQuery({
    queryKey: ['agent-models'],
    queryFn: getAgentModels,
    staleTime: 5 * 60_000,
  })

  const models = modelsResponse.data?.models ?? []
  const defaultRef = modelsResponse.data?.default ?? undefined

  // Seed this picker from the settings default the first time models load.
  useEffect(() => {
    if (!value && defaultRef) onChange(defaultRef)
  }, [value, defaultRef, onChange])

  const selectedKey = value ? modelKey(value) : undefined

  const handleChange = (key: string) => {
    const model = models.find((m) => modelKey(m) === key)
    if (model) onChange({ provider: model.provider, id: model.id })
  }

  if (modelsResponse.isError) {
    return (
      <div className="flex items-center gap-2 font-light text-sm">
        <span className="w-40">{label}</span>
        <span className="text-aux-red text-xs" title="agent-api unreachable">
          agent-api unreachable
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-2 font-light text-sm" title={title}>
      <span className="w-40">{label}</span>
      <Select.Root
        value={selectedKey}
        onValueChange={handleChange}
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
