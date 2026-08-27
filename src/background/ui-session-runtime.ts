import { DianzhiError } from '@/dianzhi/domain/errors'
import type { ParseResult } from '@/dianzhi/domain/protocol'
import type { ConversationUpdate } from '@/dianzhi/domain/protocol'
import type {
  CycleToolShortcutRequest,
  PanelToggleRequest,
  PanelToggleResult,
  SelectionRouteRequest,
  SelectionRouteResult,
  SelectToolShortcutRequest,
  SidePanelCommand,
  SurfaceStatusRequest,
  SurfaceStatusResponse,
  ToolShortcutResult,
} from '@/dianzhi/domain/ui-session-protocol'
import { log, logError, Scope } from '@/events/logger'
import type { TargetedSidePanelEvent } from '@/events/sidePanel/sidePanel'
import {
  normalizePageUrl,
  type PanelBinding,
  type TabSessionState,
  type UiEventSource,
} from './ui-session-coordinator'
import {
  parsePanelToggle,
  parseSelectionRoute,
  parseSurfaceStatus,
  parseToolShortcut,
} from '@/dianzhi/domain/ui-session-protocol'

/** The packaged Side Panel page; native open/closed events and panel senders are filtered to this path. */
export const SIDE_PANEL_PAGE_PATH = 'src/sidepanel/index.html'

type SidePanelClosedEvent = chrome.events.Event<(info: chrome.sidePanel.PanelClosedInfo) => void>

/**
 * Chrome 142 added `sidePanel.onClosed`; the pinned type defs still only expose
 * `onOpened`. The narrow cast keeps the runtime listener available on 141+.
 */
function sidePanelClosedEvent(chromeApi: typeof chrome): SidePanelClosedEvent {
  return (chromeApi.sidePanel as typeof chrome.sidePanel & { onClosed: SidePanelClosedEvent })
    .onClosed
}

type LogContext = Record<string, string | number | boolean | null>

export interface UiSessionCoordinator {
  initialize(): Promise<void>
  reportContentStatus(
    request: SurfaceStatusRequest,
    sender: chrome.runtime.MessageSender
  ): Promise<SurfaceStatusResponse>
  reportPanelStatus(
    request: SurfaceStatusRequest,
    binding: PanelBinding
  ): Promise<SurfaceStatusResponse>
  routeSelection(
    request: SelectionRouteRequest,
    sender: chrome.runtime.MessageSender
  ): Promise<SelectionRouteResult>
  togglePanel(request: PanelToggleRequest, source: UiEventSource): Promise<PanelToggleResult>
  selectTool(request: SelectToolShortcutRequest, source: UiEventSource): Promise<ToolShortcutResult>
  cycleTool(request: CycleToolShortcutRequest, source: UiEventSource): Promise<ToolShortcutResult>
  publish(tabId: number, update: ConversationUpdate): Promise<void>
  onTabActivated(tabId: number, windowId: number): Promise<void>
  onTabUpdated(tabId: number, windowId: number, url: string): Promise<void>
  onTabRemoved(tabId: number, windowId: number): Promise<void>
  onPanelOpened(windowId: number): Promise<void>
  onPanelClosed(windowId: number): Promise<void>
}

