// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { mergeSettings } from '../../../src/dianzhi/domain/settings'
import { createConversationManager } from '../../../src/background/conversation-manager'

describe('background conversation manager', () => {
  it('derives the tab from sender metadata and starts the root provider history', async () => {
    const settings = mergeSettings({})
    const stored = {
      conversation: {
        id: 11,
        selectionKey: 11,
        tabId: 7,
        toolId: 'context',
        toolName: '语境',
        title: 'learning',
        selectedText: 'learning',
        contextText: '<selected>learning</selected>',
        promptSnapshot: 'filled prompt',
        createdAt: '2026-08-17T00:00:00.000Z',
        updatedAt: '2026-08-17T00:00:00.000Z',
      },
      messages: [
        {
          id: 12,
          conversationId: 11,
          sequence: 1,
          role: 'user' as const,
          content: 'filled prompt',
          reasoningContent: '',
          status: 'completed' as const,
          errorCode: null,
          errorMessage: null,
          createdAt: '2026-08-17T00:00:00.000Z',
          updatedAt: '2026-08-17T00:00:00.000Z',
        },
      ],
      conversations: [],
    }
    const database = {
      request: vi.fn(async (operation: string) => {
        if (operation === 'createSelection') return stored
        if (operation === 'appendAssistant') {
          return {
            ...stored.messages[0],
            id: 13,
            sequence: 2,
            role: 'assistant',
            status: 'streaming',
          }
        }
        return null
      }),
    }
    const start = vi.fn(() => ({ stop: vi.fn(), done: Promise.resolve() }))
    const manager = createConversationManager({
      database: database as never,
      loadSettings: vi.fn(async () => settings),
      providerRunner: { start },
      sendToContent: vi.fn(async () => undefined),
      session: { load: vi.fn(async () => ({})), save: vi.fn(async () => undefined) },
      sidePanel: { open: vi.fn(async () => undefined), close: vi.fn(async () => undefined) },
    })

    const result = await manager.handle(
      {
        type: 'conversation.create',
        requestId: 'create-1',
        payload: {
          selectedText: 'learning',
          contextText: '<selected>learning</selected>',
        },
      },
      { tab: { id: 7 } } as chrome.runtime.MessageSender
    )

    expect(database.request).toHaveBeenCalledWith(
      'createSelection',
      expect.objectContaining({ tabId: 7, selectedText: 'learning' })
    )
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: 11,
        messages: [{ role: 'user', content: 'filled prompt' }],
      })
    )
    expect(result.snapshot?.activeToolId).toBe('context')
  })

  it('rejects content commands without a trusted sender tab', async () => {
    const manager = createConversationManager({
      database: {} as never,
      loadSettings: vi.fn(),
      providerRunner: {} as never,
      sendToContent: vi.fn(),
      session: { load: vi.fn(), save: vi.fn() },
      sidePanel: { open: vi.fn(), close: vi.fn() },
    })

    await expect(
      manager.handle(
        {
          type: 'conversation.create',
          requestId: 'bad',
          payload: { selectedText: 'x', contextText: 'x' },
        },
        {} as chrome.runtime.MessageSender
      )
    ).rejects.toMatchObject({ code: 'INVALID_EVENT' })
  })

  it('opens the native panel before asynchronous work and rejects cross-tab reads', async () => {
    const order: string[] = []
    const stored = {
      conversation: {
        id: 11,
        selectionKey: 11,
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
      conversations: [],
    }
    const manager = createConversationManager({
      database: { request: vi.fn(async () => stored) } as never,
      loadSettings: vi.fn(async () => {
        order.push('settings')
        return mergeSettings({})
      }),
      providerRunner: {} as never,
      sendToContent: vi.fn(async () => undefined),
      session: { load: vi.fn(async () => ({})), save: vi.fn(async () => undefined) },
      sidePanel: {
        open: vi.fn(async () => {
          order.push('open')
        }),
        close: vi.fn(async () => undefined),
      },
    })

    await manager.handle(
      { type: 'panel.open', requestId: 'open-1', payload: { conversationId: 11 } },
      { tab: { id: 7 } } as chrome.runtime.MessageSender,
      'content'
    )
    expect(order[0]).toBe('open')

    await expect(
      manager.handle(
        { type: 'conversation.sync', requestId: 'sync-1', payload: { conversationId: 11 } },
        { tab: { id: 8 } } as chrome.runtime.MessageSender,
        'content'
      )
    ).rejects.toMatchObject({ code: 'INVALID_EVENT' })
  })
})
