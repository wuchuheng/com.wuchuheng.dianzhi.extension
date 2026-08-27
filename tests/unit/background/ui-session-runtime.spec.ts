import { describe, expect, it, vi } from 'vitest'
import {
  createUiSessionEventHandlers,
  panelSourceFromBinding,
  publishToOwnerWithFallback,
  reconcileUiSessionState,
  registerUiSessionRuntime,
  resolvePanelBinding,
  SIDE_PANEL_PAGE_PATH,
  type UiSessionCoordinator,
  type UiSessionEventHandlers,
} from '@/background/ui-session-runtime'
import { createUiSessionCoordinator } from '@/background/ui-session-coordinator'
import { DEFAULT_SETTINGS } from '@/dianzhi/domain/settings'
import type {
  ConversationSnapshot,
  ConversationUpdate,
  MessageRecord,
} from '@/dianzhi/domain/protocol'
import type {
  SelectionRouteResult,
  SidePanelCommand,
  SurfaceStatusResponse,
} from '@/dianzhi/domain/ui-session-protocol'
import type { TargetedSidePanelEvent } from '@/events/sidePanel/sidePanel'

const at = '2026-08-27T00:00:00.000Z'
const PAGE = 'https://example.com/docs/rust?chapter=1#intro'
const PAGE_NORMALIZED = 'https://example.com/docs/rust?chapter=1'
const PAGE_2 = 'https://example.com/docs/rust?chapter=2'
const PANEL_PATH = SIDE_PANEL_PAGE_PATH
const PANEL_URL = `chrome-extension://fake-id/${PANEL_PATH}`

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
  input: { tabId?: number; toolId?: number; selectedText?: string; contextText?: string } = {}
): ConversationSnapshot {
  const tabId = input.tabId ?? 9
  const toolId = input.toolId ?? 1
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
      selectedText: input.selectedText ?? 'selected',
      contextText: input.contextText ?? 'context',
      promptSnapshot: 'prompt',
      createdAt: at,
      updatedAt: at,
    },
    messages: [message(100 + conversationId, conversationId)],
    tools: DEFAULT_SETTINGS.tools
      .filter((tool) => tool.enabled)
      .slice(0, 3)
      .map((tool) => ({
        tool: { ...tool },
        conversationId: tool.id === toolId ? conversationId : null,
      })),
    activeToolId: toolId,
  }
}

function tab(id: number, windowId: number, url: string): chrome.tabs.Tab {
  return { id, windowId, url } as chrome.tabs.Tab
}

function sender(tabId = 9, windowId = 19, url = PAGE): chrome.runtime.MessageSender {
  return { tab: { id: tabId, windowId, url } as chrome.tabs.Tab, url }
}

function panelSender(documentId: string): chrome.runtime.MessageSender {
  return {
    id: 'fake-id',
    origin: 'chrome-extension://fake-id',
    url: PANEL_URL,
    documentId,
  } as chrome.runtime.MessageSender
}

function panelContext(documentId: string, windowId: number): chrome.runtime.ExtensionContext {
  return {
    contextType: 'SIDE_PANEL',
    contextId: `ctx-${documentId}`,
    documentId,
    documentOrigin: 'chrome-extension://fake-id',
    documentUrl: PANEL_URL,
    frameId: 0,
    incognito: false,
    tabId: -1,
    windowId,
  }
}

type Listener = (...args: unknown[]) => void

function fakeChromeEvent() {
  const listeners = new Set<Listener>()
  return {
    addListener: vi.fn((listener: Listener) => void listeners.add(listener)),
    removeListener: vi.fn((listener: Listener) => void listeners.delete(listener)),
    emit: (...args: unknown[]): void => {
      for (const listener of [...listeners]) listener(...args)
    },
  }
}

