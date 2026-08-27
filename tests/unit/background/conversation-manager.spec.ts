import { describe, expect, it, vi } from 'vitest'
import { createConversationManager } from '@/background/conversation-manager'
import type { OffscreenClient } from '@/background/offscreen-client'
import { DEFAULT_SETTINGS } from '@/dianzhi/domain/settings'
import type {
  ConversationRecord,
  ConversationSnapshot,
  MessageRecord,
} from '@/dianzhi/domain/protocol'
import type { StoredConversationSnapshot } from '@/offscreen/database/store'

const at = '2026-08-22T00:00:00.000Z'

function conversation(
  id: number,
  input: { selectionSessionId: number; tabId: number; toolId: number; toolName?: string }
): ConversationRecord {
  return {
    id,
    selectionSessionId: input.selectionSessionId,
    tabId: input.tabId,
    toolId: input.toolId,
    toolName: input.toolName ?? `Tool ${input.toolId}`,
    title: 'run',
    selectedText: 'run',
    contextText: 'run fast',
    promptSnapshot: 'Explain run',
    createdAt: at,
    updatedAt: at,
  }
}

function message(
  id: number,
  conversationId: number,
  input: { sequence: number; role: MessageRecord['role']; status?: MessageRecord['status'] }
): MessageRecord {
  return {
    id,
    conversationId,
    sequence: input.sequence,
    role: input.role,
    content: input.role === 'user' ? 'Explain run' : '',
    reasoningContent: '',
    estimatedThroughputTps: null,
    status: input.status ?? (input.role === 'assistant' ? 'streaming' : 'completed'),
    errorCode: null,
    errorMessage: null,
    createdAt: at,
    updatedAt: at,
  }
}

function storedSnapshot(input: {
  selectionSessionId: number
  activeConversationId: number
  conversation: ConversationRecord
  conversations?: ConversationRecord[]
  messages?: MessageRecord[]
}): StoredConversationSnapshot {
  return {
    selectionSession: {
      id: input.selectionSessionId,
      activeConversationId: input.activeConversationId,
      createdAt: at,
      updatedAt: at,
    },
    conversation: input.conversation,
    conversations: input.conversations ?? [input.conversation],
    messages: input.messages ?? [],
  }
}

function createDoneHandle() {
  let resolveDone!: () => void
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve
  })
  const stop = vi.fn(() => resolveDone())
  return { done, stop }
}

function createManager(
  database: OffscreenClient,
  extras: Partial<Parameters<typeof createConversationManager>[0]> = {}
) {
  const providerRunner = extras.providerRunner ?? {
    start: vi.fn(() => ({ stop: vi.fn(), done: Promise.resolve() })),
  }
  const publishToOwner = extras.publishToOwner ?? vi.fn(async () => undefined)
  const manager = createConversationManager({
    database,
    loadSettings: async () => DEFAULT_SETTINGS,
    providerRunner,
    publishToOwner,
    ...extras,
  })
  return { manager, providerRunner, publishToOwner }
}