export interface UiSessionEventHandlers {
  onContentSurfaceStatus(
    value: unknown,
    sender: chrome.runtime.MessageSender
  ): Promise<SurfaceStatusResponse>
  onPanelSurfaceStatus(
    value: unknown,
    sender: chrome.runtime.MessageSender
  ): Promise<SurfaceStatusResponse>
  onSelectionRoute(
    value: unknown,
    sender: chrome.runtime.MessageSender
  ): Promise<SelectionRouteResult>
  onContentPanelToggle(
    value: unknown,
    sender: chrome.runtime.MessageSender
  ): Promise<PanelToggleResult>
  onPanelPanelToggle(
    value: unknown,
    sender: chrome.runtime.MessageSender
  ): Promise<PanelToggleResult>
  onContentSelectToolShortcut(
    value: unknown,
    sender: chrome.runtime.MessageSender
  ): Promise<ToolShortcutResult>
  onPanelSelectToolShortcut(
    value: unknown,
    sender: chrome.runtime.MessageSender
  ): Promise<ToolShortcutResult>
  onContentCycleToolShortcut(
    value: unknown,
    sender: chrome.runtime.MessageSender
  ): Promise<ToolShortcutResult>
  onPanelCycleToolShortcut(
    value: unknown,
    sender: chrome.runtime.MessageSender
  ): Promise<ToolShortcutResult>
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function invalid(message: string): DianzhiError {
  return new DianzhiError({ code: 'INVALID_EVENT', message })
}

function extractRequestId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const requestId = (value as { requestId?: unknown }).requestId
  return typeof requestId === 'string' && requestId.trim().length > 0 ? requestId : null
}

function trace(message: string, context: LogContext): void {
  log(Scope.BACKGROUND, `[ui-session-runtime] ${message}`, context)
}

function traceError(message: string, error: unknown, context: LogContext): void {
  logError(Scope.BACKGROUND, `[ui-session-runtime] ${message}`, {
    ...context,
    code: error instanceof DianzhiError ? error.code : 'UNKNOWN',
    reason: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160),
  })
}

function normalizedForLog(url: string | undefined): string | null {
  if (!url) return null
  try {
    return normalizePageUrl(url)
  } catch {
    return null
  }
}

function parseUiRequest<P>(value: unknown, parse: (v: unknown) => ParseResult<P>): P {
  const result = parse(value)
  if (!result.ok) {
    throw new DianzhiError(result.error)
  }
  return result.value
}

/**
 * Re-derives Chrome's trusted sender shape from a validated content event source so
 * coordinator methods that accept a raw sender keep working at the transport boundary.
 */
function contentSenderFromSource(source: UiEventSource): chrome.runtime.MessageSender {
  return {
    tab: {
      id: source.tabId,
      windowId: source.windowId,
      url: source.pageUrl,
    } as unknown as chrome.tabs.Tab,
    url: source.pageUrl,
  }
}

/**
 * Resolves a trusted content-script sender to the UI event source the coordinator
 * expects. The sender tab identity is supplied by Chrome and is never caller-chosen.
 */
export function resolveContentSource(
  sender: chrome.runtime.MessageSender,
  requestId?: string
): UiEventSource {
  const tabId = sender.tab?.id
  const windowId = sender.tab?.windowId
  const pageUrl = sender.url ?? sender.tab?.url
  if (!isPositiveInteger(tabId) || !isPositiveInteger(windowId) || !pageUrl) {
    throw invalid('A trusted content-script sender is required.')
  }
  return { surface: 'contentScript', tabId, windowId, pageUrl, requestId }
}

/**
 * Maps a Side Panel sendMessage sender to its window binding.
 *
 * Panel senders have no `sender.tab`, so the owning window is recovered from the
 * matching `chrome.runtime.getContexts` SIDE_PANEL context (matched by document ID,
 * falling back to the panel document URL) and the window's active tab is looked up
 * with `chrome.tabs.query`. This is deterministic, stays fresh per request, and is
 * correct with multiple windows because each panel context carries its own window ID.
 */
