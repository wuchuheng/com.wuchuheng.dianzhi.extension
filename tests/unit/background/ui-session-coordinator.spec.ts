import { describe, expect, it, vi } from 'vitest'
import {
  createUiSessionCoordinator,
  type TabSessionState,
  type UiEventSource,
  type UiSessionCoordinatorDependencies,
} from '@/background/ui-session-coordinator'
import { DEFAULT_SETTINGS } from '@/dianzhi/domain/settings'
import type {
  ConversationSnapshot,
  ConversationUpdate,
  MessageRecord,
} from '@/dianzhi/domain/protocol'
import type {
  CycleToolShortcutRequest,
  PanelToggleRequest,
  SelectToolShortcutRequest,
  SelectionRouteRequest,
  SurfaceStatusRequest,
} from '@/dianzhi/domain/ui-session-protocol'

const PAGE = 'https://example.com/docs/rust?chapter=1#intro'
const PAGE_NORMALIZED = 'https://example.com/docs/rust?chapter=1'
const OTHER_PAGE = 'https://example.com/docs/rust?chapter=2'
const at = '2026-08-27T00:00:00.000Z'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve
    reject = onReject
  })
  return { promise, resolve, reject }
}

function message(id: number, conversationId: number): MessageRecord {
  return {
    id,
    conversationId,
    sequence: 1,
    role: 'user',
    content: 'explain',
    reasoningContent: '',
    estimatedThroughputTps: null,
    status: 'completed',
    errorCode: null,
    errorMessage: null,
    createdAt: at,
    updatedAt: at,
  }
}

function snapshot(
  selectionSessionId: number,
  conversationId: number,
  input: {
    tabId?: number
    toolId?: number
    tools?: Array<{ toolId: number; conversationId: number | null }>
  } = {}
): ConversationSnapshot {
  const tabId = input.tabId ?? 9
  const toolId = input.toolId ?? 1
  const tools =
    input.tools ??
    DEFAULT_SETTINGS.tools
      .filter((tool) => tool.enabled)
      .slice(0, 3)
      .map((tool) => ({
        toolId: tool.id,
        conversationId: tool.id === toolId ? conversationId : null,
      }))
  return {
    selectionSession: {
      id: selectionSessionId,
      activeConversationId: conversationId,
      createdAt: at,
      updatedAt: at,
    },
    conversation: {
      id: conversationId,
      selectionSessionId,
      tabId,
      toolId,
      toolName: `Tool ${toolId}`,
      title: 'explain',
      selectedText: 'selected',
      contextText: 'context',
      promptSnapshot: 'prompt',
      createdAt: at,
      updatedAt: at,
    },
    messages: [message(100 + conversationId, conversationId)],
    tools: DEFAULT_SETTINGS.tools
      .filter((tool) => tool.enabled)
      .slice(0, tools.length)
      .map((tool, index) => ({
        tool: { ...tool, id: tools[index].toolId },
        conversationId: tools[index].conversationId,
      })),
    activeToolId: toolId,
  }
}

function state(input: Partial<TabSessionState> = {}): TabSessionState {
  return {
    tabId: 9,
    windowId: 19,
    pageUrl: PAGE_NORMALIZED,
    contentUIAppeared: false,
    sidePanelAppeared: false,
    latestUI: 'contentScript',
    selectionSessionId: 10,
    ...input,
  }
}

function contentState(): TabSessionState {
  return state({ contentUIAppeared: true, sidePanelAppeared: false, latestUI: 'contentScript' })
}

function panelState(): TabSessionState {
  return state({ contentUIAppeared: false, sidePanelAppeared: true, latestUI: 'sidePanel' })
}

function noneState(latestUI: TabSessionState['latestUI']): TabSessionState {
  return state({ contentUIAppeared: false, sidePanelAppeared: false, latestUI })
}

function panelOwnsOtherTab(): Record<string, TabSessionState> {
  return {
    '9': panelState(),
    '10': state({
      tabId: 10,
      windowId: 19,
      pageUrl: PAGE_NORMALIZED,
      contentUIAppeared: true,
      latestUI: 'contentScript',
      selectionSessionId: 11,
    }),
  }
}

function contentSource(tabId = 9, windowId = 19, url = PAGE): UiEventSource {
  return {
    surface: 'contentScript',
    tabId,
    windowId,
    pageUrl: url,
    requestId: 'req-content',
  }
}

function sender(tabId = 9, windowId = 19, url = PAGE): chrome.runtime.MessageSender {
  return { tab: { id: tabId, windowId, url } as chrome.tabs.Tab, url }
}

function toggleRequest(): PanelToggleRequest {
  return { requestId: 'toggle-1', type: 'shortcut.panelToggle', payload: {} }
}

function selectionRequest(): SelectionRouteRequest {
  return {
    requestId: 'selection-1',
    type: 'selection.route',
    payload: { selectedText: 'selected', contextText: 'context' },
  }
}