function fakeChromeRuntime(options: { panelContexts?: chrome.runtime.ExtensionContext[] } = {}) {
  const onActivated = fakeChromeEvent()
  const onUpdated = fakeChromeEvent()
  const onRemoved = fakeChromeEvent()
  const onOpened = fakeChromeEvent()
  const onClosed = fakeChromeEvent()
  const onConnect = fakeChromeEvent()
  const tabs = {
    onActivated,
    onUpdated,
    onRemoved,
    get: vi.fn(async (tabId: number) => ({ id: tabId, windowId: 19, url: PAGE })),
    query: vi.fn(async () => [{ id: 9, windowId: 19, url: PAGE }]),
  }
  const sidePanel = { onOpened, onClosed }
  const runtime = {
    onConnect,
    ContextType: { SIDE_PANEL: 'SIDE_PANEL' },
    getURL: (path: string) => `chrome-extension://fake-id/${path}`,
    getContexts: vi.fn(async () => options.panelContexts ?? []),
  }
  const chrome = { runtime, tabs, sidePanel } as unknown as typeof chrome
  return { chrome, tabs, sidePanel, runtime, onActivated, onUpdated, onRemoved, onOpened, onClosed }
}

function stubSidePanelEvent(): TargetedSidePanelEvent<SidePanelCommand, true> {
  return {
    dispatch: vi.fn(async () => true as const),
    accept: vi.fn(() => false),
    handle: vi.fn(() => () => undefined),
  }
}

function statusResponse(): SurfaceStatusResponse {
  return { currentUI: 'none', latestUI: 'contentScript', selectionSessionId: null }
}

function mockCoordinator(): UiSessionCoordinator {
  const coordinator: UiSessionCoordinator = {
    initialize: vi.fn(async () => undefined),
    reportContentStatus: vi.fn(async () => statusResponse()),
    reportPanelStatus: vi.fn(async () => statusResponse()),
    routeSelection: vi.fn(
      async () =>
        ({
          target: 'contentScript',
          display: true,
          snapshot: snapshot(20, 44),
        }) as SelectionRouteResult
    ),
    togglePanel: vi.fn(async () => ({
      currentUI: 'none',
      latestUI: 'contentScript',
      action: 'none',
      snapshot: null,
    })),
    selectTool: vi.fn(
      async () => ({ handled: false, reason: 'NO_APPEARED_UI' }) as ToolShortcutResult
    ),
    cycleTool: vi.fn(
      async () => ({ handled: false, reason: 'NO_APPEARED_UI' }) as ToolShortcutResult
    ),
    publish: vi.fn(async () => false),
    onTabActivated: vi.fn(async () => undefined),
    onTabUpdated: vi.fn(async () => undefined),
    onTabRemoved: vi.fn(async () => undefined),
    onPanelOpened: vi.fn(async () => undefined),
    onPanelClosed: vi.fn(async () => undefined),
  }
  return coordinator
}

const SNAPSHOT_UPDATE: ConversationUpdate = {
  type: 'conversation.sync',
  snapshot: snapshot(10, 22),
}

