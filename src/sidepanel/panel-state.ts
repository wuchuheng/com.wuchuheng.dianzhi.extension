import {
  INITIAL_CONVERSATION_VIEW,
  reduceConversationView,
  type ConversationViewEvent,
} from '@/dianzhi/conversation/reducer'
import type { DianzhiErrorShape } from '@/dianzhi/domain/errors'
import type { ConversationSnapshot } from '@/dianzhi/domain/protocol'

export interface PanelState {
  connected: boolean
  snapshot: ConversationSnapshot | null
  error: DianzhiErrorShape | null
}

export const INITIAL_PANEL_STATE: PanelState = {
  connected: true,
  snapshot: null,
  error: null,
}

export type PanelStateEvent =
  | ConversationViewEvent
  | { type: 'panel.disconnected' }
  | { type: 'panel.connected' }

export function reducePanelState(state: PanelState, event: PanelStateEvent): PanelState {
  if (event.type === 'panel.disconnected') return { ...state, connected: false }
  if (event.type === 'panel.connected') return { ...state, connected: true, error: null }
  const reduced = reduceConversationView(
    {
      ...INITIAL_CONVERSATION_VIEW,
      visible: true,
      snapshot: state.snapshot,
      error: state.error,
    },
    event
  )
  return { connected: state.connected, snapshot: reduced.snapshot, error: reduced.error }
}

export function cycleEnabledTool(
  snapshot: ConversationSnapshot | null,
  direction: -1 | 1
): number | null {
  if (!snapshot || snapshot.tools.length === 0) return null
  const index = Math.max(
    0,
    snapshot.tools.findIndex(({ tool }) => tool.id === snapshot.activeToolId)
  )
  return (
    snapshot.tools[(index + direction + snapshot.tools.length) % snapshot.tools.length]?.tool.id ??
    null
  )
}