function statusRequest(
  status: SurfaceStatusRequest['payload']['status'],
  selectionSessionId: number | null
): SurfaceStatusRequest {
  return {
    requestId: `status-${status}`,
    type: 'ui.surfaceStatus',
    payload: { status, selectionSessionId },
  }
}

function selectTool(index: number): SelectToolShortcutRequest {
  return { requestId: `select-${index}`, type: 'shortcut.selectTool', payload: { index } }
}

function cycleTool(
  direction: CycleToolShortcutRequest['payload']['direction']
): CycleToolShortcutRequest {
  return { requestId: `cycle-${direction}`, type: 'shortcut.cycleTool', payload: { direction } }
}

const streamDelta: ConversationUpdate = {
  type: 'stream.delta',
  conversationId: 22,
  messageId: 122,
  content: 'next',
}

const streamDone: ConversationUpdate = {
  type: 'stream.done',
  conversationId: 22,
  message: {
    ...message(122, 22),
    sequence: 2,
    role: 'assistant',
    content: 'finished',
    status: 'completed',
  },
}

function coordinatorWith(
  initial: TabSessionState | Record<string, TabSessionState> | null = null,
  extras: Partial<UiSessionCoordinatorDependencies> = {}
) {
  let saved: Record<string, TabSessionState> =
    initial === null
      ? {}
      : 'tabId' in initial
        ? { [`${initial.tabId}`]: { ...initial } }
        : Object.fromEntries(Object.entries(initial).map(([key, value]) => [key, { ...value }]))

  const snapshots = new Map<number, ConversationSnapshot>([
    [10, snapshot(10, 22)],
    [11, snapshot(11, 33, { tabId: 10 })],
  ])
  const created = snapshot(20, 44)

  const conversations = {
    createSelection: vi.fn(async () => created),
    loadSelectionSession: vi.fn(async (selectionSessionId: number) => {
      const current = snapshots.get(selectionSessionId)
      if (!current) throw new Error(`Missing session ${selectionSessionId}`)
      return current
    }),
    activateTool: vi.fn(async (selectionSessionId: number, toolId: number) =>
      snapshot(selectionSessionId, 50 + toolId, {
        toolId,
        tools: [
          { toolId: 1, conversationId: 22 },
          { toolId: 2, conversationId: 52 },
          { toolId: 3, conversationId: 53 },
        ],
      })
    ),
    stopSelectionSession: vi.fn(async () => undefined),
    deleteSelectionSession: vi.fn(async () => undefined),
    ...extras.conversations,
  }
  const tabs = {
    get: vi.fn(async (tabId: number) => ({
      id: tabId,
      windowId: tabId === 10 ? 20 : 19,
      url: PAGE,
    })),
    query: vi.fn(async (windowId: number) => [
      { id: 9, windowId, url: PAGE },
      { id: 10, windowId, url: PAGE },
    ]),
    ...extras.tabs,
  }
  const content = {
    destroy: vi.fn(async () => undefined),
    publish: vi.fn(async () => undefined),
    ...extras.content,
  }
  const sidePanel = {
    open: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    command: vi.fn(async () => true as const),
    publish: vi.fn(async () => undefined),
    ready: vi.fn(async () => undefined),
    ...extras.sidePanel,
  }
  const sessionStore = {
    load: vi.fn(async () => saved),
    save: vi.fn(async (state: Record<string, TabSessionState>) => {
      saved = Object.fromEntries(Object.entries(state).map(([key, value]) => [key, { ...value }]))
    }),
    ...extras.sessionStore,
  }
  const coordinator = createUiSessionCoordinator({
    conversations,
    loadSettings: async () => DEFAULT_SETTINGS,
    sessionStore,
    tabs,
    content,
    sidePanel,
    ...(extras.loadSettings ? { loadSettings: extras.loadSettings } : {}),
  })
  return {
    coordinator,
    conversations,
    tabs,
    content,
    sidePanel,
    sessionStore,
    saved: () => saved,
    created,
  }
}