describe('ui-session-runtime: Chrome event routing', () => {
  it('routes tab activation and committed URL changes to the coordinator', async () => {
    const { chrome, tabs } = fakeChromeRuntime()
    const coordinator = mockCoordinator()
    registerUiSessionRuntime({
      chromeApi: chrome,
      coordinator,
      sidePanelCommand: stubSidePanelEvent(),
      sidePanelConversationUpdate: stubSidePanelEvent(),
    })
    tabs.onActivated.emit({ tabId: 9, windowId: 19 })
    tabs.onUpdated.emit(9, { status: 'loading', url: PAGE_2 }, tab(9, 19, PAGE_2))
    expect(coordinator.onTabActivated).toHaveBeenCalledWith(9, 19)
    expect(coordinator.onTabUpdated).toHaveBeenCalledWith(9, 19, PAGE_2)
  })

  it('routes tab removal with its window to the coordinator', async () => {
    const { chrome, tabs } = fakeChromeRuntime()
    const coordinator = mockCoordinator()
    registerUiSessionRuntime({
      chromeApi: chrome,
      coordinator,
      sidePanelCommand: stubSidePanelEvent(),
      sidePanelConversationUpdate: stubSidePanelEvent(),
    })
    tabs.onRemoved.emit(9, { windowId: 19, isWindowClosing: false })
    expect(coordinator.onTabRemoved).toHaveBeenCalledWith(9, 19)
  })

  it('ignores noncommitted and subframe updates', () => {
    const { chrome, tabs } = fakeChromeRuntime()
    const coordinator = mockCoordinator()
    registerUiSessionRuntime({
      chromeApi: chrome,
      coordinator,
      sidePanelCommand: stubSidePanelEvent(),
      sidePanelConversationUpdate: stubSidePanelEvent(),
    })
    tabs.onUpdated.emit(9, { status: 'complete', url: PAGE_2 }, tab(9, 19, PAGE_2))
    tabs.onUpdated.emit(9, { title: 'title changed' }, tab(9, 19, PAGE))
    expect(coordinator.onTabUpdated).not.toHaveBeenCalled()
  })

  it('uses native Side Panel open/closed events as lifecycle evidence', async () => {
    const { chrome, sidePanel } = fakeChromeRuntime()
    const coordinator = mockCoordinator()
    registerUiSessionRuntime({
      chromeApi: chrome,
      coordinator,
      sidePanelCommand: stubSidePanelEvent(),
      sidePanelConversationUpdate: stubSidePanelEvent(),
    })
    sidePanel.onOpened.emit({ windowId: 19, path: PANEL_PATH })
    sidePanel.onClosed.emit({ windowId: 19, path: PANEL_PATH })
    expect(coordinator.onPanelOpened).toHaveBeenCalledWith(19)
    expect(coordinator.onPanelClosed).toHaveBeenCalledWith(19)
  })

  it('ignores Side Panel open/closed events for other extension surface paths', () => {
    const { chrome, sidePanel } = fakeChromeRuntime()
    const coordinator = mockCoordinator()
    registerUiSessionRuntime({
      chromeApi: chrome,
      coordinator,
      sidePanelCommand: stubSidePanelEvent(),
      sidePanelConversationUpdate: stubSidePanelEvent(),
    })
    sidePanel.onOpened.emit({ windowId: 19, path: 'src/options/index.html' })
    sidePanel.onClosed.emit({ windowId: 19, path: 'src/options/index.html' })
    expect(coordinator.onPanelOpened).not.toHaveBeenCalled()
    expect(coordinator.onPanelClosed).not.toHaveBeenCalled()
  })

  it('accepts Side Panel ports from both bg2sp events on connect', () => {
    const { chrome, runtime } = fakeChromeRuntime()
    const command = stubSidePanelEvent()
    const updates = stubSidePanelEvent()
    registerUiSessionRuntime({
      chromeApi: chrome,
      coordinator: mockCoordinator(),
      sidePanelCommand: command,
      sidePanelConversationUpdate: updates,
    })
    const port = { name: 'anything', sender: { id: 'fake-id' } } as unknown as chrome.runtime.Port
    runtime.onConnect.emit(port)
    expect(command.accept).toHaveBeenCalledWith(port)
    expect(updates.accept).toHaveBeenCalledWith(port)
  })

  it('removes all listeners when the runtime is stopped', () => {
    const { chrome, tabs, sidePanel, runtime } = fakeChromeRuntime()
    const coordinator = mockCoordinator()
    const stop = registerUiSessionRuntime({
      chromeApi: chrome,
      coordinator,
      sidePanelCommand: stubSidePanelEvent(),
      sidePanelConversationUpdate: stubSidePanelEvent(),
    })
    stop()
    tabs.onActivated.emit({ tabId: 9, windowId: 19 })
    tabs.onRemoved.emit(9, { windowId: 19, isWindowClosing: false })
    sidePanel.onOpened.emit({ windowId: 19, path: PANEL_PATH })
    runtime.onConnect.emit({ name: 'anything' } as unknown as chrome.runtime.Port)
    expect(coordinator.onTabActivated).not.toHaveBeenCalled()
    expect(coordinator.onTabRemoved).not.toHaveBeenCalled()
    expect(coordinator.onPanelOpened).not.toHaveBeenCalled()
  })

  it('registers on Chrome 141 without sidePanel.onClosed and still wires the other listeners', () => {
    const { chrome, tabs, sidePanel } = fakeChromeRuntime()
    // Chrome 141 exposes onOpened but not onClosed (added in Chrome 142).
    const chrome141 = {
      ...chrome,
      sidePanel: { onOpened: sidePanel.onOpened },
    } as unknown as typeof chrome
    const coordinator = mockCoordinator()
    const command = stubSidePanelEvent()
    const updates = stubSidePanelEvent()
    const stop = registerUiSessionRuntime({
      chromeApi: chrome141,
      coordinator,
      sidePanelCommand: command,
      sidePanelConversationUpdate: updates,
    })

    tabs.onActivated.emit({ tabId: 9, windowId: 19 })
    tabs.onRemoved.emit(9, { windowId: 19, isWindowClosing: false })
    tabs.onUpdated.emit(9, { status: 'loading', url: PAGE_2 }, tab(9, 19, PAGE_2))
    sidePanel.onOpened.emit({ windowId: 19, path: PANEL_PATH })
    sidePanel.onClosed.emit({ windowId: 19, path: PANEL_PATH })
    expect(coordinator.onTabActivated).toHaveBeenCalledWith(9, 19)
    expect(coordinator.onTabRemoved).toHaveBeenCalledWith(9, 19)
    expect(coordinator.onTabUpdated).toHaveBeenCalledWith(9, 19, PAGE_2)
    expect(coordinator.onPanelOpened).toHaveBeenCalledWith(19)
    expect(coordinator.onPanelClosed).not.toHaveBeenCalled()
    expect(stop).not.toThrow()
  })
})