describe('ConversationManager session gateway', () => {
  it('creates one session, appends one assistant, and starts one run', async () => {
    const root = conversation(22, { selectionSessionId: 10, tabId: 9, toolId: 1 })
    const assistant = message(102, 22, { sequence: 2, role: 'assistant' })
    const database = {
      request: vi.fn(async (operation: string, _args: unknown) => {
        if (operation === 'createSelectionSession') {
          return storedSnapshot({
            selectionSessionId: 10,
            activeConversationId: 22,
            conversation: root,
            messages: [message(101, 22, { sequence: 1, role: 'user' })],
          })
        }
        if (operation === 'appendAssistant') return assistant
        throw new Error(`Unexpected database operation: ${operation}`)
      }),
    } as unknown as OffscreenClient
    const { manager, providerRunner } = createManager(database)

    const snapshot = await manager.createSelection({
      tabId: 9,
      replaceSelectionSessionId: null,
      selectedText: 'run',
      contextText: 'run fast',
    })

    expect(database.request).toHaveBeenCalledWith(
      'createSelectionSession',
      expect.objectContaining({ tabId: 9 })
    )
    expect(database.request).toHaveBeenCalledWith('appendAssistant', { conversationId: 22 })
    expect(providerRunner.start).toHaveBeenCalledTimes(1)
    expect(snapshot.selectionSession.id).toBe(10)
    expect(snapshot.conversation.id).toBe(22)
  })

  it('activates the unique conversation for a tool and persists the pointer', async () => {
    const root = conversation(22, { selectionSessionId: 10, tabId: 9, toolId: 1 })
    const toolConversation = conversation(23, { selectionSessionId: 10, tabId: 9, toolId: 2 })
    const database = {
      request: vi.fn(async (operation: string) => {
        if (operation === 'getSelectionSession') {
          return storedSnapshot({
            selectionSessionId: 10,
            activeConversationId: 22,
            conversation: root,
            conversations: [root],
          })
        }
        if (operation === 'ensureToolConversation') {
          return storedSnapshot({
            selectionSessionId: 10,
            activeConversationId: 23,
            conversation: toolConversation,
            conversations: [root, toolConversation],
          })
        }
        throw new Error(`Unexpected database operation: ${operation}`)
      }),
    } as unknown as OffscreenClient
    const { manager } = createManager(database)

    const snapshot = await manager.activateTool(10, 2)

    expect(database.request).toHaveBeenCalledWith(
      'ensureToolConversation',
      expect.objectContaining({
        selectionSessionId: 10,
        tool: expect.objectContaining({ id: 2 }),
      })
    )
    expect(snapshot.selectionSession.activeConversationId).toBe(23)
    expect(snapshot.activeToolId).toBe(2)
  })

  it('recovers a stale active pointer before exposing a session snapshot', async () => {
    const root = conversation(22, { selectionSessionId: 10, tabId: 9, toolId: 1 })
    const repaired = storedSnapshot({
      selectionSessionId: 10,
      activeConversationId: 22,
      conversation: root,
      conversations: [root],
    })
    const database = {
      request: vi.fn(async (operation: string) => {
        if (operation === 'getSelectionSession') {
          return storedSnapshot({
            selectionSessionId: 10,
            activeConversationId: 999,
            conversation: root,
            conversations: [root],
          })
        }
        if (operation === 'setActiveConversation') return repaired
        throw new Error(`Unexpected database operation: ${operation}`)
      }),
    } as unknown as OffscreenClient
    const { manager } = createManager(database)

    const snapshot = await manager.loadSelectionSession(10)

    expect(database.request).toHaveBeenCalledWith('setActiveConversation', {
      selectionSessionId: 10,
      conversationId: 22,
    })
    expect(snapshot.selectionSession.activeConversationId).toBe(22)
    expect(snapshot.conversation.id).toBe(22)
  })

  it('routes stream updates through the owner publisher without broadcasting to subscribers', async () => {
    const root = conversation(22, { selectionSessionId: 10, tabId: 9, toolId: 1 })
    const assistant = message(102, 22, { sequence: 2, role: 'assistant' })
    const database = {
      request: vi.fn(async (operation: string) => {
        if (operation === 'createSelectionSession') {
          return storedSnapshot({
            selectionSessionId: 10,
            activeConversationId: 22,
            conversation: root,
            messages: [message(101, 22, { sequence: 1, role: 'user' })],
          })
        }
        if (operation === 'appendAssistant') return assistant
        throw new Error(`Unexpected database operation: ${operation}`)
      }),
    } as unknown as OffscreenClient
    const { manager, publishToOwner } = createManager(database)

    await manager.createSelection({
      tabId: 9,
      replaceSelectionSessionId: null,
      selectedText: 'run',
      contextText: 'run fast',
    })
    vi.mocked(publishToOwner).mockClear()

    await manager.publish({
      type: 'stream.delta',
      conversationId: 22,
      messageId: 102,
      content: 'fast',
    })

    expect(publishToOwner).toHaveBeenCalledWith(9, {
      type: 'stream.delta',
      conversationId: 22,
      messageId: 102,
      content: 'fast',
    })
  })

  it('stops every live run in a selection session before deleting it', async () => {
    const root = conversation(22, { selectionSessionId: 10, tabId: 9, toolId: 1 })
    const toolConversation = conversation(23, { selectionSessionId: 10, tabId: 9, toolId: 2 })
    const handles = [createDoneHandle(), createDoneHandle()]
    let appendAssistantCalls = 0
    const database = {
      request: vi.fn(async (operation: string) => {
        if (operation === 'createSelectionSession') {
          return storedSnapshot({
            selectionSessionId: 10,
            activeConversationId: 22,
            conversation: root,
            conversations: [root],
            messages: [message(101, 22, { sequence: 1, role: 'user' })],
          })
        }
        if (operation === 'appendAssistant') {
          const conversationId = appendAssistantCalls === 0 ? 22 : 23
          const assistant = message(102 + appendAssistantCalls, conversationId, {
            sequence: 2,
            role: 'assistant',
          })
          appendAssistantCalls += 1
          return assistant
        }
        if (operation === 'getSelectionSession') {
          return storedSnapshot({
            selectionSessionId: 10,
            activeConversationId: 22,
            conversation: root,
            conversations: [root],
          })
        }
        if (operation === 'ensureToolConversation') {
          return storedSnapshot({
            selectionSessionId: 10,
            activeConversationId: 23,
            conversation: toolConversation,
            conversations: [root, toolConversation],
            messages: [message(201, 23, { sequence: 1, role: 'user' })],
          })
        }
        if (operation === 'deleteSelectionSession') return undefined
        throw new Error(`Unexpected database operation: ${operation}`)
      }),
    } as unknown as OffscreenClient
    let nextHandle = 0
    const { manager } = createManager(database, {
      providerRunner: {
        start: vi.fn(() => handles[nextHandle++]),
      },
    })

    await manager.createSelection({
      tabId: 9,
      replaceSelectionSessionId: null,
      selectedText: 'run',
      contextText: 'run fast',
    })
    await manager.activateTool(10, 2)
    await manager.deleteSelectionSession(10)

    expect(handles[0].stop).toHaveBeenCalledTimes(1)
    expect(handles[1].stop).toHaveBeenCalledTimes(1)
    expect(database.request).toHaveBeenCalledWith('deleteSelectionSession', { id: 10 })
    expect(manager.getLiveSnapshot(22)).toBeNull()
    expect(manager.getLiveSnapshot(23)).toBeNull()
  })

  it('routes legacy followups to the active conversation in the owning session', async () => {
    const staleConversation = conversation(22, { selectionSessionId: 10, tabId: 9, toolId: 1 })
    const activeConversation = conversation(23, { selectionSessionId: 10, tabId: 9, toolId: 2 })
    const turn = {
      user: message(201, 23, { sequence: 2, role: 'user' }),
      assistant: message(202, 23, { sequence: 3, role: 'assistant' }),
    }
    const database = {
      request: vi.fn(async (operation: string) => {
        if (operation === 'getConversation') {
          return storedSnapshot({
            selectionSessionId: 10,
            activeConversationId: 23,
            conversation: staleConversation,
            conversations: [staleConversation, activeConversation],
          })
        }
        if (operation === 'getSelectionSession') {
          return storedSnapshot({
            selectionSessionId: 10,
            activeConversationId: 23,
            conversation: activeConversation,
            conversations: [staleConversation, activeConversation],
          })
        }
        if (operation === 'appendTurn') return turn
        throw new Error(`Unexpected database operation: ${operation}`)
      }),
    } as unknown as OffscreenClient
    const { manager } = createManager(database)

    await manager.handle(
      {
        type: 'conversation.followup',
        requestId: 'followup-active',
        payload: { conversationId: 22, content: 'again' },
      },
      { tab: { id: 9, windowId: 19 } } as chrome.runtime.MessageSender,
      'content'
    )

    expect(database.request).toHaveBeenCalledWith('appendTurn', {
      conversationId: 23,
      content: 'again',
    })
  })

  it('normalizes cached legacy conversation commands through the active session', async () => {
    const root = conversation(22, { selectionSessionId: 10, tabId: 9, toolId: 1 })
    const activeConversation = conversation(23, { selectionSessionId: 10, tabId: 9, toolId: 2 })
    const activeMessages = [
      message(201, 23, { sequence: 1, role: 'user' }),
      message(202, 23, { sequence: 2, role: 'assistant', status: 'stopped' }),
    ]
    const turn = {
      user: message(203, 23, { sequence: 3, role: 'user' }),
      assistant: message(204, 23, { sequence: 4, role: 'assistant' }),
    }
    const retryAssistant = message(205, 23, { sequence: 3, role: 'assistant' })
    let appendAssistantCalls = 0
    let activated = false
    const database = {
      request: vi.fn(async (operation: string) => {
        if (operation === 'createSelectionSession') {
          return storedSnapshot({
            selectionSessionId: 10,
            activeConversationId: 22,
            conversation: root,
            conversations: [root],
            messages: [message(101, 22, { sequence: 1, role: 'user' })],
          })
        }
        if (operation === 'getConversation') {
          return storedSnapshot({
            selectionSessionId: 10,
            activeConversationId: 23,
            conversation: root,
            conversations: [root, activeConversation],
          })
        }
        if (operation === 'appendAssistant') {
          appendAssistantCalls += 1
          if (appendAssistantCalls === 1) {
            return message(102, 22, { sequence: 2, role: 'assistant' })
          }
          return retryAssistant
        }
        if (operation === 'getSelectionSession') {
          return storedSnapshot({
            selectionSessionId: 10,
            activeConversationId: activated ? 23 : 22,
            conversation: activated ? activeConversation : root,
            conversations: activated ? [root, activeConversation] : [root],
          })
        }
        if (operation === 'ensureToolConversation') {
          activated = true
          return storedSnapshot({
            selectionSessionId: 10,
            activeConversationId: 23,
            conversation: activeConversation,
            conversations: [root, activeConversation],
            messages: activeMessages,
          })
        }
        if (operation === 'appendTurn') return turn
        throw new Error(`Unexpected database operation: ${operation}`)
      }),
    } as unknown as OffscreenClient
    const providerStop = vi.fn()
    const { manager } = createManager(database, {
      providerRunner: {
        start: vi.fn(() => ({ stop: vi.fn(), done: Promise.resolve() })),
        stop: providerStop,
      },
    })

    await manager.createSelection({
      tabId: 9,
      replaceSelectionSessionId: null,
      selectedText: 'run',
      contextText: 'run fast',
    })
    await manager.activateTool(10, 2)
    await manager.handle(
      {
        type: 'stream.stop',
        requestId: 'stop-active',
        payload: { conversationId: 22 },
      },
      { tab: { id: 9, windowId: 19 } } as chrome.runtime.MessageSender,
      'content'
    )
    await manager.handle(
      {
        type: 'conversation.retry',
        requestId: 'retry-active',
        payload: { conversationId: 22 },
      },
      { tab: { id: 9, windowId: 19 } } as chrome.runtime.MessageSender,
      'content'
    )
    await manager.handle(
      {
        type: 'conversation.followup',
        requestId: 'followup-active',
        payload: { conversationId: 22, content: 'again' },
      },
      { tab: { id: 9, windowId: 19 } } as chrome.runtime.MessageSender,
      'content'
    )

    expect(providerStop).toHaveBeenCalledWith(23)
    expect(database.request).toHaveBeenCalledWith('appendAssistant', { conversationId: 23 })
    expect(database.request).toHaveBeenCalledWith('appendTurn', {
      conversationId: 23,
      content: 'again',
    })
  })

  it('cleans replaced session state before creating the new selection session', async () => {
    const oldRoot = conversation(22, { selectionSessionId: 10, tabId: 9, toolId: 1 })
    const oldTool = conversation(23, { selectionSessionId: 10, tabId: 9, toolId: 2 })
    const nextRoot = conversation(24, { selectionSessionId: 11, tabId: 9, toolId: 1 })
    const handles = [createDoneHandle(), createDoneHandle(), createDoneHandle()]
    let appendAssistantCalls = 0
    let oldStateAtReplacement: {
      root: ConversationSnapshot | null
      tool: ConversationSnapshot | null
    } | null = null
    const managerRef: { current: ReturnType<typeof createConversationManager> | null } = {
      current: null,
    }
    const database = {
      request: vi.fn(async (operation: string, args: { replaceSelectionSessionId?: number }) => {
        if (operation === 'createSelectionSession' && args.replaceSelectionSessionId === 10) {
          const manager = managerRef.current
          if (!manager) throw new Error('Manager fixture is not initialized.')
          oldStateAtReplacement = {
            root: manager.getLiveSnapshot(22),
            tool: manager.getLiveSnapshot(23),
          }
          return storedSnapshot({
            selectionSessionId: 11,
            activeConversationId: 24,
            conversation: nextRoot,
            conversations: [nextRoot],
            messages: [message(301, 24, { sequence: 1, role: 'user' })],
          })
        }
        if (operation === 'createSelectionSession') {
          return storedSnapshot({
            selectionSessionId: 10,
            activeConversationId: 22,
            conversation: oldRoot,
            conversations: [oldRoot],
            messages: [message(101, 22, { sequence: 1, role: 'user' })],
          })
        }
        if (operation === 'appendAssistant') {
          const conversationId =
            appendAssistantCalls === 0 ? 22 : appendAssistantCalls === 1 ? 23 : 24
          const assistant = message(102 + appendAssistantCalls, conversationId, {
            sequence: 2,
            role: 'assistant',
          })
          appendAssistantCalls += 1
          return assistant
        }
        if (operation === 'getSelectionSession') {
          return storedSnapshot({
            selectionSessionId: 10,
            activeConversationId: 22,
            conversation: oldRoot,
            conversations: [oldRoot],
          })
        }
        if (operation === 'ensureToolConversation') {
          return storedSnapshot({
            selectionSessionId: 10,
            activeConversationId: 23,
            conversation: oldTool,
            conversations: [oldRoot, oldTool],
            messages: [message(201, 23, { sequence: 1, role: 'user' })],
          })
        }
        throw new Error(`Unexpected database operation: ${operation}`)
      }),
    } as unknown as OffscreenClient
    let nextHandle = 0
    const { manager } = createManager(database, {
      providerRunner: {
        start: vi.fn(() => handles[nextHandle++]),
      },
    })
    managerRef.current = manager

    await manager.createSelection({
      tabId: 9,
      replaceSelectionSessionId: null,
      selectedText: 'run',
      contextText: 'run fast',
    })
    await manager.activateTool(10, 2)
    await manager.createSelection({
      tabId: 9,
      replaceSelectionSessionId: 10,
      selectedText: 'jump',
      contextText: 'jump high',
    })

    expect(handles[0].stop).toHaveBeenCalledTimes(1)
    expect(handles[1].stop).toHaveBeenCalledTimes(1)
    expect(oldStateAtReplacement).toEqual({ root: null, tool: null })
    expect(manager.getLiveSnapshot(22)).toBeNull()
    expect(manager.getLiveSnapshot(23)).toBeNull()
    expect(manager.getLiveSnapshot(24)?.selectionSession.id).toBe(11)
  })
})

describe('ConversationManager selection-session failure logging', () => {
  it('does not serialize selection or prompt values after session creation fails', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const database = {
      request: vi.fn(async (operation: string) => {
        if (operation === 'createSelectionSession') throw new Error('database unavailable')
        throw new Error(`Unexpected database operation: ${operation}`)
      }),
    } as unknown as OffscreenClient
    const { manager } = createManager(database)

    await expect(
      manager.createSelection({
        tabId: 9,
        replaceSelectionSessionId: null,
        selectedText: 'SELECTED_TEXT_SENTINEL',
        contextText: 'CONTEXT_SENTINEL',
      })
    ).rejects.toThrow('database unavailable')

    const serialized = JSON.stringify(error.mock.calls)
    expect(serialized).toContain('createSelectionSession')
    expect(serialized).not.toContain('SELECTED_TEXT_SENTINEL')
    expect(serialized).not.toContain('CONTEXT_SENTINEL')
    expect(serialized).not.toContain('PROMPT_SENTINEL')
    error.mockRestore()
  })
})
