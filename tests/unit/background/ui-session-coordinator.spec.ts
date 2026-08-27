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
      selectionKey: selectionSessionId,
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
})

describe('UiSessionCoordinator routing and ownership', () => {
  it('routes one selection to an appeared panel and returns display false', async () => {
    const { coordinator, conversations, sidePanel } = coordinatorWith(panelState())
    await coordinator.initialize()

    const result = await coordinator.routeSelection(selectionRequest(), sender())

    expect(conversations.createSelection).toHaveBeenCalledTimes(1)
    expect(sidePanel.open).not.toHaveBeenCalled()
    expect(sidePanel.command).toHaveBeenCalledWith(19, expect.objectContaining({ type: 'render' }))
    expect(result).toEqual({ target: 'sidePanel', display: false, snapshot: null })
  })

  it('falls back to content with the same snapshot when panel delivery fails', async () => {
    const sidePanel = {
      command: vi.fn(async () => {
        throw new Error('delivery failed')
      }),
    }
    const { coordinator, conversations, created } = coordinatorWith(panelState(), { sidePanel })
    await coordinator.initialize()

    const result = await coordinator.routeSelection(selectionRequest(), sender())

    expect(conversations.createSelection).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ target: 'contentScript', display: true, snapshot: created })
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
    expect(sidePanel.command).toHaveBeenCalledWith(19, expect.objectContaining({ type: 'render' }))

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
    const update: ConversationUpdate = { type: 'conversation.sync', snapshot: snapshot(10, 22) }

    await coordinator.publish(9, update)

    expect(sidePanel.publish).toHaveBeenCalledWith(19, update)
    expect(content.publish).not.toHaveBeenCalled()
  })
})