describe('ui-session-runtime: panel sender to window resolution', () => {
  const twoWindows = [panelContext('doc-a', 19), panelContext('doc-b', 20)]

  it('resolves the panel sender to the active tab of its own window', async () => {
    const { chrome, tabs } = fakeChromeRuntime({ panelContexts: twoWindows })
    tabs.query.mockImplementation(async (queryInfo: chrome.tabs.QueryInfo) => {
      return queryInfo.windowId === 20
        ? [{ id: 12, windowId: 20, url: PAGE }]
        : [{ id: 9, windowId: 19, url: PAGE }]
    })
    const bindingA = await resolvePanelBinding(chrome, panelSender('doc-a'))
    const bindingB = await resolvePanelBinding(chrome, panelSender('doc-b'))
    expect(bindingA).toEqual({ tabId: 9, windowId: 19 })
    expect(bindingB).toEqual({ tabId: 12, windowId: 20 })
    expect(chrome.runtime.getContexts).toHaveBeenCalledWith({
      contextTypes: ['SIDE_PANEL'],
      documentUrls: [PANEL_URL],
    })
  })

  it('rejects a document URL fallback when multiple panel contexts are open', async () => {
    const { chrome } = fakeChromeRuntime({ panelContexts: twoWindows })
    const senderWithoutDocumentId = {
      id: 'fake-id',
      origin: 'chrome-extension://fake-id',
      url: PANEL_URL,
    } as chrome.runtime.MessageSender
    await expect(resolvePanelBinding(chrome, senderWithoutDocumentId)).rejects.toMatchObject({
      code: 'INVALID_EVENT',
    })
  })

  it('resolves by document URL when exactly one panel context is open', async () => {
    const { chrome, tabs } = fakeChromeRuntime({
      panelContexts: [panelContext('doc-a', 19)],
    })
    tabs.query.mockImplementation(async () => [{ id: 9, windowId: 19, url: PAGE }])
    const senderWithoutDocumentId = {
      id: 'fake-id',
      origin: 'chrome-extension://fake-id',
      url: PANEL_URL,
    } as chrome.runtime.MessageSender
    const binding = await resolvePanelBinding(chrome, senderWithoutDocumentId)
    expect(binding).toEqual({ tabId: 9, windowId: 19 })
  })

  it('rejects panel senders with no open Side Panel context', async () => {
    const { chrome } = fakeChromeRuntime({ panelContexts: twoWindows })
    await expect(resolvePanelBinding(chrome, panelSender('doc-closed'))).rejects.toMatchObject({
      code: 'INVALID_EVENT',
    })
  })

  it('builds a side panel event source from a binding', async () => {
    const { chrome, tabs } = fakeChromeRuntime()
    tabs.get.mockImplementation(async (tabId: number) => ({ id: tabId, windowId: 19, url: PAGE }))
    const source = await panelSourceFromBinding(chrome, { tabId: 9, windowId: 19 }, 'req-1')
    expect(source).toEqual({
      surface: 'sidePanel',
      tabId: 9,
      windowId: 19,
      pageUrl: PAGE,
      requestId: 'req-1',
    })
  })
})

