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

    const openPromise = manager.handle(
      { type: 'panel.open', requestId: 'open-1', payload: { conversationId: 11 } },
      { tab: { id: 7 } } as chrome.runtime.MessageSender,
      'content'
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    await manager.handle(
      { type: 'panel.rendered', requestId: 'rendered-1', payload: { conversationId: 11 } },
      {} as chrome.runtime.MessageSender,
      'extension'
    )
    await openPromise
    expect(order[0]).toBe('open')

    await expect(
      manager.handle(
        { type: 'conversation.sync', requestId: 'sync-1', payload: { conversationId: 11 } },
        { tab: { id: 8 } } as chrome.runtime.MessageSender,
        'content'
      )
    ).rejects.toMatchObject({ code: 'INVALID_EVENT' })
  })

  it('stops every running tool conversation before replacing a selection group', async () => {
    const timestamp = '2026-08-17T00:00:00.000Z'
    const stored = (id: number, selectionKey: number, toolId: string, toolName: string) => ({
      conversation: {
        id,
        selectionKey,
        tabId: 7,
        toolId,
        toolName,
        title: 'word',
        selectedText: 'word',
        contextText: '<selected>word</selected>',
        promptSnapshot: 'prompt',
        createdAt: timestamp,
        updatedAt: timestamp,
      },
      messages: [
        {
          id: id * 10,
          conversationId: id,
          sequence: 1,
          role: 'user' as const,
          content: 'prompt',
          reasoningContent: '',
          status: 'completed' as const,
          errorCode: null,
          errorMessage: null,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      ],
      conversations: [],
    })
    const root = stored(11, 11, 'context', '语境')
    const synonym = stored(12, 11, 'synonyms', '同义词')
    const replacement = stored(21, 21, 'context', '语境')
    let createCount = 0
    const database = {
      request: vi.fn(async (operation: string, args: { conversationId?: number }) => {
        if (operation === 'createSelection') return createCount++ === 0 ? root : replacement
        if (operation === 'ensureToolConversation') return synonym
        if (operation === 'appendAssistant') {
          const conversationId = Number(args.conversationId)
          return {
            ...root.messages[0],
            id: conversationId * 10 + 1,
            conversationId,
            sequence: 2,
            role: 'assistant' as const,
            status: 'streaming' as const,
          }
        }
        return null
      }),
    }
    const handles: Array<{ stop: ReturnType<typeof vi.fn>; done: Promise<void> }> = []
    const start = vi.fn(() => {
      let resolveDone!: () => void
      const done = new Promise<void>((resolve) => {
        resolveDone = resolve
      })
      const handle = { stop: vi.fn(resolveDone), done }
      handles.push(handle)
      return handle
    })
    const manager = createConversationManager({
      database: database as never,
      loadSettings: vi.fn(async () => mergeSettings({})),
      providerRunner: { start },
      sendToContent: vi.fn(async () => undefined),
      session: { load: vi.fn(async () => ({})), save: vi.fn(async () => undefined) },
      sidePanel: { open: vi.fn(async () => undefined), close: vi.fn(async () => undefined) },
    })
    const sender = { tab: { id: 7 } } as chrome.runtime.MessageSender

    await manager.handle(
      {
        type: 'conversation.create',
        requestId: 'create-root',
        payload: { selectedText: 'word', contextText: '<selected>word</selected>' },
      },
      sender
    )
    await manager.handle(
      {
        type: 'conversation.ensureTool',
        requestId: 'ensure-synonym',
        payload: { selectionKey: 11, toolId: 'synonyms' },
      },
      sender
    )
    await manager.handle(
      {
        type: 'conversation.create',
        requestId: 'replace-selection',
        payload: { selectedText: 'next', contextText: '<selected>next</selected>' },
      },
      sender
    )

    expect(handles).toHaveLength(3)
    expect(handles[0]?.stop).toHaveBeenCalledTimes(1)
    expect(handles[1]?.stop).toHaveBeenCalledTimes(1)
  })

  it('commits panel-open state only after rendering and clears it when the panel disconnects', async () => {
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
    const save = vi.fn(async () => undefined)
    const sendToContent = vi.fn(async () => undefined)
    const manager = createConversationManager({
      database: { request: vi.fn(async () => stored) } as never,
      loadSettings: vi.fn(async () => mergeSettings({})),
      providerRunner: {} as never,
      sendToContent,
      session: {
        load: vi.fn(async () => ({
          '7': {
            selectionKey: 11,
            activeToolId: 'context',
            activeConversationId: 11,
            panelOpen: false,
          },
        })),
        save,
      },
      sidePanel: { open: vi.fn(async () => undefined), close: vi.fn(async () => undefined) },
      sidePanelDisconnectGraceMs: 0,
    })
    await manager.initialize()

    const openPromise = manager.handle(
      { type: 'panel.open', requestId: 'open-lifecycle', payload: { conversationId: 11 } },
      { tab: { id: 7 } } as chrome.runtime.MessageSender,
      'content'
    )
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(save).not.toHaveBeenCalledWith({
      '7': expect.objectContaining({ panelOpen: true }),
    })

    const messageListeners: Array<(message: unknown) => void> = []
    const disconnectListeners: Array<() => void> = []
    const port = {
      name: 'dianzhi:sidepanel',
      sender: { url: 'chrome-extension://id/src/sidepanel/index.html' },
      postMessage: vi.fn(),
      onMessage: {
        addListener: (listener: (message: unknown) => void) => messageListeners.push(listener),
      },
      onDisconnect: { addListener: (listener: () => void) => disconnectListeners.push(listener) },
    }
    manager.connect(port as never)
    messageListeners[0]?.({ type: 'ready', tabId: 7 })
    await manager.handle(
      { type: 'panel.rendered', requestId: 'rendered-lifecycle', payload: { conversationId: 11 } },
      {} as chrome.runtime.MessageSender,
      'extension'
    )
    await openPromise
    expect(save).toHaveBeenLastCalledWith({
      '7': expect.objectContaining({ panelOpen: true }),
    })

    disconnectListeners[0]?.()
    await new Promise<void>((resolve) => setTimeout(resolve, 1))
    expect(save).toHaveBeenLastCalledWith({
      '7': expect.objectContaining({ panelOpen: false }),
    })
    expect(sendToContent).toHaveBeenCalledWith(7, { type: 'panel.closed', conversationId: 11 })
  })

  it('closes the native panel and returns a stable error when rendering times out', async () => {
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
    const scheduled: Array<() => void> = []
    const close = vi.fn(async () => undefined)
    const manager = createConversationManager({
      database: { request: vi.fn(async () => stored) },
      loadSettings: vi.fn(async () => mergeSettings({})),
      providerRunner: {},
      sendToContent: vi.fn(async () => undefined),
      session: { load: vi.fn(async () => ({})), save: vi.fn(async () => undefined) },
      sidePanel: { open: vi.fn(async () => undefined), close },
      setTimeout: (callback: () => void) => {
        scheduled.push(callback)
        return 1
      },
      clearTimeout: vi.fn(),
      sidePanelReadyTimeoutMs: 10,
    } as never)

    const openPromise = manager.handle(
      { type: 'panel.open', requestId: 'open-timeout', payload: { conversationId: 11 } },
      { tab: { id: 7 } } as chrome.runtime.MessageSender,
      'content'
    )
    expect(scheduled).toHaveLength(1)
    scheduled[0]?.()

    await expect(openPromise).rejects.toMatchObject({ code: 'SIDE_PANEL_READY_TIMEOUT' })
    expect(close).toHaveBeenCalledWith(7)
  })

  it('does not let an older handoff remove or close a newer request for the same tab', async () => {
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
    const close = vi.fn(async () => undefined)
    let releaseFirstOpen!: () => void
    let openCalls = 0
    const open = vi.fn(async () => {
      openCalls += 1
      if (openCalls === 1) await new Promise<void>((resolve) => (releaseFirstOpen = resolve))
    })
    const manager = createConversationManager({
      database: { request: vi.fn(async () => stored) },
      loadSettings: vi.fn(async () => mergeSettings({})),
      providerRunner: {},
      sendToContent: vi.fn(async () => undefined),
      session: { load: vi.fn(async () => ({})), save: vi.fn(async () => undefined) },
      sidePanel: { open, close },
    } as never)

    const first = manager.handle(
      { type: 'panel.open', requestId: 'open-first', payload: { conversationId: 11 } },
      { tab: { id: 7 } } as chrome.runtime.MessageSender,
      'content'
    )
    const second = manager.handle(
      { type: 'panel.open', requestId: 'open-second', payload: { conversationId: 11 } },
      { tab: { id: 7 } } as chrome.runtime.MessageSender,
      'content'
    )

    await new Promise<void>((resolve) => setImmediate(resolve))
    await manager.handle(
      { type: 'panel.rendered', requestId: 'rendered-second', payload: { conversationId: 11 } },
      {} as chrome.runtime.MessageSender,
      'extension'
    )
    await expect(second).resolves.toMatchObject({ accepted: true })
    releaseFirstOpen()
    await expect(first).rejects.toMatchObject({ code: 'SIDE_PANEL_OPEN_FAILED' })
    expect(close).not.toHaveBeenCalled()
  })

  it('keeps an initial handoff alive when a replacement port reconnects within the grace period', async () => {
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
    const scheduled = new Map<number, () => void>()
    const cancelled = new Set<number>()
    let nextTimer = 1
    const save = vi.fn(async () => undefined)
    const sendToContent = vi.fn(async () => undefined)
    const close = vi.fn(async () => undefined)
    const manager = createConversationManager({
      database: { request: vi.fn(async () => stored) },
      loadSettings: vi.fn(async () => mergeSettings({})),
      providerRunner: {},
      sendToContent,
      session: {
        load: vi.fn(async () => ({
          '7': {
            selectionKey: 11,
            activeToolId: 'context',
            activeConversationId: 11,
            panelOpen: false,
          },
        })),
        save,
      },
      sidePanel: { open: vi.fn(async () => undefined), close },
      setTimeout: (callback: () => void) => {
        const id = nextTimer++
        scheduled.set(id, callback)
        return id
      },
      clearTimeout: (id: number) => cancelled.add(id),
    } as never)
    await manager.initialize()

    const openPromise = manager.handle(
      { type: 'panel.open', requestId: 'open-reconnect', payload: { conversationId: 11 } },
      { tab: { id: 7 } } as chrome.runtime.MessageSender,
      'content'
    )

    const connectPort = () => {
      const messages: Array<(message: unknown) => void> = []
      const disconnects: Array<() => void> = []
      const port = {
        name: 'dianzhi:sidepanel',
        postMessage: vi.fn(),
        onMessage: {
          addListener: (listener: (message: unknown) => void) => messages.push(listener),
        },
        onDisconnect: { addListener: (listener: () => void) => disconnects.push(listener) },
      }
      manager.connect(port as never)
      messages[0]?.({ type: 'ready', tabId: 7 })
      return disconnects
    }

    const firstDisconnects = connectPort()
    firstDisconnects[0]?.()
    const closeTimer = [...scheduled.keys()].at(-1)!
    connectPort()
    scheduled.get(closeTimer)?.()
    await manager.handle(
      { type: 'panel.rendered', requestId: 'rendered-reconnect', payload: { conversationId: 11 } },
      {} as chrome.runtime.MessageSender,
      'extension'
    )
    await expect(openPromise).resolves.toMatchObject({ accepted: true })

    expect(cancelled).toContain(closeTimer)
    expect(save).toHaveBeenLastCalledWith({
      '7': expect.objectContaining({ panelOpen: true }),
    })
    expect(close).not.toHaveBeenCalled()
    expect(sendToContent).not.toHaveBeenCalledWith(7, {
      type: 'panel.closed',
      conversationId: 11,
    })
  })
})
