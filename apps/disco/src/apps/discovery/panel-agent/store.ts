// DIVERGENCE(mev): new file. Which analyze skills have covered which node
// addresses, per project (ADR-009) — drives the two node ticks and the panel's
// "already analyzed" hints. Hydrated from GET /api/agent/runs and updated
// optimistically when a run finishes. Addresses are stored plain-lowercase
// (agent-api normalizes them that way), so node.address.toLowerCase() matches
// on both the dependency graph (eth:0x…) and the trace graph (0x…).
import { create } from 'zustand'
import { getAgentRuns } from '../../../api/agent'

interface ProjectMarks {
  code: string[]
  value: string[]
  // DIVERGENCE(mev): addresses the build-verdict skill flagged as important
  // but not yet analyzed (ADR-009). Distinct from code/value coverage.
  important: string[]
}

interface State {
  byProject: Record<string, ProjectMarks>
  hydrate: (project: string) => Promise<void>
  addMarks: (
    project: string,
    skill: 'analyze-code' | 'analyze-value',
    addresses: string[],
  ) => void
  setImportant: (project: string, addresses: string[]) => void
}

const EMPTY: ProjectMarks = { code: [], value: [], important: [] }

function union(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b.map((x) => x.toLowerCase())])]
}

export const useAgentMarksStore = create<State>()((set) => ({
  byProject: {},
  hydrate: async (project) => {
    const { runs } = await getAgentRuns(project)
    const code: string[] = []
    const value: string[] = []
    // Newest build-verdict run wins for the "important" flags (runs are newest
    // first): later verdicts supersede earlier ones rather than accumulating.
    let important: string[] | undefined
    for (const run of runs) {
      if (run.skill === 'analyze-code') code.push(...run.addresses)
      else if (run.skill === 'analyze-value') value.push(...run.addresses)
      else if (run.skill === 'build-preview' && important === undefined) {
        important = run.addresses
      }
    }
    set((s) => ({
      byProject: {
        ...s.byProject,
        [project]: {
          code: union([], code),
          value: union([], value),
          important: union([], important ?? []),
        },
      },
    }))
  },
  addMarks: (project, skill, addresses) =>
    set((s) => {
      const current = s.byProject[project] ?? EMPTY
      const key = skill === 'analyze-code' ? 'code' : 'value'
      return {
        byProject: {
          ...s.byProject,
          [project]: { ...current, [key]: union(current[key], addresses) },
        },
      }
    }),
  // A verdict run replaces the prior important set for the project (the model
  // re-derives it from the current transcripts every time).
  setImportant: (project, addresses) =>
    set((s) => {
      const current = s.byProject[project] ?? EMPTY
      return {
        byProject: {
          ...s.byProject,
          [project]: { ...current, important: union([], addresses) },
        },
      }
    }),
}))

export function marksFor(
  state: State,
  project: string | undefined,
): ProjectMarks {
  return (project && state.byProject[project]) || EMPTY
}