describe('ui-session-runtime: typed request handlers', () => {
  it('parses content requests before calling content routes', async () => {
    const { chrome } = fakeChromeRuntime()
    const coordinator = mockCoordinator()
    const handlers = createUiSessionEventHandlers({ chromeApi: chrome, coordinator })
    await handlers.onSelectionRoute(
      {
        requestId: 'route-1',
        type: 'selection.route',
        payload: { selectedText: 'selected', contextText: 'context' },
      },
      sender()
    )
    expect(coordinator.routeSelection).toHaveBeenCalledTimes(1)
  })

  it('parses panel requests before calling panel routes', async () => {
    const { chrome } = fakeChromeRuntime({
      panelContexts: [panelContext('doc-a', 19)],
    })
    const coordinator = mockCoordinator()
    const handlers = createUiSessionEventHandlers({ chromeApi: chrome, coordinator })
    await handlers.onPanelSurfaceStatus(
      {
        requestId: 'panel-status',
        type: 'ui.surfaceStatus',
        payload: { status: 'appeared', selectionSessionId: null },
      },
      panelSender('doc-a')
    )
    expect(coordinator.reportPanelStatus).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'panel-status' }),
      { tabId: 9, windowId: 19 }
    )
  })

  it('rejects a cycle shortcut sent on the select channel', async () => {
    const { chrome } = fakeChromeRuntime()
    const coordinator = mockCoordinator()
    const handlers: UiSessionEventHandlers = createUiSessionEventHandlers({
      chromeApi: chrome,
      coordinator,
    })
    await expect(
      handlers.onContentSelectToolShortcut(
        {
          requestId: 'cycle-on-select',
          type: 'shortcut.cycleTool',
          payload: { direction: 'right' },
        },
        sender()
      )
    ).rejects.toMatchObject({ code: 'INVALID_EVENT' })
    expect(coordinator.selectTool).not.toHaveBeenCalled()
  })

  it('rejects an invalid request before invoking the coordinator', async () => {
    const { chrome } = fakeChromeRuntime()
    const coordinator = mockCoordinator()
    const handlers = createUiSessionEventHandlers({ chromeApi: chrome, coordinator })
    await expect(
      handlers.onSelectionRoute(
        {
          requestId: 'bad',
          type: 'selection.route',
          payload: { selectedText: '', contextText: '' },
        },
        sender()
      )
    ).rejects.toMatchObject({ code: 'INVALID_EVENT' })
    expect(coordinator.routeSelection).not.toHaveBeenCalled()
  })
})

describe('ui-session-runtime: owner-or-legacy publication fall-through', () => {
  it('relies on the coordinator and skips the legacy fallback when an owner delivered', async () => {
    const coordinator = mockCoordinator()
    vi.mocked(coordinator.publish).mockResolvedValue(true)
    const deliverToContent = vi.fn(async () => undefined)
    await publishToOwnerWithFallback({
      coordinator,
      tabId: 9,
      update: SNAPSHOT_UPDATE,
      deliverToContent,
    })
    expect(coordinator.publish).toHaveBeenCalledWith(9, SNAPSHOT_UPDATE)
    expect(deliverToContent).not.toHaveBeenCalled()
  })

  it('falls back to the content dispatch when the coordinator has no owner', async () => {
    const coordinator = mockCoordinator()
    vi.mocked(coordinator.publish).mockResolvedValue(false)
    const deliverToContent = vi.fn(async () => undefined)
    await publishToOwnerWithFallback({
      coordinator,
      tabId: 9,
      update: SNAPSHOT_UPDATE,
      deliverToContent,
    })
    expect(deliverToContent).toHaveBeenCalledWith(9, SNAPSHOT_UPDATE)
  })

  it('falls back to the content dispatch when the coordinator is not initialized', async () => {
    const deliverToContent = vi.fn(async () => undefined)
    await publishToOwnerWithFallback({
      coordinator: undefined,
      tabId: 9,
      update: SNAPSHOT_UPDATE,
      deliverToContent,
    })
    expect(deliverToContent).toHaveBeenCalledWith(9, SNAPSHOT_UPDATE)
  })
})