export async function resolvePanelBinding(
  chromeApi: typeof chrome,
  sender: chrome.runtime.MessageSender
): Promise<PanelBinding> {
  const panelUrl = chromeApi.runtime.getURL(SIDE_PANEL_PAGE_PATH)
  if (typeof sender.url !== 'string' || sender.url !== panelUrl) {
    throw invalid('A Side Panel page sender is required.')
  }
  const contexts = await chromeApi.runtime.getContexts({
    contextTypes: [chromeApi.runtime.ContextType.SIDE_PANEL],
    documentUrls: [panelUrl],
  })
  // A present document ID must match an open panel context; the document URL
  // fallback applies only when Chrome omitted the sender's document ID.
  const matchingContext =
    typeof sender.documentId === 'string' && sender.documentId.length > 0
      ? contexts.find((context) => context.documentId === sender.documentId)
      : contexts.find((context) => context.documentUrl === sender.url)
  if (!matchingContext || !isPositiveInteger(matchingContext.windowId)) {
    throw invalid('No open Side Panel context matches the sender.')
  }
  const windowId = matchingContext.windowId
  const activeTabs = await chromeApi.tabs.query({ active: true, windowId })
  const activeTab = activeTabs.find((tab) => isPositiveInteger(tab.id))
  if (!activeTab || !isPositiveInteger(activeTab.id)) {
    throw invalid('The Side Panel window has no active tab.')
  }
  return { tabId: activeTab.id, windowId }
}

/**
 * Builds the coordinator's side-panel event source for a resolved window binding.
 * The panel's active tab URL comes from Chrome's tab metadata, not callers.
 */
export function panelSourceFromBinding(
  chromeApi: typeof chrome,
  binding: PanelBinding,
  requestId?: string
): Promise<UiEventSource> {
  if (!isPositiveInteger(binding.tabId) || !isPositiveInteger(binding.windowId)) {
    return Promise.reject(invalid('A trusted Side Panel binding is required.'))
  }
  return chromeApi.tabs.get(binding.tabId).then((tab) => {
    if (!isPositiveInteger(tab.id) || !isPositiveInteger(tab.windowId) || !tab.url) {
      throw invalid('The Side Panel active tab has no page URL.')
    }
    return {
      surface: 'sidePanel',
      tabId: tab.id,
      windowId: binding.windowId,
      pageUrl: tab.url,
      requestId,
    }
  })
}

async function runContentRequest<P extends { requestId: string }, R>(input: {
  stage: string
  value: unknown
  sender: chrome.runtime.MessageSender
  parse: (value: unknown) => ParseResult<P>
  execute: (request: P, source: UiEventSource) => Promise<R>
  commit?: (request: P, result: R) => LogContext
}): Promise<R> {
  const { stage, value, sender, parse, execute, commit } = input
  trace('ui content request received', {
    requestId: extractRequestId(value) ?? null,
    stage,
    source: 'contentScript',
    tabId: sender.tab?.id ?? null,
    windowId: sender.tab?.windowId ?? null,
    pageUrl: normalizedForLog(sender.url ?? sender.tab?.url),
    outcome: 'received',
  })
  let requestId: string | null = extractRequestId(value)
  let request: P
  let source: UiEventSource
  try {
    request = parseUiRequest<P>(value, parse)
    requestId = request.requestId
    source = resolveContentSource(sender, request.requestId)
    trace('ui content request validated', {
      requestId: request.requestId,
      stage,
      source: 'contentScript',
      tabId: source.tabId,
      windowId: source.windowId,
      pageUrl: source.pageUrl,
      outcome: 'validated',
    })
  } catch (error) {
    traceError(`ui content request failed (${stage})`, error, {
      requestId: requestId ?? null,
      stage,
      source: 'contentScript',
      tabId: sender.tab?.id ?? null,
      windowId: sender.tab?.windowId ?? null,
      pageUrl: normalizedForLog(sender.url ?? sender.tab?.url),
      outcome: 'failed',
    })
    throw error
  }
  try {
    const result = await execute(request, source)
    trace('ui content request committed', {
      requestId: request.requestId,
      stage,
      source: 'contentScript',
      tabId: source.tabId,
      windowId: source.windowId,
      pageUrl: source.pageUrl,
      outcome: 'committed',
      ...(commit?.(request, result) ?? {}),
    })
    return result
  } catch (error) {
    traceError(`ui content request failed (${stage})`, error, {
      requestId: request.requestId,
      stage,
      source: 'contentScript',
      tabId: source.tabId,
      windowId: source.windowId,
      pageUrl: source.pageUrl,
      outcome: 'failed',
    })
    throw error
  }
}

