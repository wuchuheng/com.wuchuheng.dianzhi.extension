import { describe, expect, it, vi } from 'vitest'
import { createConversationManager } from '@/background/conversation-manager'
import type { OffscreenClient } from '@/background/offscreen-client'
import { DEFAULT_SETTINGS } from '@/dianzhi/domain/settings'
import type { StoredConversationSnapshot } from '@/offscreen/database/store'

const at = '2026-08-22T00:00:00.000Z'

function storedConversation(id: number, tabId: number): StoredConversationSnapshot {
  return {
    selectionSession: {
      id: 1,
      activeConversationId: id,
      createdAt: at,
      updatedAt: at,
    },
    conversation: {
      id,
      selectionSessionId: 1,
      selectionKey: 1,
      tabId,
      toolId: 1,
      toolName: '词典',
      title: 'run',
      selectedText: 'run',
      contextText: 'run fast',
      promptSnapshot: 'Explain run',
      createdAt: at,
      updatedAt: at,
    },
    conversations: [],
    messages: [],
  }
}

describe('ConversationManager panel.toggle', () => {
  it('closes an empty Side Panel through its tab-bound port', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    let onMessage: ((message: unknown) => void) | undefined
    const port = {
      name: 'dianzhi:sidepanel',
      onMessage: { addListener: vi.fn((listener) => (onMessage = listener)) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(),
    } as unknown as chrome.runtime.Port
    const manager = createConversationManager({
      database: {} as OffscreenClient,
      loadSettings: async () => DEFAULT_SETTINGS,
      providerRunner: { start: () => ({ stop: vi.fn(), done: Promise.resolve() }) },
      sendToContent: async () => undefined,
      session: { load: async () => ({}), save: async () => undefined },
      sidePanel: { open: vi.fn(), close },
    })
    await manager.initialize()
    manager.connect(port)

    onMessage?.({ type: 'ready', tabId: 9, windowId: 19 })
    onMessage?.({ type: 'close' })
    await Promise.resolve()

    expect(close).toHaveBeenCalledWith(19)
  })

  it('closes the tab panel even when the content script sends an older conversation ID', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const savedStates: Record<string, unknown>[] = []
    const database = {
      request: vi.fn(async (operation: string, args: { id: number }) => {
        if (operation === 'getConversation') return storedConversation(args.id, 9)
        throw new Error(`Unexpected database operation: ${operation}`)
      }),
    } as unknown as OffscreenClient
    const manager = createConversationManager({
      database,
      loadSettings: async () => DEFAULT_SETTINGS,
      providerRunner: { start: () => ({ stop: vi.fn(), done: Promise.resolve() }) },
      sendToContent: async () => undefined,
      session: {
        load: async () => ({
          '9': {
            selectionKey: 1,
            activeToolId: 1,
            activeConversationId: 22,
            panelOpen: true,
            windowId: 19,
          },
        }),
        save: async (state) => savedStates.push(state),
      },
      sidePanel: { open: vi.fn(), close },
    })
    await manager.initialize()

    await manager.handle(
      { type: 'panel.toggle', requestId: 'toggle-1', payload: { conversationId: 11 } },
      { tab: { id: 9, windowId: 19 } } as chrome.runtime.MessageSender,
      'content'
    )

    expect(close).toHaveBeenCalledWith(19)
    expect(savedStates.at(-1)).toMatchObject({
      '9': { activeConversationId: 22, panelOpen: false },
    })
  })
})