describe('ui-session-runtime: safe lifecycle logging', () => {
  function realCoordinator(
    input: {
      selectedText?: string
      contextText?: string
      apiKey?: string
    } = {}
  ) {
    const created = snapshot(20, 44, {
      selectedText: input.selectedText ?? 'selected',
      contextText: input.contextText ?? 'context',
    })
    const snapshots = new Map<number, ConversationSnapshot>()
    const conversations = {
      createSelection: vi.fn(async () => created),
      loadSelectionSession: vi.fn(async (id: number) => snapshots.get(id) ?? created),
      activateTool: vi.fn(async (id: number, toolId: number) => snapshot(id, 50 + toolId)),
      stopSelectionSession: vi.fn(async () => undefined),
      deleteSelectionSession: vi.fn(async () => undefined),
    }
    const coordinator = createUiSessionCoordinator({
      conversations,
      loadSettings: async () => ({
        ...DEFAULT_SETTINGS,
        provider: { ...DEFAULT_SETTINGS.provider, apiKey: input.apiKey ?? 'API_KEY_SENTINEL' },
      }),
      sessionStore: { load: async () => ({}), save: vi.fn(async () => undefined) },
      tabs: {
        get: vi.fn(async (tabId: number) => ({ id: tabId, windowId: 19, url: PAGE })),
        query: vi.fn(async (windowId: number) => [{ id: 9, windowId, url: PAGE }]),
      },
      content: { destroy: vi.fn(async () => undefined), publish: vi.fn(async () => undefined) },
      sidePanel: {
        open: vi.fn(async () => undefined),
        close: vi.fn(async () => undefined),
        command: vi.fn(async () => true as const),
        publish: vi.fn(async () => undefined),
      },
    })
    return { coordinator }
  }

  it('never serializes selected text, context, or API keys into log arguments', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { chrome } = fakeChromeRuntime()
    const { coordinator } = realCoordinator({
      selectedText: 'SELECTED_TEXT_SENTINEL',
      contextText: 'CONTEXT_TEXT_SENTINEL',
      apiKey: 'API_KEY_SENTINEL',
    })
    await coordinator.initialize()

    const handlers = createUiSessionEventHandlers({ chromeApi: chrome, coordinator })
    await handlers.onSelectionRoute(
      {
        requestId: 'route-safe',
        type: 'selection.route',
        payload: {
          selectedText: 'SELECTED_TEXT_SENTINEL',
          contextText: 'CONTEXT_TEXT_SENTINEL',
        },
      },
      sender()
    )
    await handlers.onContentSelectToolShortcut(
      { requestId: 'select-safe', type: 'shortcut.selectTool', payload: { index: 1 } },
      sender()
    )
    await handlers.onContentSurfaceStatus(
      {
        requestId: 'status-safe',
        type: 'ui.surfaceStatus',
        payload: { status: 'destroyed', selectionSessionId: null },
      },
      sender()
    )

    const serialized = JSON.stringify([...logSpy.mock.calls, ...errorSpy.mock.calls])
    expect(serialized).toContain('route-safe')
    expect(serialized).not.toContain('SELECTED_TEXT_SENTINEL')
    expect(serialized).not.toContain('CONTEXT_TEXT_SENTINEL')
    expect(serialized).not.toContain('API_KEY_SENTINEL')
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('does not leak the rejected payload into failure logs', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { chrome } = fakeChromeRuntime()
    const coordinator = mockCoordinator()
    const handlers = createUiSessionEventHandlers({ chromeApi: chrome, coordinator })
    await expect(
      handlers.onSelectionRoute(
        {
          requestId: 'bad-route',
          type: 'selection.route',
          payload: { selectedText: 'SELECTED_TEXT_SENTINEL', contextText: '' },
        },
        sender()
      )
    ).rejects.toMatchObject({ code: 'INVALID_EVENT' })

    const serialized = JSON.stringify([...logSpy.mock.calls, ...errorSpy.mock.calls])
    expect(serialized).not.toContain('SELECTED_TEXT_SENTINEL')
    expect(serialized).not.toContain('CONTEXT_TEXT_SENTINEL')
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })
})