describe('UiSessionCoordinator panel toggle', () => {
  it('routes a live stream by to without losing its terminal event during handoff', async () => {
    const ready = deferred<void>()
    const synchronized = deferred<void>()
    const panelEvents: string[] = []
    const { coordinator, content, saved, sidePanel } = coordinatorWith(contentState(), {
      sidePanel: {
        ready: vi.fn(() => ready.promise),
        publish: vi.fn(async (_windowId, update) => {
          panelEvents.push(update.type)
          if (update.type === 'conversation.sync') await synchronized.promise
        }),
      },
    })
    await coordinator.initialize()

    coordinator.openPanelForGesture(9, 19)
    const switching = coordinator.togglePanel(toggleRequest(), contentSource())
    await vi.waitFor(() => expect(sidePanel.ready).toHaveBeenCalledWith(19))

    await coordinator.publish(9, streamDelta)
    expect(content.publish).toHaveBeenCalledWith(9, streamDelta)
    expect(content.destroy).not.toHaveBeenCalled()

    ready.resolve(undefined)
    await vi.waitFor(() =>
      expect(sidePanel.publish).toHaveBeenCalledWith(
        19,
        expect.objectContaining({ type: 'conversation.sync' })
      )
    )
    await coordinator.publish(9, streamDone)
    expect(panelEvents).toEqual(['conversation.sync', 'stream.done'])
    expect(content.destroy).not.toHaveBeenCalled()

    synchronized.resolve(undefined)
    const result = await switching
    expect(content.destroy).toHaveBeenCalledWith(9)
    expect(result).toMatchObject({ currentUI: 'sidePanel', latestUI: 'sidePanel' })
    expect(saved()['9']).toMatchObject({
      contentUIAppeared: false,
      sidePanelAppeared: true,
      latestUI: 'sidePanel',
    })
    expect(saved()['9'].contentRestore).toBeUndefined()

    content.publish.mockClear()
    sidePanel.publish.mockClear()
    await coordinator.publish(9, streamDone)
    expect(sidePanel.publish).toHaveBeenCalledWith(19, streamDone)
    expect(content.publish).not.toHaveBeenCalled()
  })

  it('restores the current live snapshot to Content when panel synchronization fails', async () => {
    const live = snapshot(10, 22)
    live.messages.push({
      ...message(122, 22),
      sequence: 2,
      role: 'assistant',
      content: 'still streaming',
      status: 'streaming',
    })
    const { coordinator, content, saved, sidePanel } = coordinatorWith(contentState(), {
      conversations: {
        loadSelectionSession: vi.fn(async () => live),
      },
      sidePanel: {
        publish: vi.fn(async (_windowId, update) => {
          if (update.type === 'conversation.sync') throw new Error('sync rejected')
        }),
      },
    })
    await coordinator.initialize()

    coordinator.openPanelForGesture(9, 19)
    await expect(coordinator.togglePanel(toggleRequest(), contentSource())).rejects.toMatchObject({
      code: 'SIDE_PANEL_DELIVERY_FAILED',
    })

    expect(content.destroy).not.toHaveBeenCalled()
    expect(content.publish).toHaveBeenCalledWith(9, {
      type: 'conversation.sync',
      snapshot: live,
    })
    expect(saved()['9']).toMatchObject({
      contentUIAppeared: true,
      sidePanelAppeared: false,
      latestUI: 'contentScript',
    })
    expect(sidePanel.publish).toHaveBeenCalledWith(19, {
      type: 'conversation.sync',
      snapshot: live,
    })
  })

  it('invalidates a pending handoff when the panel closes and ignores its late acknowledgement', async () => {
    const synchronized = deferred<void>()
    const { coordinator, content, saved, sidePanel } = coordinatorWith(contentState(), {
      sidePanel: {
        publish: vi.fn(async (_windowId, update) => {
          if (update.type === 'conversation.sync') await synchronized.promise
        }),
      },
    })
    await coordinator.initialize()

    coordinator.openPanelForGesture(9, 19)
    const switching = coordinator.togglePanel(toggleRequest(), contentSource())
    void switching.catch(() => undefined)
    await vi.waitFor(() =>
      expect(sidePanel.publish).toHaveBeenCalledWith(
        19,
        expect.objectContaining({ type: 'conversation.sync' })
      )
    )

    await coordinator.onPanelClosed(19)
    await coordinator.publish(9, streamDone)
    expect(content.publish).toHaveBeenCalledWith(9, streamDone)
    expect(content.destroy).not.toHaveBeenCalled()

    synchronized.resolve(undefined)
    await expect(switching).rejects.toMatchObject({ code: 'SIDE_PANEL_DELIVERY_FAILED' })
    expect(saved()['9']).toMatchObject({
      contentUIAppeared: true,
      sidePanelAppeared: false,
      latestUI: 'contentScript',
    })
  })

  it('keeps Content as owner when its teardown fails after panel synchronization', async () => {
    const live = snapshot(10, 22)
    const { coordinator, content, saved } = coordinatorWith(contentState(), {
      content: {
        destroy: vi.fn(async () => {
          throw new Error('content teardown failed')
        }),
      },
      conversations: {
        loadSelectionSession: vi.fn(async () => live),
      },
    })
    await coordinator.initialize()

    coordinator.openPanelForGesture(9, 19)
    await expect(coordinator.togglePanel(toggleRequest(), contentSource())).rejects.toMatchObject({
      code: 'SIDE_PANEL_DELIVERY_FAILED',
    })

    expect(content.publish).toHaveBeenCalledWith(9, {
      type: 'conversation.sync',
      snapshot: live,
    })
    expect(saved()['9']).toMatchObject({
      contentUIAppeared: true,
      sidePanelAppeared: false,
      latestUI: 'contentScript',
    })
  })

  it('invalidates a pending handoff immediately when the tab navigates', async () => {
    const synchronized = deferred<void>()
    const { coordinator, content, sidePanel } = coordinatorWith(contentState(), {
      sidePanel: {
        publish: vi.fn(async (_windowId, update) => {
          if (update.type === 'conversation.sync') await synchronized.promise
        }),
      },
    })
    await coordinator.initialize()

    coordinator.openPanelForGesture(9, 19)
    const switching = coordinator.togglePanel(toggleRequest(), contentSource())
    void switching.catch(() => undefined)
    await vi.waitFor(() =>
      expect(sidePanel.publish).toHaveBeenCalledWith(
        19,
        expect.objectContaining({ type: 'conversation.sync' })
      )
    )

    const navigation = coordinator.onTabUpdated(9, 19, OTHER_PAGE)
    void navigation.catch(() => undefined)
    synchronized.resolve(undefined)

    await expect(switching).rejects.toMatchObject({ code: 'UI_SESSION_STALE' })
    expect(content.destroy).not.toHaveBeenCalled()
    await navigation
  })

  it('invalidates a pending handoff when the tab is removed', async () => {
    const synchronized = deferred<void>()
    const { coordinator, content, saved, sidePanel } = coordinatorWith(contentState(), {
      sidePanel: {
        publish: vi.fn(async (_windowId, update) => {
          if (update.type === 'conversation.sync') await synchronized.promise
        }),
      },
    })
    await coordinator.initialize()

    coordinator.openPanelForGesture(9, 19)
    const switching = coordinator.togglePanel(toggleRequest(), contentSource())
    void switching.catch(() => undefined)
    await vi.waitFor(() =>
      expect(sidePanel.publish).toHaveBeenCalledWith(
        19,
        expect.objectContaining({ type: 'conversation.sync' })
      )
    )

    await coordinator.onTabRemoved(9, 19)
    synchronized.resolve(undefined)

    await expect(switching).rejects.toMatchObject({ code: 'UI_SESSION_STALE' })
    expect(content.destroy).not.toHaveBeenCalled()
    expect(saved()['9']).toBeUndefined()
  })

  it.each([
    ['content appeared', contentState(), 'sidePanel'],
    ['panel appeared', panelState(), 'none'],
    ['none latest content', noneState('contentScript'), 'contentScript'],
    ['none latest panel', noneState('sidePanel'), 'sidePanel'],
  ] as const)('%s transitions to %s', async (_name, initial, expected) => {
    const { coordinator } = coordinatorWith(initial)
    await coordinator.initialize()

    const result = await coordinator.togglePanel(toggleRequest(), contentSource())

    expect(result.currentUI).toBe(expected)
  })

  it('closes Chrome Side Panel directly without sending a close command', async () => {
    const { coordinator, sidePanel } = coordinatorWith(panelState())
    await coordinator.initialize()

    await coordinator.togglePanel(toggleRequest(), contentSource())

    expect(sidePanel.close).toHaveBeenCalledWith(19)
    expect(sidePanel.command).not.toHaveBeenCalledWith(19, { type: 'close' })
  })

  it('opens the panel once when the user gesture already started the open', async () => {
    const { coordinator, sidePanel } = coordinatorWith(contentState())
    await coordinator.initialize()

    // The runtime boundary starts the open inside the user-gesture window.
    coordinator.openPanelForGesture(9, 19)
    await coordinator.togglePanel(toggleRequest(), contentSource())

    expect(sidePanel.open).toHaveBeenCalledTimes(1)
    expect(sidePanel.open).toHaveBeenCalledWith(9)
    expect(sidePanel.ready).toHaveBeenCalledWith(19)
    expect(sidePanel.ready).toHaveBeenCalledBefore(sidePanel.publish)
    expect(sidePanel.publish).toHaveBeenCalledWith(19, {
      type: 'conversation.sync',
      snapshot: expect.anything(),
    })
  })

  it('does not open the panel for a hidden Content UI whose latest owner is Content', async () => {
    const { coordinator, sidePanel } = coordinatorWith(noneState('contentScript'))
    await coordinator.initialize()

    coordinator.openPanelForGesture(9, 19, false)
    const result = await coordinator.togglePanel(
      {
        requestId: 'toggle-content-restore',
        type: 'shortcut.panelToggle',
        payload: { contentUIAppeared: false },
      },
      contentSource()
    )

    expect(sidePanel.open).not.toHaveBeenCalled()
    expect(result.currentUI).toBe('contentScript')
  })

  it('waits for the panel port before dispatching the toggle-open command', async () => {
    const { coordinator, sidePanel } = coordinatorWith(contentState())
    await coordinator.initialize()

    const calls: string[] = []
    sidePanel.ready.mockImplementation(async () => {
      calls.push('ready')
    })
    sidePanel.publish.mockImplementation(async () => {
      calls.push('publish')
    })

    coordinator.openPanelForGesture(9, 19)
    await coordinator.togglePanel(toggleRequest(), contentSource())

    expect(calls).toEqual(['ready', 'publish'])
  })

  it('does not open when the panel is already open and the toggle closes it', async () => {
    const { coordinator, sidePanel } = coordinatorWith(panelState())
    await coordinator.initialize()

    coordinator.openPanelForGesture(9, 19)
    await coordinator.togglePanel(toggleRequest(), contentSource())

    expect(sidePanel.open).not.toHaveBeenCalled()
    expect(sidePanel.close).toHaveBeenCalledWith(19)
  })
})

