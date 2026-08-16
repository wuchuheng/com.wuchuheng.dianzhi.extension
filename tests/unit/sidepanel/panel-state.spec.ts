// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  INITIAL_PANEL_STATE,
  cycleEnabledTool,
  reducePanelState,
} from '../../../src/sidepanel/panel-state'
import type { ConversationSnapshot } from '../../../src/dianzhi/domain/protocol'

const snapshot: ConversationSnapshot = {
  conversation: {
    id: 5,
    selectionKey: 5,
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
  messages: [],
  tools: [
    {
      tool: {
        id: 'context',
        name: '语境',
        builtin: true,
        enabled: true,
        promptMode: 'preset',
        customPrompt: '',
      },
      conversationId: 5,
    },
    {
      tool: {
        id: 'translate',
        name: '翻译',
        builtin: true,
        enabled: true,
        promptMode: 'preset',
        customPrompt: '',
      },
      conversationId: null,
    },
  ],
  activeToolId: 'context',
}

describe('side panel state', () => {
  it('loads an authoritative snapshot and applies live updates', () => {
    let state = reducePanelState(INITIAL_PANEL_STATE, { type: 'conversation.sync', snapshot })
    state = reducePanelState(state, {
      type: 'stream.started',
      conversationId: 5,
      message: {
        id: 6,
        conversationId: 5,
        sequence: 2,
        role: 'assistant',
        content: '',
        reasoningContent: '',
        status: 'streaming',
        errorCode: null,
        errorMessage: null,
        createdAt: '2026-08-17T00:00:00.000Z',
        updatedAt: '2026-08-17T00:00:00.000Z',
      },
    })
    state = reducePanelState(state, {
      type: 'stream.delta',
      conversationId: 5,
      messageId: 6,
      content: 'answer',
    })

    expect(state.snapshot?.messages[0]?.content).toBe('answer')
  })

  it('cycles enabled tool tabs with wraparound and records disconnects', () => {
    expect(cycleEnabledTool(snapshot, -1)).toBe('translate')
    expect(cycleEnabledTool(snapshot, 1)).toBe('translate')
    expect(reducePanelState(INITIAL_PANEL_STATE, { type: 'panel.disconnected' }).connected).toBe(
      false
    )
  })
})