describe('ui-session-runtime: session state reconciliation', () => {
  function storedState(
    tabId: number,
    windowId: number,
    pageUrl: string,
    selectionSessionId: number | null
  ) {
    return {
      tabId,
      windowId,
      pageUrl,
      contentUIAppeared: true,
      sidePanelAppeared: false,
      latestUI: 'contentScript',
      selectionSessionId,
    }
  }

  it('deletes only the tracked session that lost its retained record', async () => {
    const stored = {
      '9': storedState(9, 19, PAGE_NORMALIZED, 10),
      '99': storedState(99, 19, PAGE_NORMALIZED, 11),
      '7': { ...storedState(7, 19, PAGE_NORMALIZED, 12), contentUIAppeared: 'yes' },
    }
    const save = vi.fn(async () => undefined)
    const deleteSelectionSession = vi.fn(async () => undefined)
    const getTab = vi.fn(async (tabId: number) => {
      if (tabId === 9)
        return { id: 9, windowId: 19, url: 'https://example.com/docs/rust?chapter=1#later' }
      if (tabId === 7) return { id: 7, windowId: 19, url: PAGE }
      throw new Error('no such tab')
    })
    await reconcileUiSessionState({
      sessionStore: { load: async () => stored, save },
      getTab,
      deleteSelectionSession,
    })
    expect(save).toHaveBeenCalledWith({
      '9': expect.objectContaining({ selectionSessionId: 10 }),
    })
    expect(deleteSelectionSession).toHaveBeenCalledWith(11)
    expect(deleteSelectionSession).not.toHaveBeenCalledWith(10)
    expect(deleteSelectionSession).not.toHaveBeenCalledWith(12)
  })

  it('drops a record whose normalized URL changed and deletes its tracked session', async () => {
    const stored = {
      '9': storedState(9, 19, PAGE_NORMALIZED, 10),
    }
    const save = vi.fn(async () => undefined)
    const deleteSelectionSession = vi.fn(async () => undefined)
    const getTab = vi.fn(async () => ({ id: 9, windowId: 19, url: PAGE_2 }))
    await reconcileUiSessionState({
      sessionStore: { load: async () => stored, save },
      getTab,
      deleteSelectionSession,
    })
    expect(save).toHaveBeenCalledWith({})
    expect(deleteSelectionSession).toHaveBeenCalledWith(10)
  })

  it('does not delete any session when no coordinator records are stored', async () => {
    const save = vi.fn(async () => undefined)
    const deleteSelectionSession = vi.fn(async () => undefined)
    await reconcileUiSessionState({
      sessionStore: { load: async () => ({}), save },
      getTab: vi.fn(async () => ({ id: 9, windowId: 19, url: PAGE })),
      deleteSelectionSession,
    })
    expect(save).not.toHaveBeenCalled()
    expect(deleteSelectionSession).not.toHaveBeenCalled()
  })

  it('never deletes a session id from a record whose selection session is null', async () => {
    const stored = {
      '9': storedState(9, 19, PAGE_NORMALIZED, null),
      '99': storedState(99, 19, PAGE_NORMALIZED, null),
    }
    const save = vi.fn(async () => undefined)
    const deleteSelectionSession = vi.fn(async () => undefined)
    const getTab = vi.fn(async (tabId: number) => {
      if (tabId === 9) return { id: 9, windowId: 19, url: PAGE }
      throw new Error('no such tab')
    })
    await reconcileUiSessionState({
      sessionStore: { load: async () => stored, save },
      getTab,
      deleteSelectionSession,
    })
    expect(save).toHaveBeenCalledWith({
      '9': expect.objectContaining({ selectionSessionId: null }),
    })
    expect(deleteSelectionSession).not.toHaveBeenCalled()
  })
})
