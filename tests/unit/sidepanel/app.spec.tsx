// @vitest-environment node

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { INITIAL_PANEL_STATE } from '../../../src/sidepanel/panel-state'
import { SidePanelView } from '../../../src/sidepanel/App'
import type { ConversationSnapshot } from '../../../src/dianzhi/domain/protocol'

const snapshot: ConversationSnapshot = {
  conversation: {
    id: 5,
    selectionKey: 5,
    tabId: 7,
    toolId: 'context',
    toolName: '语境',
    title: 'learning',
    selectedText: 'learning',
    contextText: '<selected>learning</selected>',
    promptSnapshot: 'prompt',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:01.000Z',
  },
  messages: [
    {
      id: 6,
      conversationId: 5,
      sequence: 1,
      role: 'user',
      content: 'What does it mean?',
      reasoningContent: '',
      status: 'completed',
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
    },
    {
      id: 7,
      conversationId: 5,
      sequence: 2,
      role: 'assistant',
      content: 'It means acquiring knowledge.',
      reasoningContent: 'Context confirms the educational sense.',
      status: 'completed',
      errorCode: null,
      errorMessage: null,
      createdAt: '2026-08-17T00:00:01.000Z',
      updatedAt: '2026-08-17T00:00:01.000Z',
    },
  ],
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
  ],
  activeToolId: 'context',
}

describe('SidePanelView', () => {
  it('renders a conversation-only empty state without archive or new-chat actions', () => {
    const html = renderToStaticMarkup(
      <SidePanelView
        state={INITIAL_PANEL_STATE}
        reasoningEnabled={false}
        draft=""
        onDraftChange={() => undefined}
        onToolSelect={() => undefined}
        onSend={() => undefined}
        onStop={() => undefined}
        onRetry={() => undefined}
        onClose={() => undefined}
        onOpenSettings={() => undefined}
      />
    )

    expect(html).toContain('选择英文文本后')
    expect(html).not.toContain('新建对话')
    expect(html).not.toContain('历史记录')
  })

  it('renders the active tool, full history, reasoning, and follow-up composer', () => {
    const html = renderToStaticMarkup(
      <SidePanelView
        state={{ ...INITIAL_PANEL_STATE, snapshot }}
        reasoningEnabled
        draft="continue here"
        onDraftChange={() => undefined}
        onToolSelect={() => undefined}
        onSend={() => undefined}
        onStop={() => undefined}
        onRetry={() => undefined}
        onClose={() => undefined}
        onOpenSettings={() => undefined}
      />
    )

    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('What does it mean?')
    expect(html).toContain('It means acquiring knowledge.')
    expect(html).toContain('思考过程')
    expect(html).toContain('continue here')
    expect(html).not.toContain('新建对话')
  })
})
