import type { DianzhiErrorShape } from '@/dianzhi/domain/errors'
import type { ToolTestUpdate } from '@/dianzhi/domain/protocol'

export type ToolTestStatus = 'idle' | 'validating' | 'streaming' | 'completed' | 'stopped' | 'error'

export interface ToolTestState {
  status: ToolTestStatus
  requestId: string | null
  content: string
  reasoningContent: string
  firstTokenMs: number | null
  totalMs: number | null
  error: DianzhiErrorShape | null
}

export const INITIAL_TOOL_TEST_STATE: ToolTestState = {
  status: 'idle',
  requestId: null,
  content: '',
  reasoningContent: '',
  firstTokenMs: null,
  totalMs: null,
  error: null,
}

export type ToolTestAction = ToolTestUpdate | { type: 'test.reset' }

const TERMINAL: readonly ToolTestStatus[] = ['completed', 'stopped', 'error']

function accumulated(
  update: ToolTestUpdate
): Pick<ToolTestState, 'content' | 'reasoningContent' | 'firstTokenMs' | 'totalMs'> {
  if (update.type !== 'test.done' && update.type !== 'test.stopped') {
    return {
      content: '',
      reasoningContent: '',
      firstTokenMs: null,
      totalMs: null,
    }
  }
  return {
    content: update.content,
    reasoningContent: update.reasoningContent,
    firstTokenMs: update.firstTokenMs,
    totalMs: update.totalMs,
  }
}

/**
 * Reduces Options tool-test transport updates into a single non-persistent pane
 * state. Stale request IDs and updates after a terminal status are dropped.
 */
export function reduceToolTestState(state: ToolTestState, action: ToolTestAction): ToolTestState {
  if (action.type === 'test.reset') return INITIAL_TOOL_TEST_STATE
  // A new validating always starts a fresh run; continuation updates are
  // guarded so stale requests cannot mutate the current run.
  if (action.type === 'test.validating')
    return { ...INITIAL_TOOL_TEST_STATE, status: 'validating', requestId: action.requestId }
  if (state.requestId !== null && action.requestId !== state.requestId) return state
  if (TERMINAL.includes(state.status)) return state
  switch (action.type) {
    case 'test.started':
      return { ...state, status: 'streaming' }
    case 'test.delta':
      return {
        ...state,
        status: 'streaming',
        content: state.content + (action.kind === 'content' ? action.delta : ''),
        reasoningContent:
          state.reasoningContent + (action.kind === 'reasoning' ? action.delta : ''),
      }
    case 'test.done':
      return { ...state, ...accumulated(action), status: 'completed', error: null }
    case 'test.stopped':
      return { ...state, ...accumulated(action), status: 'stopped' }
    case 'test.error':
      return { ...state, status: 'error', error: action.error }
    default:
      // Unknown cross-context message types are dropped; the reducer must
      // never return undefined (which React treats as an invalid update).
      return state
  }
}
