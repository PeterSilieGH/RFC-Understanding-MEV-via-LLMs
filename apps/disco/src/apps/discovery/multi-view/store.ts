import { createContext, useContext } from 'react'
import {
  createDockingStore,
  nextAvailableKey,
} from '../../../components/docking'
import {
  dockingConfig,
  isAllowedPanel,
  PANEL_IDS,
  traceDockingConfig,
} from './config'

export const useDockingStore = createDockingStore(dockingConfig)

// DIVERGENCE(mev): the trace workspace (ADR-008) is a second docked view over
// the same panel catalog with its own persisted layouts. MultiView and the
// bars resolve "their" store through this context so both pages reuse them
// unmodified; the discovery store stays the default.
export const useTraceDockingStore = createDockingStore(traceDockingConfig)

export type DockingStoreHook = typeof useDockingStore

const DockingStoreContext = createContext<DockingStoreHook>(useDockingStore)
export const DockingStoreProvider = DockingStoreContext.Provider

export function useActiveDockingStore(): DockingStoreHook {
  return useContext(DockingStoreContext)
}

// Opening "the next panel" is catalog logic: it depends on the set of panel
// kinds, which lives here, not in the generic layout.
export function addPanel(useStore: DockingStoreHook = useDockingStore): void {
  const state = useStore.getState()
  const next = nextAvailableKey(state.tree, PANEL_IDS.filter(isAllowedPanel))
  if (next) state.ensureLeaf(next)
}

export type { PanelId } from './config'
export { PANEL_IDS } from './config'
