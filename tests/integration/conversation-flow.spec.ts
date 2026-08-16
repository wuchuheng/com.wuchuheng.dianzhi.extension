// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  INITIAL_CONVERSATION_VIEW,
  reduceConversationView,
} from '../../src/dianzhi/conversation/reducer'
import type { ConversationSnapshot, MessageRecord } from '../../src/dianzhi/domain/protocol'

describe('conversation flow integration', () => {
  it('reconciles sync, streaming, handoff, and replacement without accepting late deltas', () => {
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
        title: 'learning',
        selectedText: 'learning',
        contextText: '<selected>learning</selected>',
        promptSnapshot: 'prompt',
        createdAt: assistant.createdAt,
        updatedAt: assistant.updatedAt,
      },
      messages: [assistant],
      tools: [],
      activeToolId: 'context',
    }

    let state = reduceConversationView(INITIAL_CONVERSATION_VIEW, {
      type: 'conversation.sync',
      snapshot,
    })
    state = reduceConversationView(state, {
      type: 'stream.delta',
      conversationId: 1,
      messageId: 2,
      content: 'answer',
    })
    state = reduceConversationView(state, { type: 'panel.handoffReady', conversationId: 1 })
    expect(state).toMatchObject({ visible: false, panelOpen: true })

    state = reduceConversationView(state, { type: 'selection.started' })
    expect(state).toMatchObject({ visible: false, panelOpen: true, snapshot: null })
    const unchanged = reduceConversationView(state, {
      type: 'stream.delta',
      conversationId: 1,
      messageId: 2,
      content: 'late',
    })
    expect(unchanged).toBe(state)
  })
})
