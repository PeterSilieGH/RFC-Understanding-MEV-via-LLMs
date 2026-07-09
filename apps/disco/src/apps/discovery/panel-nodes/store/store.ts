import { createContext, useContext } from 'react'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Actions } from './actions/Actions'
import { applyStoredLayout } from './actions/applyStoredLayout'
import { redo, undo } from './actions/history'
import { loadNodes } from './actions/loadNodes'
import { onKeyDown } from './actions/onKeyDown'
import { onKeyUp } from './actions/onKeyUp'
import { onMouseDown } from './actions/onMouseDown'
import { onMouseMove } from './actions/onMouseMove'
import { onMouseUp } from './actions/onMouseUp'
import { onWheel } from './actions/onWheel'
import {
  clear,
  colorSelected,
  hideSelected,
  hideUnreachable,
  layout,
  setPreferences,
  showHidden,
  showUnreachable,
} from './actions/other'
import { registerViewportContainer } from './actions/registerViewportContainer'
import { selectAndFocus } from './actions/selectAndFocus'
import { setNodes } from './actions/setNodes'
import type { State } from './State'
import {
  captureHistorySnapshot,
  emptyHistoryState,
  pushHistorySnapshot,
  snapshotsEqual,
} from './utils/history'
import { persistNodeLayout } from './utils/storage'

type StoreState = State & Actions
type StoreSetter = (cb: (state: StoreState) => Partial<State>) => void

const INITIAL_STATE: State = {
  selected: [],
  hidden: [],
  nodes: [],
  history: emptyHistoryState(),
  transform: { offsetX: 0, offsetY: 0, scale: 1 },
  viewportContainer: undefined,
  input: {
    shiftPressed: false,
    spacePressed: false,
    ctrlPressed: false,
    lmbPressed: false,
    mmbPressed: false,
    mouseStartX: 0,
    mouseStartY: 0,
    mouseX: 0,
    mouseY: 0,
  },
  mouseUpAction: undefined,
  mouseMoveAction: undefined,
  selection: undefined,
  positionsBeforeMove: {},
  projectId: '',
  userPreferences: {
    enableDimming: true,
    hideLargeArrays: true,
    highlightOverlapping: true,
    useExperimentalRenderer: false,
  },
  loaded: false,
}

// DIVERGENCE(mev): upstream exports a single zustand store here. We turn it
// into a factory with two instances - the discovery nodes panel and the
// trace panel each get their own graph state - resolved through context.
// `useStore(selector)` keeps its original call signature, so the ~20
// upstream consumer files stay unmodified; only call sites that used the
// store statically (useStore.getState/subscribe) switched to useStoreApi().
export function createNodesStore(name: string) {
  const store = create<StoreState>()(
    persist(
      (set) => ({
      ...INITIAL_STATE,
      loadNodes: wrapHistoryResetAction(set, loadNodes),
      setNodes: wrapUndoableAction(set, setNodes),
      colorSelected: wrapUndoableAction(set, colorSelected),
      undo: wrapAction(set, undo),
      redo: wrapAction(set, redo),
      hideSelected: wrapUndoableAction(set, hideSelected),
      hideUnreachable: wrapUndoableAction(set, hideUnreachable),
      showUnreachable: wrapUndoableAction(set, showUnreachable),
      showHidden: wrapUndoableAction(set, showHidden),
      clear: wrapHistoryResetAction(set, clear),
      layout: wrapUndoableAction(set, layout),
      applyStoredLayout: wrapAction(set, applyStoredLayout),
      selectAndFocus: wrapAction(set, selectAndFocus),
      registerViewportContainer: wrapAction(set, registerViewportContainer),
      setPreferences: wrapAction(set, setPreferences),

      onKeyDown: wrapUndoableAction(set, onKeyDown),
      onKeyUp: wrapAction(set, onKeyUp),
      onMouseDown: wrapHistoryStartAction(set, onMouseDown),
      onMouseUp: wrapHistoryEndAction(set, onMouseUp),
      onMouseMove: wrapAction(set, onMouseMove),
      onWheel: wrapAction(set, onWheel),
    }),
      {
        // You can update the key if changes are backwards incompatible
        name,
        partialize: (state) => {
          return {
            projectId: state.projectId,
            nodes: state.nodes,
            hidden: state.hidden,
            userPreferences: state.userPreferences,
          }
        },
      },
    ),
  )

  let timeout: ReturnType<typeof setTimeout>
  store.subscribe((state) => {
    clearTimeout(timeout)
    timeout = setTimeout(() => {
      persistNodeLayout(state)
    }, 50)
  })

  return store
}