describe('UiSessionCoordinator routing and ownership', () => {
  it('routes one selection to an appeared panel and returns display false', async () => {
    const { coordinator, conversations, sidePanel } = coordinatorWith(panelState())
    await coordinator.initialize()
    await coordinator.reportPanelStatus(statusRequest('appeared', 10), { tabId: 9, windowId: 19 })

    const result = await coordinator.routeSelection(selectionRequest(), sender())

    expect(conversations.createSelection).toHaveBeenCalledTimes(1)
    expect(sidePanel.open).not.toHaveBeenCalled()
    expect(sidePanel.ready).not.toHaveBeenCalled()
    expect(sidePanel.publish).toHaveBeenCalledWith(
      19,
      expect.objectContaining({ type: 'conversation.sync' })
    )
    expect(result).toEqual({ target: 'sidePanel', display: false, snapshot: null })
  })

  it('propagates a ready wait failure instead of dispatching the command', async () => {
    const { coordinator, sidePanel } = coordinatorWith(contentState())
    await coordinator.initialize()

    sidePanel.ready.mockImplementation(async () => {
      throw new Error('side panel not ready')
    })

    coordinator.openPanelForGesture(9, 19)
    await expect(coordinator.togglePanel(toggleRequest(), contentSource())).rejects.toThrow(
      'side panel not ready'
    )
    expect(sidePanel.command).not.toHaveBeenCalledWith(19, expect.anything())
  })

  it('falls back to content with the same snapshot when panel delivery fails', async () => {
    const { coordinator, content, conversations, saved, sidePanel, created } = coordinatorWith(
      panelState(),
      {
        sidePanel: {
          publish: vi.fn(async () => {
            throw new Error('delivery failed')
          }),
        },
      }
    )
    await coordinator.initialize()
    await coordinator.reportPanelStatus(statusRequest('appeared', 10), { tabId: 9, windowId: 19 })

    const result = await coordinator.routeSelection(selectionRequest(), sender())

    expect(conversations.createSelection).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ target: 'contentScript', display: true, snapshot: created })
    expect(saved()['9'].sidePanelAppeared).toBe(false)
    sidePanel.publish.mockClear()
    const update: ConversationUpdate = { type: 'conversation.sync', snapshot: snapshot(10, 22) }
    await coordinator.publish(9, update)
    expect(content.publish).toHaveBeenCalledWith(9, update)
    expect(sidePanel.publish).not.toHaveBeenCalled()
  })

  it('preserves a session for the same URL with a different hash', async () => {
    const { coordinator, conversations, saved } = coordinatorWith(contentState())
    await coordinator.initialize()

    const response = await coordinator.reportContentStatus(
      statusRequest('appeared', null),
      sender(9, 19, 'https://example.com/docs/rust?chapter=1#later')
    )

    expect(conversations.stopSelectionSession).not.toHaveBeenCalled()
    expect(conversations.deleteSelectionSession).not.toHaveBeenCalled()
    expect(response.selectionSessionId).toBe(10)
    expect(saved()['9'].selectionSessionId).toBe(10)
  })

  it('stops and deletes the old session when pathname or search changes', async () => {
    const { coordinator, conversations, saved } = coordinatorWith(contentState())
    await coordinator.initialize()

    await coordinator.onTabUpdated(9, 19, OTHER_PAGE)

    expect(conversations.stopSelectionSession).toHaveBeenCalledWith(10)
    expect(conversations.deleteSelectionSession).toHaveBeenCalledWith(10)
    expect(saved()['9'].pageUrl).toBe(OTHER_PAGE)
    expect(saved()['9'].selectionSessionId).toBeNull()
  })

  it('destroys every appeared content UI when a global panel opens', async () => {
    const initial = {
      '9': contentState(),
      '10': state({
        tabId: 10,
        windowId: 19,
        pageUrl: PAGE_NORMALIZED,
        contentUIAppeared: true,
        selectionSessionId: 11,
      }),
    }
    const { coordinator, content, sidePanel } = coordinatorWith(initial)
    await coordinator.initialize()

    await coordinator.togglePanel(toggleRequest(), contentSource())

    expect(sidePanel.open).toHaveBeenCalledWith(9)
    expect(content.destroy).toHaveBeenCalledWith(9)
    expect(content.destroy).toHaveBeenCalledWith(10)
  })

  it('renders the active tab session or clears the panel on tab activation', async () => {
    const initial = {
      '9': panelState(),
      '10': state({
        tabId: 10,
        windowId: 19,
        pageUrl: PAGE_NORMALIZED,
        sidePanelAppeared: false,
        selectionSessionId: null,
      }),
    }
    const { coordinator, sidePanel } = coordinatorWith(initial, {
      tabs: {
        get: vi.fn(async (tabId: number) => ({ id: tabId, windowId: 19, url: PAGE })),
      },
    })
    await coordinator.initialize()

    await coordinator.onTabActivated(9, 19)
    expect(sidePanel.publish).toHaveBeenCalledWith(
      19,
      expect.objectContaining({ type: 'conversation.sync' })
    )

    await coordinator.onTabActivated(10, 19)
    expect(sidePanel.command).toHaveBeenCalledWith(19, { type: 'clear' })
  })

  it('isolates panels and content cleanup by windowId', async () => {
    const initial = {
      '9': contentState(),
      '10': state({
        tabId: 10,
        windowId: 20,
        pageUrl: PAGE_NORMALIZED,
        contentUIAppeared: true,
        selectionSessionId: 11,
      }),
    }
    const { coordinator, content, sidePanel } = coordinatorWith(initial, {
      tabs: {
        query: vi.fn(async (windowId: number) => [{ id: 9, windowId, url: PAGE }]),
      },
    })
    await coordinator.initialize()

    await coordinator.togglePanel(toggleRequest(), contentSource(9, 19, PAGE))

    expect(sidePanel.open).toHaveBeenCalledWith(9)
    expect(content.destroy).toHaveBeenCalledWith(9)
    expect(content.destroy).not.toHaveBeenCalledWith(10)
  })

  it('ignores both tool shortcuts when no UI appears', async () => {
    const { coordinator, conversations } = coordinatorWith(noneState('contentScript'))
    await coordinator.initialize()

    await expect(coordinator.selectTool(selectTool(1), contentSource())).resolves.toEqual({
      handled: false,
      reason: 'NO_APPEARED_UI',
    })
    await expect(coordinator.cycleTool(cycleTool('right'), contentSource())).resolves.toEqual({
      handled: false,
      reason: 'NO_APPEARED_UI',
    })
    expect(conversations.activateTool).not.toHaveBeenCalled()
  })

  it('rejects late work after tab removal closes its queue', async () => {
    let resumeCreate!: () => void
    const delayedSnapshot = snapshot(20, 44)
    const createSelection = vi.fn(
      () =>
        new Promise<ConversationSnapshot>((resolve) => {
          resumeCreate = () => resolve(delayedSnapshot)
        })
    )
    const { coordinator, sidePanel } = coordinatorWith(contentState(), {
      conversations: { createSelection },
    })
    await coordinator.initialize()

    const pending = coordinator.routeSelection(selectionRequest(), sender())
    void pending.catch(() => undefined)
    await vi.waitFor(() => expect(createSelection).toHaveBeenCalledTimes(1))
    await coordinator.onTabRemoved(9, 19)
    resumeCreate()

    await expect(pending).rejects.toMatchObject({ code: 'UI_SESSION_STALE' })
    expect(sidePanel.command).not.toHaveBeenCalled()
  })

  it('publishes updates only to the current owner', async () => {
    const { coordinator, content, sidePanel } = coordinatorWith(panelState())
    await coordinator.initialize()
    await coordinator.reportPanelStatus(statusRequest('appeared', 10), { tabId: 9, windowId: 19 })
    const update: ConversationUpdate = { type: 'conversation.sync', snapshot: snapshot(10, 22) }

    const delivered = await coordinator.publish(9, update)

    expect(delivered).toBe(true)
    expect(sidePanel.publish).toHaveBeenCalledWith(19, update)
    expect(content.publish).not.toHaveBeenCalled()
  })

  it('publishes to content and reports delivery when content owns the tab', async () => {
    const { coordinator, content, sidePanel } = coordinatorWith(contentState())
    await coordinator.initialize()
    const update: ConversationUpdate = { type: 'conversation.sync', snapshot: snapshot(10, 22) }

    const delivered = await coordinator.publish(9, update)

    expect(delivered).toBe(true)
    expect(content.publish).toHaveBeenCalledWith(9, update)
    expect(sidePanel.publish).not.toHaveBeenCalled()
  })

  it('reports no delivery when no surface owns the tab', async () => {
    const { coordinator, content, sidePanel } = coordinatorWith(noneState('contentScript'))
    await coordinator.initialize()
    const update: ConversationUpdate = { type: 'conversation.sync', snapshot: snapshot(10, 22) }

    const delivered = await coordinator.publish(9, update)

    expect(delivered).toBe(false)
    expect(content.publish).not.toHaveBeenCalled()
    expect(sidePanel.publish).not.toHaveBeenCalled()
  })
})

