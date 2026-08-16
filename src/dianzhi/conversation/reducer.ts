import type {
  ConversationSnapshot,
  ConversationUpdate,
  MessageRecord,
} from '@/dianzhi/domain/protocol'
import type { DianzhiErrorShape } from '@/dianzhi/domain/errors'

export interface ConversationViewState {
  visible: boolean
  panelOpen: boolean
  mode: 'card' | 'chat'
  expanded: boolean
  snapshot: ConversationSnapshot | null
  error: DianzhiErrorShape | null
}

export const INITIAL_CONVERSATION_VIEW: ConversationViewState = {
  visible: false,
  panelOpen: false,
  mode: 'card',
  expanded: false,
  snapshot: null,
  error: null,
}

export type ConversationViewEvent =
  | ConversationUpdate
  | { type: 'selection.started' }
  | { type: 'view.mode'; mode: ConversationViewState['mode'] }
  | { type: 'view.expanded'; expanded: boolean }
  | { type: 'view.closed' }
  | { type: 'view.error'; error: DianzhiErrorShape }

function cloneSnapshot(snapshot: ConversationSnapshot): ConversationSnapshot {
  return {
    conversation: { ...snapshot.conversation },
    messages: snapshot.messages.map((message) => ({ ...message })),
    tools: snapshot.tools.map(({ tool, conversationId }) => ({
      tool: { ...tool },
      conversationId,
    })),
    activeToolId: snapshot.activeToolId,
  }
}

export function reconcileMessage(
  current: MessageRecord | undefined,
  incoming: MessageRecord
): MessageRecord {
  return current ? { ...current, ...incoming } : { ...incoming }
}

function upsertMessage(
  snapshot: ConversationSnapshot,
  incoming: MessageRecord
): ConversationSnapshot {
  const messages = snapshot.messages.map((message) =>
    message.id === incoming.id ? reconcileMessage(message, incoming) : message
  )
  if (!messages.some((message) => message.id === incoming.id)) messages.push({ ...incoming })
  messages.sort((left, right) => left.sequence - right.sequence)
  return { ...snapshot, messages }
}

export function reduceConversationView(
  state: ConversationViewState,
  event: ConversationViewEvent
): ConversationViewState {
  if (event.type === 'selection.started') {
    return {
      ...INITIAL_CONVERSATION_VIEW,
      panelOpen: state.panelOpen,
      visible: !state.panelOpen,
    }
  }
  if (event.type === 'view.mode') return { ...state, mode: event.mode }
  if (event.type === 'view.expanded') return { ...state, expanded: event.expanded }
  if (event.type === 'view.closed') return { ...state, visible: false }
  if (event.type === 'view.error') return { ...state, visible: true, error: event.error }

  if (event.type === 'conversation.sync' || event.type === 'conversation.toolChanged') {
    return {
      ...state,
      visible: true,
      snapshot: cloneSnapshot(event.snapshot),
      error: null,
    }
  }

  const currentConversationId = state.snapshot?.conversation.id
  if (event.type === 'panel.handoffReady') {
    if (currentConversationId !== event.conversationId) return state
    return { ...state, visible: false, panelOpen: true }
  }
  if (!state.snapshot || currentConversationId !== event.conversationId) return state

  if (event.type === 'stream.started') {
    return { ...state, snapshot: upsertMessage(state.snapshot, event.message), error: null }
  }
  if (event.type === 'stream.delta' || event.type === 'stream.reasoning') {
    const message = state.snapshot.messages.find((item) => item.id === event.messageId)
    if (!message || message.status !== 'streaming') return state
    const incoming = {
      ...message,
      ...(event.type === 'stream.delta'
        ? { content: message.content + event.content }
        : { reasoningContent: message.reasoningContent + event.content }),
    }
    return { ...state, snapshot: upsertMessage(state.snapshot, incoming) }
  }
  if (
    event.type === 'stream.done' ||
    event.type === 'stream.stopped' ||
    event.type === 'stream.error'
  ) {
    return {
      ...state,
      snapshot: upsertMessage(state.snapshot, event.message),
      error: event.type === 'stream.error' ? event.error : null,
    }
  }
  return state
}