export type NodesStore = ReturnType<typeof createNodesStore>

export const discoveryNodesStore = createNodesStore('store-v4')
export const traceNodesStore = createNodesStore('trace-store-v1')

const NodesStoreContext = createContext<NodesStore>(discoveryNodesStore)
export const NodesStoreProvider = NodesStoreContext.Provider

/** The store instance the surrounding panel put in context (for static access). */
export function useStoreApi(): NodesStore {
  return useContext(NodesStoreContext)
}

export function useStore<T>(selector: (state: StoreState) => T): T {
  return useStoreApi()(selector)
}

function wrapAction<A extends unknown[]>(
  set: StoreSetter,
  action: (state: State, ...args: A) => Partial<State>,
): (...args: A) => void {
  return wrapWithReducer(set, (state, ...args) => action(state, ...args))
}

function wrapUndoableAction<A extends unknown[]>(
  set: StoreSetter,
  action: (state: State, ...args: A) => Partial<State>,
): (...args: A) => void {
  return wrapWithReducer(set, (state, ...args) => {
    const before = captureHistorySnapshot(state)
    const partial = action(state, ...args)

    if (state.history.pending) {
      return partial
    }

    const after = captureHistorySnapshot(mergeState(state, partial))
    if (snapshotsEqual(before, after)) {
      return partial
    }

    return {
      ...partial,
      history: pushHistorySnapshot(state.history, before),
    }
  })
}

function wrapHistoryResetAction<A extends unknown[]>(
  set: StoreSetter,
  action: (state: State, ...args: A) => Partial<State>,
): (...args: A) => void {
  return wrapWithReducer(set, (state, ...args) => ({
    ...action(state, ...args),
    history: emptyHistoryState(),
  }))
}

function wrapHistoryStartAction<A extends unknown[]>(
  set: StoreSetter,
  action: (state: State, ...args: A) => Partial<State>,
): (...args: A) => void {
  return wrapWithReducer(set, (state, ...args) => {
    const partial = action(state, ...args)
    const nextState = mergeState(state, partial)

    if (
      !isUndoableMouseAction(state.mouseMoveAction) &&
      isUndoableMouseAction(nextState.mouseMoveAction)
    ) {
      return {
        ...partial,
        history: {
          ...state.history,
          pending: captureHistorySnapshot(state),
        },
      }
    }

    return partial
  })
}

function wrapHistoryEndAction<A extends unknown[]>(
  set: StoreSetter,
  action: (state: State, ...args: A) => Partial<State>,
): (...args: A) => void {
  return wrapWithReducer(set, (state, ...args) => {
    const partial = action(state, ...args)
    const pending = state.history.pending

    if (!pending) {
      return partial
    }

    if (!isUndoableMouseAction(state.mouseMoveAction)) {
      return {
        ...partial,
        history: clearPendingSnapshot(state.history),
      }
    }

    const after = captureHistorySnapshot(mergeState(state, partial))
    if (snapshotsEqual(pending, after)) {
      return {
        ...partial,
        history: clearPendingSnapshot(state.history),
      }
    }

    return {
      ...partial,
      history: pushHistorySnapshot(state.history, pending),
    }
  })
}

function wrapWithReducer<A extends unknown[]>(
  set: StoreSetter,
  reducer: (state: StoreState, ...args: A) => Partial<State>,
): (...args: A) => void {
  return (...args: A) => set((state) => reducer(state, ...args))
}

function mergeState(state: StoreState, partial: Partial<State>): StoreState {
  return {
    ...state,
    ...partial,
  }
}

function clearPendingSnapshot(history: State['history']): State['history'] {
  return {
    past: history.past,
    future: history.future,
  }
}

function isUndoableMouseAction(
  action: State['mouseMoveAction'],
): action is 'drag' | 'resize-node' {
  return action === 'drag' || action === 'resize-node'
}