describe('UiSessionCoordinator stale identity revalidation', () => {
  it('rejects a queued selection whose page identity is outdated', async () => {
    const { coordinator, conversations } = coordinatorWith(contentState())
    await coordinator.initialize()
    await coordinator.onTabUpdated(9, 19, OTHER_PAGE)

    await expect(
      coordinator.routeSelection(selectionRequest(), sender(9, 19, PAGE))
    ).rejects.toMatchObject({
      code: 'UI_SESSION_STALE',
    })

    expect(conversations.createSelection).not.toHaveBeenCalled()
  })

  it('rejects a queued toggle whose page identity is outdated', async () => {
    const { coordinator, sidePanel } = coordinatorWith(contentState())
    await coordinator.initialize()
    await coordinator.onTabUpdated(9, 19, OTHER_PAGE)

    await expect(
      coordinator.togglePanel(toggleRequest(), contentSource(9, 19, PAGE))
    ).rejects.toMatchObject({
      code: 'UI_SESSION_STALE',
    })

    expect(sidePanel.open).not.toHaveBeenCalled()
    expect(sidePanel.close).not.toHaveBeenCalled()
  })

  it('does not let onTabActivated mutations interleave an in-flight selection', async () => {
    let resumeCreate!: () => void
    const delayedSnapshot = snapshot(20, 44)
    const createSelection = vi.fn(
      () =>
        new Promise<ConversationSnapshot>((resolve) => {
          resumeCreate = () => resolve(delayedSnapshot)
        })
    )
    const staleWindow = {
      '9': state({
        tabId: 9,
        windowId: 19,
        pageUrl: PAGE_NORMALIZED,
        contentUIAppeared: true,
        sidePanelAppeared: true,
        latestUI: 'contentScript',
        selectionSessionId: 10,
      }),
    }
    const { coordinator, content, conversations, saved } = coordinatorWith(staleWindow, {
      conversations: {
        createSelection,
        loadSelectionSession: vi.fn(async () => delayedSnapshot),
      },
    })
    await coordinator.initialize()

    const selection = coordinator.routeSelection(selectionRequest(), sender())
    void selection.catch(() => undefined)
    await vi.waitFor(() => expect(createSelection).toHaveBeenCalledTimes(1))

    // Activation lands while the queued selection is still creating its run.
    const activation = coordinator.onTabActivated(9, 19)
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(content.destroy).not.toHaveBeenCalled()
    expect(conversations.deleteSelectionSession).not.toHaveBeenCalled()

    resumeCreate()
    await expect(selection).resolves.toMatchObject({ target: 'contentScript', display: true })
    expect(saved()['9'].selectionSessionId).toBe(20)
    await activation

    expect(content.destroy).toHaveBeenCalledTimes(1)
    expect(saved()['9'].latestUI).toBe('sidePanel')
  })

  it('does not resurrect a removed tab after onTabRemoved interleaves an update', async () => {
    let resolveStop!: () => void
    const stopPromise = new Promise<void>((resolve) => {
      resolveStop = () => resolve()
    })
    const stopSelectionSession = vi.fn(() => stopPromise)
    const { coordinator, saved } = coordinatorWith(contentState(), {
      conversations: {
        stopSelectionSession,
        deleteSelectionSession: vi.fn(async () => undefined),
      },
    })
    await coordinator.initialize()

    const pendingUpdate = coordinator.onTabUpdated(9, 19, OTHER_PAGE)
    void pendingUpdate.catch(() => undefined)
    await vi.waitFor(() => expect(stopSelectionSession).toHaveBeenCalledTimes(1))

    const removal = coordinator.onTabRemoved(9, 19)
    void removal.catch(() => undefined)
    await vi.waitFor(() => expect(saved()['9']).toBeUndefined())
    resolveStop()

    await expect(pendingUpdate).rejects.toMatchObject({ code: 'UI_SESSION_STALE' })
    await removal
    // A later window event must not re-persist the removed tab from a ghost entry.
    await coordinator.onPanelOpened(19)
    expect(saved()['9']).toBeUndefined()
  })

  it('deletes the orphaned session when the post-create revalidation rejects', async () => {
    let resumeCreate!: () => void
    const delayedSnapshot = snapshot(20, 44)
    const createSelection = vi.fn(
      () =>
        new Promise<ConversationSnapshot>((resolve) => {
          resumeCreate = () => resolve(delayedSnapshot)
        })
    )
    const { coordinator, conversations } = coordinatorWith(contentState(), {
      conversations: { createSelection },
    })
    await coordinator.initialize()

    const pending = coordinator.routeSelection(selectionRequest(), sender())
    void pending.catch(() => undefined)
    await vi.waitFor(() => expect(createSelection).toHaveBeenCalledTimes(1))
    await coordinator.onTabRemoved(9, 19)
    resumeCreate()

    await expect(pending).rejects.toMatchObject({ code: 'UI_SESSION_STALE' })
    expect(conversations.deleteSelectionSession).toHaveBeenCalledWith(20)
  })

  it('rejects a stale toggle before closing the panel when the tab is removed mid-flight', async () => {
    let resumeLoad!: () => void
    const loadSelectionSession = vi.fn(
      () =>
        new Promise<ConversationSnapshot>((resolve) => {
          resumeLoad = () => resolve(snapshot(10, 22))
        })
    )
    const { coordinator, sidePanel } = coordinatorWith(panelState(), {
      conversations: { loadSelectionSession },
    })
    await coordinator.initialize()

    const pending = coordinator.togglePanel(toggleRequest(), contentSource())
    void pending.catch(() => undefined)
    await vi.waitFor(() => expect(loadSelectionSession).toHaveBeenCalledTimes(1))
    await coordinator.onTabRemoved(9, 19)
    resumeLoad()

    await expect(pending).rejects.toMatchObject({ code: 'UI_SESSION_STALE' })
    expect(sidePanel.close).not.toHaveBeenCalled()
  })

  it('rejects a selection routed after tab removal without creating a run', async () => {
    const { coordinator, conversations } = coordinatorWith(contentState())
    await coordinator.initialize()
    await coordinator.onTabRemoved(9, 19)

    await expect(coordinator.routeSelection(selectionRequest(), sender())).rejects.toMatchObject({
      code: 'UI_SESSION_STALE',
    })

    expect(conversations.createSelection).not.toHaveBeenCalled()
  })

  it('does not recreate stored state for a status report after tab removal', async () => {
    const { coordinator, saved } = coordinatorWith(contentState())
    await coordinator.initialize()
    await coordinator.onTabRemoved(9, 19)

    await expect(
      coordinator.reportContentStatus(statusRequest('appeared', 10), sender())
    ).rejects.toMatchObject({
      code: 'UI_SESSION_STALE',
    })

    expect(saved()['9']).toBeUndefined()
  })
})

