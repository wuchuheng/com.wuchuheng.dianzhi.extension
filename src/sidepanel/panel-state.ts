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
  connected: false,
  snapshot: null,
  error: null,
}

export type PanelStateEvent =
  | ConversationViewEvent
  | { type: 'panel.render'; snapshot: ConversationSnapshot }
  | { type: 'panel.clear' }
  | { type: 'panel.connected' }
  | { type: 'panel.disconnected' }

export function reducePanelState(state: PanelState, event: PanelStateEvent): PanelState {
  if (event.type === 'panel.disconnected') return { ...state, connected: false }
  if (event.type === 'panel.connected') return { ...state, connected: true, error: null }
  if (event.type === 'panel.clear') return { ...state, snapshot: null, error: null }
  if (event.type === 'panel.render') {
    return {
      ...state,
      snapshot: cloneSnapshot(event.snapshot),
      error: null,
    }
  }
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

function cloneSnapshot(snapshot: ConversationSnapshot): ConversationSnapshot {
  return {
    selectionSession: { ...snapshot.selectionSession },
    conversation: { ...snapshot.conversation },
    messages: snapshot.messages.map((message) => ({ ...message })),
    tools: snapshot.tools.map(({ tool, conversationId }) => ({
      tool: { ...tool },
      conversationId,
    })),
    activeToolId: snapshot.activeToolId,
  }
}