async function runPanelRequest<P extends { requestId: string }, R>(input: {
  chromeApi: typeof chrome
  stage: string
  value: unknown
  sender: chrome.runtime.MessageSender
  parse: (value: unknown) => ParseResult<P>
  execute: (request: P, source: UiEventSource) => Promise<R>
  commit?: (request: P, result: R) => LogContext
}): Promise<R> {
  const { chromeApi, stage, value, sender, parse, execute, commit } = input
  trace('ui panel request received', {
    requestId: extractRequestId(value) ?? null,
    stage,
    source: 'sidePanel',
    outcome: 'received',
  })
  let requestId: string | null = extractRequestId(value)
  let request: P
  let source: UiEventSource
  try {
    request = parseUiRequest<P>(value, parse)
    requestId = request.requestId
    const binding = await resolvePanelBinding(chromeApi, sender)
    source = await panelSourceFromBinding(chromeApi, binding, request.requestId)
    trace('ui panel request validated', {
      requestId: request.requestId,
      stage,
      source: 'sidePanel',
      tabId: source.tabId,
      windowId: source.windowId,
      pageUrl: source.pageUrl,
      outcome: 'validated',
    })
  } catch (error) {
    traceError(`ui panel request failed (${stage})`, error, {
      requestId: requestId ?? null,
      stage,
      source: 'sidePanel',
      outcome: 'failed',
    })
    throw error
  }
  try {
    const result = await execute(request, source)
    trace('ui panel request committed', {
      requestId: request.requestId,
      stage,
      source: 'sidePanel',
      tabId: source.tabId,
      windowId: source.windowId,
      pageUrl: source.pageUrl,
      outcome: 'committed',
      ...(commit?.(request, result) ?? {}),
    })
    return result
  } catch (error) {
    traceError(`ui panel request failed (${stage})`, error, {
      requestId: request.requestId,
      stage,
      source: 'sidePanel',
      tabId: source.tabId,
      windowId: source.windowId,
      pageUrl: source.pageUrl,
      outcome: 'failed',
    })
    throw error
  }
}

/**
 * Creates request handlers for the typed ui-session transport. Every untrusted
 * request is parsed before the coordinator is called, and lifecycle logs carry
 * only request IDs and browser identity, never selection or provider content.
 */