describe('UiSessionCoordinator active-tab panel ownership', () => {
  it('routes a selection to content when the appeared panel targets a different active tab', async () => {
    const { coordinator, sidePanel, saved } = coordinatorWith(panelOwnsOtherTab())
    await coordinator.initialize()
    await coordinator.reportPanelStatus(statusRequest('appeared', 10), { tabId: 9, windowId: 19 })

    const result = await coordinator.routeSelection(selectionRequest(), sender(10, 19, PAGE))

    expect(result.target).toBe('contentScript')
    expect(result.display).toBe(true)
    expect(sidePanel.command).not.toHaveBeenCalled()
    expect(saved()['10'].latestUI).toBe('contentScript')
    expect(saved()['9'].latestUI).toBe('sidePanel')
  })

  it('publishes to content when the panel targets a different active tab', async () => {
    const { coordinator, content, sidePanel } = coordinatorWith(panelOwnsOtherTab())
    await coordinator.initialize()
    await coordinator.reportPanelStatus(statusRequest('appeared', 10), { tabId: 9, windowId: 19 })
    const update: ConversationUpdate = { type: 'conversation.sync', snapshot: snapshot(10, 22) }

    await coordinator.publish(10, update)

    expect(content.publish).toHaveBeenCalledWith(10, update)
    expect(content.publish).toHaveBeenCalledTimes(1)
    expect(sidePanel.publish).not.toHaveBeenCalled()
  })

  it('targets tool shortcuts at the panel only for its active tab', async () => {
    const { coordinator, content, sidePanel } = coordinatorWith(panelOwnsOtherTab())
    await coordinator.initialize()
    await coordinator.reportPanelStatus(statusRequest('appeared', 10), { tabId: 9, windowId: 19 })

    const contentResult = await coordinator.selectTool(selectTool(1), contentSource(10, 19, PAGE))
    const panelResult = await coordinator.selectTool(selectTool(1), contentSource(9, 19, PAGE))

    expect(panelResult).toEqual({
      handled: true,
      target: 'sidePanel',
      snapshot: expect.any(Object),
    })
    expect(contentResult).toEqual({
      handled: true,
      target: 'contentScript',
      snapshot: expect.any(Object),
    })
    expect(sidePanel.publish).toHaveBeenCalledWith(
      19,
      expect.objectContaining({ type: 'conversation.toolChanged' })
    )
    expect(sidePanel.publish).toHaveBeenCalledTimes(1)
    expect(content.publish).toHaveBeenCalledTimes(1)
    expect(content.publish).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ type: 'conversation.sync' })
    )
  })
})

