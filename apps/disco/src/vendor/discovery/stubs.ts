// Loose stand-ins for deep @l2beat/discovery internals (blip expressions and
// the user-handler union) that the UI only touches as opaque values - vendoring
// the real chain would drag in the whole handler library. See ../README.md.
import { v, type Validator } from '@l2beat/validate'

export type BlipSexp = unknown

export function validateBlip(_blip: unknown): _blip is BlipSexp {
  return true
}

export type UserHandlerDefinition = { type: string } & Record<string, unknown>

export const UserHandlerDefinition = v.passthroughObject({
  type: v.string(),
}) as unknown as Validator<UserHandlerDefinition>