export function createUiSessionEventHandlers(deps: {
  chromeApi: typeof chrome
  coordinator: UiSessionCoordinator
}): UiSessionEventHandlers {
  const { chromeApi, coordinator } = deps

  function snapshotIds(result: {
    snapshot?: { selectionSession?: { id?: number }; conversation?: { id?: number } } | null
  }): LogContext {
    return {
      selectionSessionId: result.snapshot?.selectionSession?.id ?? null,
      conversationId: result.snapshot?.conversation?.id ?? null,
    }
  }

  return {
    onContentSurfaceStatus(value, sender) {
      return runContentRequest({
        stage: 'ui.surfaceStatus',
        value,
        sender,
        parse: parseSurfaceStatus,
        execute: (request, source) =>
          coordinator.reportContentStatus(request, contentSenderFromSource(source)),
        commit: (_request, result) => ({
          currentUI: result.currentUI,
          selectionSessionId: result.selectionSessionId,
        }),
      })
    },
    onPanelSurfaceStatus(value, sender) {
      return runPanelRequest({
        chromeApi,
        stage: 'ui.surfaceStatus',
        value,
        sender,
        parse: parseSurfaceStatus,
        execute: (request, source) =>
          coordinator.reportPanelStatus(request, {
            tabId: source.tabId,
            windowId: source.windowId,
          }),
        commit: (_request, result) => ({
          currentUI: result.currentUI,
          selectionSessionId: result.selectionSessionId,
        }),
      })
    },
    onSelectionRoute(value, sender) {
      return runContentRequest({
        stage: 'selection.route',
        value,
        sender,
        parse: parseSelectionRoute,
        execute: (request, source) =>
          coordinator.routeSelection(request, contentSenderFromSource(source)),
        commit: (_request, result) => ({
          target: result.target,
          ...snapshotIds(result),
        }),
      })
    },
    onContentPanelToggle(value, sender) {
      return runContentRequest({
        stage: 'shortcut.panelToggle',
        value,
        sender,
        parse: parsePanelToggle,
        execute: (request, source) => coordinator.togglePanel(request, source),
        commit: (_request, result) => ({
          currentUI: result.currentUI,
          action: result.action,
          ...snapshotIds(result),
        }),
      })
    },
    onPanelPanelToggle(value, sender) {
      return runPanelRequest({
        chromeApi,
        stage: 'shortcut.panelToggle',
        value,
        sender,
        parse: parsePanelToggle,
        execute: (request, source) => coordinator.togglePanel(request, source),
        commit: (_request, result) => ({
          currentUI: result.currentUI,
          action: result.action,
          ...snapshotIds(result),
        }),
      })
    },
    onContentSelectToolShortcut(value, sender) {
      return runContentRequest({
        stage: 'shortcut.selectTool',
        value,
        sender,
        parse: parseToolShortcut,
        execute: (request, source) => {
          if (request.type !== 'shortcut.selectTool') {
            throw invalid('The tool shortcut type does not match its event channel.')
          }
          return coordinator.selectTool(request, source)
        },
        commit: (_request, result) => toolResultContext(result),
      })
    },
    onPanelSelectToolShortcut(value, sender) {
      return runPanelRequest({
        chromeApi,
        stage: 'shortcut.selectTool',
        value,
        sender,
        parse: parseToolShortcut,
        execute: (request, source) => {
          if (request.type !== 'shortcut.selectTool') {
            throw invalid('The tool shortcut type does not match its event channel.')
          }
          return coordinator.selectTool(request, source)
        },
        commit: (_request, result) => toolResultContext(result),
      })
    },
    onContentCycleToolShortcut(value, sender) {
      return runContentRequest({
        stage: 'shortcut.cycleTool',
        value,
        sender,
        parse: parseToolShortcut,
        execute: (request, source) => {
          if (request.type !== 'shortcut.cycleTool') {
            throw invalid('The tool shortcut type does not match its event channel.')
          }
          return coordinator.cycleTool(request, source)
        },
        commit: (_request, result) => toolResultContext(result),
      })
    },
    onPanelCycleToolShortcut(value, sender) {
      return runPanelRequest({
        chromeApi,
        stage: 'shortcut.cycleTool',
        value,
        sender,
        parse: parseToolShortcut,
        execute: (request, source) => {
          if (request.type !== 'shortcut.cycleTool') {
            throw invalid('The tool shortcut type does not match its event channel.')
          }
          return coordinator.cycleTool(request, source)
        },
        commit: (_request, result) => toolResultContext(result),
      })
    },
  }

  function toolResultContext(result: ToolShortcutResult): LogContext {
    if (!result.handled) {
      return { handled: false, reason: result.reason }
    }
    return { handled: true, target: result.target, ...snapshotIds(result) }
  }
}

/**
 * Wires Chrome native tab and Side Panel lifecycle events into the coordinator and
 * accepts Side Panel ports for the background-to-side-panel events. Returns a
 * cleanup function that removes every registered listener.
 */