describe('UiSessionCoordinator latestUI restore semantics', () => {
  it('restores content delivery when latestUI is contentScript and nothing appears', async () => {
    const { coordinator, content, sidePanel } = coordinatorWith(noneState('contentScript'))
    await coordinator.initialize()

    const result = await coordinator.togglePanel(toggleRequest(), contentSource())

    expect(result).toMatchObject({
      currentUI: 'contentScript',
      action: 'restore',
      latestUI: 'contentScript',
    })
    expect(content.publish).toHaveBeenCalledTimes(1)
    expect(sidePanel.open).not.toHaveBeenCalled()
  })

  it('restores panel delivery when latestUI is sidePanel and nothing appears', async () => {
    const { coordinator, content, sidePanel } = coordinatorWith(noneState('sidePanel'))
    await coordinator.initialize()

    const result = await coordinator.togglePanel(toggleRequest(), contentSource())

    expect(result).toMatchObject({
      currentUI: 'sidePanel',
      action: 'restore',
      latestUI: 'sidePanel',
    })
    expect(sidePanel.open).toHaveBeenCalledWith(9)
    expect(content.publish).not.toHaveBeenCalled()
  })

  it('resets latestUI to the content default after navigating to a new page', async () => {
    const { coordinator, saved } = coordinatorWith(panelState())
    await coordinator.initialize()

    await coordinator.onTabUpdated(9, 19, OTHER_PAGE)

    expect(saved()['9'].pageUrl).toBe(OTHER_PAGE)
    expect(saved()['9'].latestUI).toBe('contentScript')
    expect(saved()['9'].selectionSessionId).toBeNull()
  })
})
