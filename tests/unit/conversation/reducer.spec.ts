// @vitest-environment node

import { describe, expect, it } from 'vitest'
import type { ConversationSnapshot, MessageRecord } from '../../../src/dianzhi/domain/protocol'
import {
  INITIAL_CONVERSATION_VIEW,
  reconcileMessage,
  reduceConversationView,
} from '../../../src/dianzhi/conversation/reducer'

const assistant: MessageRecord = {
  id: 2,
  conversationId: 1,
  sequence: 2,
  role: 'assistant',
  content: '',
  reasoningContent: '',
  status: 'streaming',
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:00.000Z',
}

const snapshot: ConversationSnapshot = {
  conversation: {
    id: 1,
    selectionKey: 1,
    tabId: 7,
    toolId: 'context',
    toolName: '语境',
    title: 'word',
    selectedText: 'word',
    contextText: '<selected>word</selected>',
    promptSnapshot: 'prompt',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
  },
  messages: [assistant],
  tools: [],
  activeToolId: 'context',
}

describe('conversation view reducer', () => {
  it('replaces snapshots and reconciles numeric message IDs without duplicates', () => {
    let state = reduceConversationView(INITIAL_CONVERSATION_VIEW, {
      type: 'conversation.sync',
      snapshot,
    })
    state = reduceConversationView(state, {
      type: 'stream.started',
      conversationId: 1,
      message: { ...assistant, content: 'new' },
    })

    expect(state.snapshot?.messages).toHaveLength(1)
    expect(state.snapshot?.messages[0]?.content).toBe('new')
    expect(reconcileMessage(assistant, { ...assistant, status: 'completed' }).status).toBe(
      'completed'
    )
  })

  it('applies live deltas but rejects stale conversation and message IDs', () => {
    const loaded = reduceConversationView(INITIAL_CONVERSATION_VIEW, {
      type: 'conversation.sync',
      snapshot,
    })
    const updated = reduceConversationView(loaded, {
      type: 'stream.delta',
      conversationId: 1,
      messageId: 2,
      content: 'answer',
    })

    expect(updated.snapshot?.messages[0]?.content).toBe('answer')
    expect(
      reduceConversationView(updated, {
        type: 'stream.delta',
        conversationId: 99,
        messageId: 2,
        content: 'stale',
      })
    ).toBe(updated)
  })

  it('tracks mode, expansion, new selections, and validated panel handoff', () => {
    let state = reduceConversationView(INITIAL_CONVERSATION_VIEW, {
      type: 'conversation.sync',
      snapshot,
    })
    state = reduceConversationView(state, { type: 'view.mode', mode: 'chat' })
    state = reduceConversationView(state, { type: 'view.expanded', expanded: true })
    expect(state).toMatchObject({ mode: 'chat', expanded: true, visible: true })

    state = reduceConversationView(state, { type: 'panel.handoffReady', conversationId: 99 })
    expect(state.visible).toBe(true)
    state = reduceConversationView(state, { type: 'panel.handoffReady', conversationId: 1 })
    expect(state.visible).toBe(false)
    state = reduceConversationView(state, { type: 'selection.started' })
    expect(state).toMatchObject({ visible: false, panelOpen: true, snapshot: null })
  })
})