export function registerUiSessionRuntime(input: {
  chromeApi: typeof chrome
  coordinator: UiSessionCoordinator
  sidePanelCommand: TargetedSidePanelEvent<SidePanelCommand, true>
  sidePanelConversationUpdate: TargetedSidePanelEvent<ConversationUpdate, true>
}): () => void {
  const { chromeApi, coordinator, sidePanelCommand, sidePanelConversationUpdate } = input
  const disposers: Array<() => void> = []

  const onTabActivated = (activeInfo: chrome.tabs.OnActivatedInfo): void => {
    trace('tab activated', {
      stage: 'tabs.onActivated',
      tabId: activeInfo.tabId,
      windowId: activeInfo.windowId,
      outcome: 'received',
    })
    void coordinator
      .onTabActivated(activeInfo.tabId, activeInfo.windowId)
      .catch((error: unknown) => {
        traceError('tab activation handling failed', error, {
          stage: 'tabs.onActivated',
          tabId: activeInfo.tabId,
          windowId: activeInfo.windowId,
          outcome: 'failed',
        })
      })
  }
  chromeApi.tabs.onActivated.addListener(onTabActivated)
  disposers.push(() => chromeApi.tabs.onActivated.removeListener(onTabActivated))

  const onTabUpdated = (
    tabId: number,
    changeInfo: chrome.tabs.OnUpdatedInfo,
    tab: chrome.tabs.Tab
  ): void => {
    // Only committed top-level navigations surface status 'loading' together with
    // the next URL; subframe and pending updates are ignored as lifecycle evidence.
    if (changeInfo.status !== 'loading' || typeof changeInfo.url !== 'string') return
    if (!isPositiveInteger(tab.windowId)) return
    trace('tab navigation committed', {
      stage: 'tabs.onUpdated',
      tabId,
      windowId: tab.windowId,
      pageUrl: normalizedForLog(changeInfo.url),
      outcome: 'received',
    })
    void coordinator.onTabUpdated(tabId, tab.windowId, changeInfo.url).catch((error: unknown) => {
      traceError('tab update handling failed', error, {
        stage: 'tabs.onUpdated',
        tabId,
        windowId: tab.windowId,
        outcome: 'failed',
      })
    })
  }
  chromeApi.tabs.onUpdated.addListener(onTabUpdated)
  disposers.push(() => chromeApi.tabs.onUpdated.removeListener(onTabUpdated))

  const onTabRemoved = (tabId: number, removeInfo: chrome.tabs.OnRemovedInfo): void => {
    trace('tab removed', {
      stage: 'tabs.onRemoved',
      tabId,
      windowId: removeInfo.windowId,
      outcome: 'received',
    })
    void coordinator.onTabRemoved(tabId, removeInfo.windowId).catch((error: unknown) => {
      traceError('tab removal handling failed', error, {
        stage: 'tabs.onRemoved',
        tabId,
        windowId: removeInfo.windowId,
        outcome: 'failed',
      })
    })
  }
  chromeApi.tabs.onRemoved.addListener(onTabRemoved)
  disposers.push(() => chromeApi.tabs.onRemoved.removeListener(onTabRemoved))

  const onSidePanelOpened = (info: chrome.sidePanel.PanelOpenedInfo): void => {
    if (info.path !== undefined && info.path !== SIDE_PANEL_PAGE_PATH) return
    trace('side panel opened', {
      stage: 'sidePanel.onOpened',
      tabId: info.tabId ?? null,
      windowId: info.windowId,
      outcome: 'received',
    })
    void coordinator.onPanelOpened(info.windowId).catch((error: unknown) => {
      traceError('side panel open handling failed', error, {
        stage: 'sidePanel.onOpened',
        windowId: info.windowId,
        outcome: 'failed',
      })
    })
  }
  chromeApi.sidePanel.onOpened.addListener(onSidePanelOpened)
  disposers.push(() => chromeApi.sidePanel.onOpened.removeListener(onSidePanelOpened))

  const onSidePanelClosed = (info: chrome.sidePanel.PanelClosedInfo): void => {
    if (info.path !== undefined && info.path !== SIDE_PANEL_PAGE_PATH) return
    trace('side panel closed', {
      stage: 'sidePanel.onClosed',
      tabId: info.tabId ?? null,
      windowId: info.windowId,
      outcome: 'received',
    })
    void coordinator.onPanelClosed(info.windowId).catch((error: unknown) => {
      traceError('side panel close handling failed', error, {
        stage: 'sidePanel.onClosed',
        windowId: info.windowId,
        outcome: 'failed',
      })
    })
  }
  const panelClosedEvent = sidePanelClosedEvent(chromeApi)
  panelClosedEvent.addListener(onSidePanelClosed)
  disposers.push(() => panelClosedEvent.removeListener(onSidePanelClosed))

  const onConnect = (port: chrome.runtime.Port): void => {
    const commandAccepted = sidePanelCommand.accept(port)
    const updateAccepted = sidePanelConversationUpdate.accept(port)
    if (commandAccepted || updateAccepted) {
      trace('side panel port connected', {
        stage: 'runtime.onConnect',
        outcome: 'received',
      })
    }
  }
  chromeApi.runtime.onConnect.addListener(onConnect)
  disposers.push(() => chromeApi.runtime.onConnect.removeListener(onConnect))

  return () => {
    for (const dispose of disposers) dispose()
  }
}

function isValidStoredState(value: unknown): value is TabSessionState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const state = value as Partial<TabSessionState>
  return (
    isPositiveInteger(state.tabId) &&
    isPositiveInteger(state.windowId) &&
    typeof state.pageUrl === 'string' &&
    state.pageUrl.length > 0 &&
    typeof state.contentUIAppeared === 'boolean' &&
    typeof state.sidePanelAppeared === 'boolean' &&
    (state.latestUI === 'contentScript' || state.latestUI === 'sidePanel') &&
    (state.selectionSessionId === null || isPositiveInteger(state.selectionSessionId))
  )
}

/**
 * Reconciles persisted UI tab sessions against the live browser tab set: records
 * whose tab/window/URL no longer match exactly are dropped, the retained records
 * are written back, and the dropped selection sessions are deleted as orphans.
 */
export async function reconcileUiSessionState(input: {
  sessionStore: {
    load(): Promise<Record<string, unknown>>
    save(state: Record<string, TabSessionState>): Promise<void>
  }
  getTab(tabId: number): Promise<{ id: number; windowId: number; url?: string }>
  deleteOrphanSelectionSessions(retainedIds: number[]): Promise<void>
}): Promise<void> {
  const stored = await input.sessionStore.load()
  const entries = Object.entries(stored)
  if (entries.length === 0) return
  const retained: Record<string, TabSessionState> = {}
  const retainedSessionIds: number[] = []
  for (const [key, raw] of entries) {
    if (!isValidStoredState(raw)) continue
    if (String(raw.tabId) !== key) continue
    let current: { id: number; windowId: number; url?: string }
    try {
      current = await input.getTab(raw.tabId)
    } catch {
      continue
    }
    if (!isPositiveInteger(current.id) || !isPositiveInteger(current.windowId) || !current.url) {
      continue
    }
    if (current.windowId !== raw.windowId) continue
    let storedNormalized: string
    let currentNormalized: string
    try {
      storedNormalized = normalizePageUrl(raw.pageUrl)
      currentNormalized = normalizePageUrl(current.url)
    } catch {
      continue
    }
    if (currentNormalized !== storedNormalized) continue
    retained[key] = raw
    if (raw.selectionSessionId !== null) retainedSessionIds.push(raw.selectionSessionId)
  }
  await input.sessionStore.save(retained)
  trace('reconciled retained UI tab sessions', {
    stage: 'reconcile',
    tabId: 0,
    windowId: 0,
    retainedTabs: Object.keys(retained).length,
    retainedSessionIds: retainedSessionIds.length,
    droppedRecords: entries.length - Object.keys(retained).length,
    outcome: 'committed',
  })
  await input.deleteOrphanSelectionSessions(retainedSessionIds)
}
