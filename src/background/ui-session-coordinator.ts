import { DianzhiError } from '@/dianzhi/domain/errors'
import type { ConversationSnapshot, ConversationUpdate } from '@/dianzhi/domain/protocol'
import type {
  CycleToolShortcutRequest,
  ContentRestore,
  PanelToggleRequest,
  PanelToggleResult,
  SelectToolShortcutRequest,
  SelectionRouteRequest,
  SelectionRouteResult,
  SidePanelCommand,
  SurfaceStatusRequest,
  SurfaceStatusResponse,
  ToolShortcutResult,
  UiSurface,
} from '@/dianzhi/domain/ui-session-protocol'
import { isSelectionBookmark } from '@/content/selection/restore'
import type { AnchorRect } from '@/content/popover/placement'
import type { DianzhiSettings } from '@/dianzhi/domain/types'
import { log, logError, Scope } from '@/events/logger'
import type { UiConversationGateway } from './conversation-manager'
import type { ReadyPanelSession, SidePanelChannel } from './side-panel-session-registry'

export interface TabSessionState {
  tabId: number
  windowId: number
  pageUrl: string
  contentUIAppeared: boolean
  sidePanelAppeared: boolean
  latestUI: UiSurface
  selectionSessionId: number | null
  contentRestore?: ContentRestore
}

export interface UiEventSource {
  surface: UiSurface
  tabId: number
  windowId: number
  pageUrl: string
  requestId?: string
}

export interface PanelBinding {
  tabId: number
  windowId: number
}

export interface UiSessionCoordinatorDependencies {
  conversations: UiConversationGateway
  loadSettings(): Promise<DianzhiSettings>
  sessionStore: {
    load(): Promise<Record<string, TabSessionState>>
    save(state: Record<string, TabSessionState>): Promise<void>
  }
  tabs: {
    get(tabId: number): Promise<{ id: number; windowId: number; url?: string }>
    query(windowId: number): Promise<Array<{ id: number; windowId: number; url?: string }>>
  }
  content: {
    destroy(tabId: number): Promise<void>
    publish(tabId: number, update: ConversationUpdate): Promise<void>
  }
  sidePanel: {
    open(tabId: number): Promise<void>
    close(windowId: number): Promise<void>
    command(windowId: number, command: SidePanelCommand): Promise<true>
    publish(windowId: number, update: ConversationUpdate): Promise<void>
    /** Resolves once the Side Panel typed-event port binds for the window. */
    ready(windowId: number, timeoutMs?: number): Promise<void>
  }
}

type StoredStates = Record<string, TabSessionState>

type DeliveryRoute =
  | { to: 'contentScript' }
  | { to: 'sidePanel'; windowId: number; panelSessionId?: string }
  | { to: 'sidePanelRecovering'; windowId: number; panelSessionId: string }

export function normalizePageUrl(input: string): string {
  const url = new URL(input)
  return `${url.origin}${url.pathname}${url.search}`
}

function invalid(message: string): DianzhiError {
  return new DianzhiError({ code: 'INVALID_EVENT', message })
}

function stale(tabId: number): DianzhiError {
  return new DianzhiError({
    code: 'UI_SESSION_STALE',
    message: 'The tab session changed before the UI operation completed.',
    context: { tabId },
  })
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isValidStoredState(value: TabSessionState): boolean {
  return (
    isPositiveInteger(value.tabId) &&
    isPositiveInteger(value.windowId) &&
    typeof value.pageUrl === 'string' &&
    value.pageUrl.length > 0 &&
    typeof value.contentUIAppeared === 'boolean' &&
    typeof value.sidePanelAppeared === 'boolean' &&
    (value.latestUI === 'contentScript' || value.latestUI === 'sidePanel') &&
    (value.selectionSessionId === null || isPositiveInteger(value.selectionSessionId)) &&
    (value.contentRestore === undefined || isValidContentRestore(value.contentRestore, value))
  )
}

function isValidContentRestore(value: ContentRestore, state: TabSessionState): boolean {
  return (
    isPositiveInteger(value.selectionSessionId) &&
    value.selectionSessionId === state.selectionSessionId &&
    isSelectionBookmark(value.bookmark) &&
    ['left', 'right', 'top', 'bottom'].every((key) => {
      const number = value.anchorRect[key as keyof AnchorRect]
      return typeof number === 'number' && Number.isFinite(number)
    })
  )
}

function cloneState(state: TabSessionState): TabSessionState {
  return { ...state }
}

function cloneSnapshot(snapshot: ConversationSnapshot): ConversationSnapshot {
  return {
    selectionSession: { ...snapshot.selectionSession },
    conversation: { ...snapshot.conversation },
    messages: snapshot.messages.map((message) => ({ ...message })),
    tools: snapshot.tools.map(({ tool, conversationId }) => ({
      tool: { ...tool },
      conversationId,
    })),
    activeToolId: snapshot.activeToolId,
  }
}

export function createUiSessionCoordinator(dependencies: UiSessionCoordinatorDependencies) {
  const tabStates = new Map<number, TabSessionState>()
  const panelWindows = new Set<number>()
  const queues = new Map<number, Promise<unknown>>()
  const closedTabs = new Set<number>()
  // Tabs whose panel open was already started inside the user-gesture window
  // (synchronously at the message boundary). The handoff must not call
  // `sidePanel.open()` again for these, since the second call is no longer
  // gesture-bound and Chrome rejects it.
  const gestureOpenedTabs = new Set<number>()
  let saveChain = Promise.resolve()
  // Externally-observable page identity compared against request sources; it can
  // diverge from state.pageUrl, which only advances inside serialized operations.
  const currentPages = new Map<number, string>()
  // The panel owns only each window's current active tab; this gates panelOwnsTab.
  const panelActiveTab = new Map<number, number>()
  const panelSessions = new Map<number, ReadyPanelSession>()
  // Streaming delivery is independent from persisted UI ownership while a
  // surface handoff is in progress. This route changes only after the panel's
  // ordered conversation port has accepted the authoritative sync.
  const deliveryRoutes = new Map<number, DeliveryRoute>()
  const handoffEpochs = new Map<number, number>()

  function stateRecord(): StoredStates {
    return Object.fromEntries(
      [...tabStates].map(([tabId, state]) => [String(tabId), cloneState(state)])
    )
  }

  async function persist(): Promise<void> {
    const serialized = stateRecord()
    saveChain = saveChain.then(() => dependencies.sessionStore.save(serialized))
    await saveChain
  }

  function trace(message: string, context: Record<string, string | number | boolean | null>): void {
    log(Scope.BACKGROUND, `[ui-session] ${message}`, context)
  }

  function traceError(
    message: string,
    error: unknown,
    context: Record<string, string | number | boolean | null>
  ): void {
    logError(Scope.BACKGROUND, `[ui-session] ${message}`, {
      ...context,
      code: error instanceof DianzhiError ? error.code : 'UNKNOWN',
      reason: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160),
    })
  }

  function checkOpen(tabId: number): void {
    if (closedTabs.has(tabId)) throw stale(tabId)
  }

  function assertPage(tabId: number, expectedUrl: string): void {
    checkOpen(tabId)
    const current = currentPages.get(tabId)
    if (current !== undefined && current !== expectedUrl) throw stale(tabId)
  }

  function assertSourceFresh(source: UiEventSource): void {
    assertPage(source.tabId, normalizePageUrl(source.pageUrl))
  }

  function deliveryFailed(state: TabSessionState, error: unknown): DianzhiError {
    if (error instanceof DianzhiError && error.code === 'UI_SESSION_STALE') return error
    const reason = error instanceof Error ? error.message : String(error)
    return new DianzhiError({
      code: 'SIDE_PANEL_DELIVERY_FAILED',
      message: `The conversation could not be handed to the Side Panel: ${reason}`,
      context: { tabId: state.tabId, windowId: state.windowId },
    })
  }

  function nextHandoffEpoch(tabId: number): number {
    const epoch = (handoffEpochs.get(tabId) ?? 0) + 1
    handoffEpochs.set(tabId, epoch)
    return epoch
  }

  function invalidateHandoff(tabId: number): void {
    nextHandoffEpoch(tabId)
  }

  function assertHandoffCurrent(state: TabSessionState, expectedUrl: string, epoch: number): void {
    assertPage(state.tabId, expectedUrl)
    const route = deliveryRoutes.get(state.tabId)
    if (
      handoffEpochs.get(state.tabId) !== epoch ||
      route?.to !== 'sidePanel' ||
      route.windowId !== state.windowId
    ) {
      throw deliveryFailed(state, new Error('The Side Panel closed before synchronization.'))
    }
  }

  async function commitPage(source: UiEventSource): Promise<void> {
    assertSourceFresh(source)
    await persist()
  }

  function runForTab<T>(tabId: number, operation: () => Promise<T>): Promise<T> {
    const previous = queues.get(tabId) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        checkOpen(tabId)
        return operation()
      })
    queues.set(tabId, next)
    void next
      .finally(() => {
        if (queues.get(tabId) === next) queues.delete(tabId)
      })
      .catch(() => undefined)
    return next
  }

  function freshState(tabId: number, windowId: number, pageUrl: string): TabSessionState {
    return {
      tabId,
      windowId,
      pageUrl,
      contentUIAppeared: false,
      sidePanelAppeared: false,
      latestUI: 'contentScript',
      selectionSessionId: null,
    }
  }

  async function resetForNavigation(state: TabSessionState, pageUrl: string): Promise<void> {
    if (state.pageUrl === pageUrl) return
    const oldSessionId = state.selectionSessionId
    if (oldSessionId !== null) {
      trace('navigation replacing selection session', {
        stage: 'navigate',
        tabId: state.tabId,
        windowId: state.windowId,
        pageUrl,
        selectionSessionId: oldSessionId,
        outcome: 'delete-old-session',
      })
      await dependencies.conversations.stopSelectionSession(oldSessionId)
      await dependencies.conversations.deleteSelectionSession(oldSessionId)
    }
    state.pageUrl = pageUrl
    state.selectionSessionId = null
    delete state.contentRestore
    state.contentUIAppeared = false
    state.sidePanelAppeared = panelWindows.has(state.windowId)
    state.latestUI = 'contentScript'
  }

  async function getOrCreateState(source: UiEventSource): Promise<TabSessionState> {
    const pageUrl = normalizePageUrl(source.pageUrl)
    checkOpen(source.tabId)
    const cachedPage = currentPages.get(source.tabId)
    if (cachedPage !== undefined && cachedPage !== pageUrl) {
      const epoch = handoffEpochs.get(source.tabId)
      let tab: Awaited<ReturnType<UiSessionCoordinatorDependencies['tabs']['get']>>
      try {
        tab = await dependencies.tabs.get(source.tabId)
      } catch {
        await onTabRemoved(source.tabId, source.windowId)
        throw stale(source.tabId)
      }
      checkOpen(source.tabId)
      if (
        currentPages.get(source.tabId) !== cachedPage ||
        handoffEpochs.get(source.tabId) !== epoch ||
        tab.id !== source.tabId ||
        tab.windowId !== source.windowId ||
        !tab.url ||
        normalizePageUrl(tab.url) !== pageUrl
      ) {
        throw stale(source.tabId)
      }
      currentPages.set(source.tabId, pageUrl)
      invalidateHandoff(source.tabId)
      deliveryRoutes.delete(source.tabId)
    }
    assertSourceFresh(source)
    const existing = tabStates.get(source.tabId)
    const state = existing ?? freshState(source.tabId, source.windowId, pageUrl)
    state.windowId = source.windowId
    await resetForNavigation(state, pageUrl)
    assertSourceFresh(source)
    tabStates.set(source.tabId, state)
    currentPages.set(source.tabId, pageUrl)
    return state
  }

  function resolveContentSource(
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

  async function sourceFromPanel(
    binding: PanelBinding,
    requestId?: string
  ): Promise<UiEventSource> {
    if (!isPositiveInteger(binding.tabId) || !isPositiveInteger(binding.windowId)) {
      throw invalid('A trusted Side Panel binding is required.')
    }
    const tab = await dependencies.tabs.get(binding.tabId)
    if (!tab.url) throw invalid('The Side Panel active tab has no page URL.')
    return {
      surface: 'sidePanel',
      tabId: tab.id,
      windowId: binding.windowId,
      pageUrl: tab.url,
      requestId,
    }
  }

  function windowHasPanel(windowId: number): boolean {
    return (
      panelWindows.has(windowId) ||
      [...tabStates.values()].some(
        (state) => state.windowId === windowId && state.sidePanelAppeared
      )
    )
  }

  function panelOwnsTab(state: TabSessionState): boolean {
    return windowHasPanel(state.windowId) && panelActiveTab.get(state.windowId) === state.tabId
  }

  async function loadSnapshot(state: TabSessionState): Promise<ConversationSnapshot | null> {
    if (state.selectionSessionId === null) return null
    return dependencies.conversations.loadSelectionSession(state.selectionSessionId)
  }

  async function deliverContent(
    state: TabSessionState,
    snapshot: ConversationSnapshot | null,
    requestId: string | undefined,
    stage: string,
    expectedUrl: string
  ): Promise<void> {
    if (!snapshot) return
    assertPage(state.tabId, expectedUrl)
    trace('delivering content update', {
      requestId: requestId ?? null,
      stage,
      tabId: state.tabId,
      windowId: state.windowId,
      pageUrl: state.pageUrl,
      target: 'contentScript',
      selectionSessionId: snapshot.selectionSession.id,
      conversationId: snapshot.conversation.id,
      outcome: 'start',
    })
    await dependencies.content.publish(state.tabId, { type: 'conversation.sync', snapshot })
  }

  async function destroyContentInWindow(windowId: number, requiredTabId: number): Promise<void> {
    const tabs = await dependencies.tabs.query(windowId)
    const orderedTabs = [...tabs].sort((left, right) => {
      if (left.id === requiredTabId) return -1
      if (right.id === requiredTabId) return 1
      return 0
    })
    for (const tab of orderedTabs) {
      if (!isPositiveInteger(tab.id)) continue
      const state = tabStates.get(tab.id)
      if (!state?.contentUIAppeared || state.windowId !== windowId) continue
      try {
        await dependencies.content.destroy(tab.id)
      } catch (error) {
        traceError('content destroy failed while opening panel', error, {
          stage: 'open-panel',
          tabId: tab.id,
          windowId,
          pageUrl: state.pageUrl,
          target: 'contentScript',
          selectionSessionId: state.selectionSessionId,
          outcome: 'delivery-failed',
        })
        if (tab.id === requiredTabId) throw error
        continue
      }
      state.contentUIAppeared = false
    }
  }

  async function deliverPanel(
    state: TabSessionState,
    command: SidePanelCommand,
    input: { requestId?: string; stage: string; expectedUrl: string }
  ): Promise<void> {
    assertPage(state.tabId, input.expectedUrl)
    const snapshot = 'snapshot' in command ? command.snapshot : null
    trace('delivering side panel command', {
      requestId: input.requestId ?? null,
      stage: input.stage,
      tabId: state.tabId,
      windowId: state.windowId,
      pageUrl: state.pageUrl,
      target: 'sidePanel',
      selectionSessionId: snapshot?.selectionSession.id ?? state.selectionSessionId,
      conversationId: snapshot?.conversation.id ?? null,
      outcome: 'start',
    })
    await dependencies.sidePanel.command(state.windowId, command)
  }

  async function markPanelOwner(
    state: TabSessionState,
    snapshot: ConversationSnapshot | null,
    expectedUrl: string
  ): Promise<void> {
    assertPage(state.tabId, expectedUrl)
    panelWindows.add(state.windowId)
    panelActiveTab.set(state.windowId, state.tabId)
    state.sidePanelAppeared = true
    state.contentUIAppeared = false
    state.latestUI = 'sidePanel'
    state.selectionSessionId = snapshot?.selectionSession.id ?? state.selectionSessionId
    delete state.contentRestore
    deliveryRoutes.set(state.tabId, {
      to: 'sidePanel',
      windowId: state.windowId,
      panelSessionId: panelSessions.get(state.windowId)?.panelSessionId,
    })
    await persist()
  }

  async function markContentOwner(
    state: TabSessionState,
    snapshot: ConversationSnapshot | null,
    expectedUrl: string,
    contentRestore?: ContentRestore
  ): Promise<void> {
    assertPage(state.tabId, expectedUrl)
    state.contentUIAppeared = true
    state.sidePanelAppeared = false
    state.latestUI = 'contentScript'
    state.selectionSessionId = snapshot?.selectionSession.id ?? state.selectionSessionId
    delete state.contentRestore
    if (contentRestore && contentRestore.selectionSessionId === state.selectionSessionId) {
      state.contentRestore = contentRestore
    }
    deliveryRoutes.set(state.tabId, { to: 'contentScript' })
    await persist()
  }

  async function restoreContentAfterFailedHandoff(
    state: TabSessionState,
    expectedUrl: string,
    requestId: string | undefined,
    stage: string
  ): Promise<void> {
    if (tabStates.get(state.tabId) !== state || !state.contentUIAppeared) {
      deliveryRoutes.delete(state.tabId)
      return
    }
    deliveryRoutes.set(state.tabId, { to: 'contentScript' })
    state.sidePanelAppeared = false
    state.latestUI = 'contentScript'
    panelWindows.delete(state.windowId)
    panelActiveTab.delete(state.windowId)
    const snapshot = await loadSnapshot(state)
    await deliverContent(state, snapshot, requestId, `${stage}.recover`, expectedUrl)
    await persist()
  }

  async function openPanelWithSnapshot(
    state: TabSessionState,
    requestId: string | undefined,
    stage: string,
    expectedUrl: string
  ): Promise<ConversationSnapshot | null> {
    // 1. Prepare a uniquely identifiable handoff while the user gesture is valid.
    const epoch = nextHandoffEpoch(state.tabId)
    try {
      if (!gestureOpenedTabs.delete(state.tabId)) await dependencies.sidePanel.open(state.tabId)
      assertPage(state.tabId, expectedUrl)
      await dependencies.sidePanel.ready(state.windowId)
      assertPage(state.tabId, expectedUrl)

      // 2.1 Load after readiness so the sync includes every delta received while
      // the new panel page was starting.
      const snapshot = await loadSnapshot(state)
      assertPage(state.tabId, expectedUrl)
      const synchronized = snapshot
        ? dependencies.sidePanel.publish(state.windowId, {
            type: 'conversation.sync',
            snapshot,
          })
        : dependencies.sidePanel.command(state.windowId, { type: 'clear' }).then(() => undefined)

      // 2.2 `publish` posts synchronously. Later stream events therefore join the
      // same FIFO port behind the sync while its render acknowledgement is pending.
      deliveryRoutes.set(state.tabId, { to: 'sidePanel', windowId: state.windowId })
      await synchronized
      assertHandoffCurrent(state, expectedUrl, epoch)

      // 2.3 Remove Content only after the panel committed the synchronized state.
      await destroyContentInWindow(state.windowId, state.tabId)
      assertHandoffCurrent(state, expectedUrl, epoch)
      await markPanelOwner(state, snapshot, expectedUrl)

      // 3. Return the authoritative snapshot used for the successful handoff.
      return snapshot
    } catch (error) {
      invalidateHandoff(state.tabId)
      await dependencies.sidePanel.close(state.windowId).catch(() => undefined)
      await restoreContentAfterFailedHandoff(state, expectedUrl, requestId, stage).catch(
        (recoveryError) =>
          traceError('content recovery failed after panel handoff', recoveryError, {
            requestId: requestId ?? null,
            stage,
            tabId: state.tabId,
            windowId: state.windowId,
            pageUrl: state.pageUrl,
            outcome: 'recovery-failed',
          })
      )
      throw deliveryFailed(state, error)
    }
  }

  async function commandAppearedPanel(
    state: TabSessionState,
    snapshot: ConversationSnapshot,
    expectedUrl: string
  ): Promise<void> {
    assertPage(state.tabId, expectedUrl)
    await dependencies.sidePanel.publish(state.windowId, {
      type: 'conversation.sync',
      snapshot,
    })
    await markPanelOwner(state, snapshot, expectedUrl)
  }

  async function chooseToolSnapshot(
    state: TabSessionState,
    request: SelectToolShortcutRequest | CycleToolShortcutRequest
  ): Promise<ConversationSnapshot | null> {
    if (state.selectionSessionId === null) return null
    if (request.type === 'shortcut.selectTool') {
      const settings = await dependencies.loadSettings()
      const tool = settings.tools.filter((item) => item.enabled)[request.payload.index - 1]
      if (!tool) return null
      return dependencies.conversations.activateTool(state.selectionSessionId, tool.id)
    }

    const current = await dependencies.conversations.loadSelectionSession(state.selectionSessionId)
    const tools = current.tools.filter(({ tool }) => tool.enabled)
    if (tools.length === 0) return null
    const currentIndex = tools.findIndex(({ tool }) => tool.id === current.activeToolId)
    const start = currentIndex >= 0 ? currentIndex : 0
    const offset = request.payload.direction === 'right' ? 1 : -1
    const next = tools[(start + offset + tools.length) % tools.length]
    if (!next) return null
    return dependencies.conversations.activateTool(state.selectionSessionId, next.tool.id)
  }

  async function deliverToolTo(
    state: TabSessionState,
    target: UiSurface,
    snapshot: ConversationSnapshot,
    requestId: string,
    stage: string,
    expectedUrl: string
  ): Promise<ToolShortcutResult> {
    if (target === 'sidePanel') {
      assertPage(state.tabId, expectedUrl)
      await dependencies.sidePanel.publish(state.windowId, {
        type: 'conversation.toolChanged',
        snapshot,
      })
      await markPanelOwner(state, snapshot, expectedUrl)
      return { handled: true, target: 'sidePanel', snapshot: cloneSnapshot(snapshot) }
    }

    await deliverContent(state, snapshot, requestId, stage, expectedUrl)
    await markContentOwner(state, snapshot, expectedUrl)
    return { handled: true, target: 'contentScript', snapshot: cloneSnapshot(snapshot) }
  }

  async function runToolShortcut(
    request: SelectToolShortcutRequest | CycleToolShortcutRequest,
    source: UiEventSource
  ): Promise<ToolShortcutResult> {
    return runForTab(source.tabId, async () => {
      const state = await getOrCreateState(source)
      const target: UiSurface | null = panelOwnsTab(state)
        ? 'sidePanel'
        : state.contentUIAppeared
          ? 'contentScript'
          : null
      if (target === null) {
        trace('tool shortcut ignored because no UI appears', {
          requestId: request.requestId,
          stage: request.type,
          tabId: state.tabId,
          windowId: state.windowId,
          pageUrl: state.pageUrl,
          source: source.surface,
          selectionSessionId: state.selectionSessionId,
          outcome: 'no-ui',
        })
        return { handled: false, reason: 'NO_APPEARED_UI' }
      }

      const snapshot = await chooseToolSnapshot(state, request)
      assertSourceFresh(source)
      if (!snapshot) return { handled: false, reason: 'TOOL_UNAVAILABLE' }
      return deliverToolTo(
        state,
        target,
        snapshot,
        request.requestId,
        request.type,
        normalizePageUrl(source.pageUrl)
      )
    })
  }

  async function initialize(): Promise<void> {
    const stored = await dependencies.sessionStore.load()
    tabStates.clear()
    panelWindows.clear()
    panelSessions.clear()
    deliveryRoutes.clear()
    handoffEpochs.clear()
    for (const [tabId, value] of Object.entries(stored)) {
      const numericTabId = Number(tabId)
      if (!isPositiveInteger(numericTabId) || value.tabId !== numericTabId) continue
      if (!isValidStoredState(value)) continue
      const normalized = { ...value, pageUrl: normalizePageUrl(value.pageUrl) }
      tabStates.set(numericTabId, normalized)
      currentPages.set(numericTabId, normalized.pageUrl)
      if (normalized.sidePanelAppeared) panelWindows.add(normalized.windowId)
      if (normalized.contentUIAppeared) {
        deliveryRoutes.set(numericTabId, { to: 'contentScript' })
      }
    }
    trace('initialized UI session coordinator', {
      stage: 'initialize',
      tabId: 0,
      windowId: 0,
      restoredTabs: tabStates.size,
      panelWindows: panelWindows.size,
      outcome: 'ready',
    })
  }

  async function reportContentStatus(
    request: SurfaceStatusRequest,
    sender: chrome.runtime.MessageSender
  ): Promise<SurfaceStatusResponse> {
    const source = resolveContentSource(sender, request.requestId)
    return runForTab(source.tabId, async () => {
      const state = await getOrCreateState(source)
      if (request.payload.status === 'appeared') {
        state.contentUIAppeared = true
        deliveryRoutes.set(state.tabId, { to: 'contentScript' })
        if (request.payload.selectionSessionId !== null) {
          state.selectionSessionId = request.payload.selectionSessionId
        }
      } else {
        state.contentUIAppeared = false
        if (deliveryRoutes.get(state.tabId)?.to === 'contentScript') {
          deliveryRoutes.delete(state.tabId)
        }
      }
      await commitPage(source)
      return {
        currentUI: state.sidePanelAppeared
          ? 'sidePanel'
          : state.contentUIAppeared
            ? 'contentScript'
            : 'none',
        latestUI: state.latestUI,
        selectionSessionId: state.selectionSessionId,
      }
    })
  }

  async function reportPanelStatus(
    request: SurfaceStatusRequest,
    panelBinding: PanelBinding
  ): Promise<SurfaceStatusResponse> {
    const source = await sourceFromPanel(panelBinding, request.requestId)
    return runForTab(source.tabId, async () => {
      const state = await getOrCreateState(source)
      if (request.payload.status === 'appeared') {
        panelWindows.add(state.windowId)
        panelActiveTab.set(state.windowId, state.tabId)
        state.sidePanelAppeared = true
        if (request.payload.selectionSessionId !== null) {
          state.selectionSessionId = request.payload.selectionSessionId
        }
        if (!state.contentUIAppeared) {
          deliveryRoutes.set(state.tabId, { to: 'sidePanel', windowId: state.windowId })
        }
      } else {
        state.sidePanelAppeared = false
        invalidateHandoff(state.tabId)
        if (state.contentUIAppeared) {
          deliveryRoutes.set(state.tabId, { to: 'contentScript' })
        } else {
          deliveryRoutes.delete(state.tabId)
        }
        if (
          ![...tabStates.values()].some(
            (item) => item.windowId === state.windowId && item.sidePanelAppeared
          )
        ) {
          panelWindows.delete(state.windowId)
          panelActiveTab.delete(state.windowId)
        }
      }
      await commitPage(source)
      return {
        currentUI: state.sidePanelAppeared
          ? 'sidePanel'
          : state.contentUIAppeared
            ? 'contentScript'
            : 'none',
        latestUI: state.latestUI,
        selectionSessionId: state.selectionSessionId,
      }
    })
  }

  async function routeSelection(
    request: SelectionRouteRequest,
    sender: chrome.runtime.MessageSender
  ): Promise<SelectionRouteResult> {
    const source = resolveContentSource(sender, request.requestId)
    return runForTab(source.tabId, async () => {
      const state = await getOrCreateState(source)
      const target: UiSurface = panelOwnsTab(state) ? 'sidePanel' : 'contentScript'
      const expectedUrl = normalizePageUrl(source.pageUrl)
      trace('selection routing started', {
        requestId: request.requestId,
        stage: 'selection.route',
        tabId: state.tabId,
        windowId: state.windowId,
        pageUrl: state.pageUrl,
        source: 'contentScript',
        target,
        selectionSessionId: state.selectionSessionId,
        outcome: 'start',
      })
      assertSourceFresh(source)
      const snapshot = await dependencies.conversations.createSelection({
        tabId: state.tabId,
        replaceSelectionSessionId: state.selectionSessionId,
        selectedText: request.payload.selectedText,
        contextText: request.payload.contextText,
      })
      try {
        assertSourceFresh(source)
      } catch (error) {
        // The just-created session is unreferenced; best-effort clean it up while
        // tolerating a racing navigation that already removed it.
        await dependencies.conversations
          .deleteSelectionSession(snapshot.selectionSession.id)
          .catch(() => undefined)
        throw error
      }
      state.selectionSessionId = snapshot.selectionSession.id

      if (target === 'sidePanel') {
        try {
          await commandAppearedPanel(state, snapshot, expectedUrl)
          return { target: 'sidePanel', display: false, snapshot: null }
        } catch (error) {
          traceError('selection side panel delivery failed; falling back to content', error, {
            requestId: request.requestId,
            stage: 'selection.route',
            tabId: state.tabId,
            windowId: state.windowId,
            pageUrl: state.pageUrl,
            source: 'contentScript',
            target: 'sidePanel',
            selectionSessionId: snapshot.selectionSession.id,
            conversationId: snapshot.conversation.id,
            outcome: 'fallback-content',
          })
          state.sidePanelAppeared = false
          panelWindows.delete(state.windowId)
          panelActiveTab.delete(state.windowId)
          assertSourceFresh(source)
          await markContentOwner(
            state,
            snapshot,
            expectedUrl,
            request.payload.bookmark && request.payload.anchorRect
              ? {
                  selectionSessionId: snapshot.selectionSession.id,
                  bookmark: request.payload.bookmark,
                  anchorRect: request.payload.anchorRect,
                }
              : undefined
          )
          return { target: 'contentScript', display: true, snapshot: cloneSnapshot(snapshot) }
        }
      }

      await markContentOwner(
        state,
        snapshot,
        expectedUrl,
        request.payload.bookmark && request.payload.anchorRect
          ? {
              selectionSessionId: snapshot.selectionSession.id,
              bookmark: request.payload.bookmark,
              anchorRect: request.payload.anchorRect,
            }
          : undefined
      )
      return { target: 'contentScript', display: true, snapshot: cloneSnapshot(snapshot) }
    })
  }

  async function togglePanel(
    request: PanelToggleRequest,
    source: UiEventSource
  ): Promise<PanelToggleResult> {
    return runForTab(source.tabId, async () => {
      const state = await getOrCreateState(source)
      const expectedUrl = normalizePageUrl(source.pageUrl)
      if (windowHasPanel(state.windowId)) {
        const snapshot = await loadSnapshot(state)
        // Reject before the close side effect when identity already turned stale.
        assertSourceFresh(source)
        await dependencies.sidePanel.close(state.windowId)
        assertSourceFresh(source)
        for (const item of tabStates.values()) {
          if (item.windowId === state.windowId) item.sidePanelAppeared = false
        }
        panelWindows.delete(state.windowId)
        panelActiveTab.delete(state.windowId)
        for (const item of tabStates.values()) {
          if (item.windowId !== state.windowId) continue
          invalidateHandoff(item.tabId)
          if (item.contentUIAppeared) {
            deliveryRoutes.set(item.tabId, { to: 'contentScript' })
          } else {
            deliveryRoutes.delete(item.tabId)
          }
        }
        await commitPage(source)
        return {
          currentUI: 'none',
          latestUI: state.latestUI,
          action: 'destroy',
          snapshot: snapshot ? cloneSnapshot(snapshot) : null,
        }
      }

      const contentUIAppeared =
        source.surface === 'contentScript' && request.payload.origin === 'contentScript'
          ? request.payload.contentUIAppeared
          : state.contentUIAppeared
      state.contentUIAppeared = contentUIAppeared
      if (contentUIAppeared || state.latestUI === 'sidePanel') {
        const snapshot = await openPanelWithSnapshot(
          state,
          request.requestId,
          'shortcut.panelToggle',
          expectedUrl
        )
        return {
          currentUI: 'sidePanel',
          latestUI: state.latestUI,
          action: 'restore',
          snapshot: snapshot ? cloneSnapshot(snapshot) : null,
          contentRestore: undefined,
        }
      }

      const snapshot = await loadSnapshot(state)
      await deliverContent(state, snapshot, request.requestId, 'shortcut.panelToggle', expectedUrl)
      const contentRestore = state.contentRestore
      await markContentOwner(state, snapshot, expectedUrl, contentRestore)
      return {
        currentUI: 'contentScript',
        latestUI: state.latestUI,
        action: 'restore',
        snapshot: snapshot ? cloneSnapshot(snapshot) : null,
        contentRestore: state.contentRestore,
      }
    })
  }

  function selectTool(
    request: SelectToolShortcutRequest,
    source: UiEventSource
  ): Promise<ToolShortcutResult> {
    return runToolShortcut(request, source)
  }

  function cycleTool(
    request: CycleToolShortcutRequest,
    source: UiEventSource
  ): Promise<ToolShortcutResult> {
    return runToolShortcut(request, source)
  }

  /**
   * Starts opening the global Side Panel for `tabId` inside the caller's user
   * gesture frame. Called synchronously at the message boundary before any await,
   * so Chrome accepts `sidePanel.open()`. The subsequent handoff skips its
   * own open (see `gestureOpenedTabs`). Safe to call when the panel is already
   * open or the tab is unknown.
   */
  function openPanelForGesture(tabId: number, windowId: number, contentUIAppeared?: boolean): void {
    if (!isPositiveInteger(tabId) || !isPositiveInteger(windowId)) return
    const state = tabStates.get(tabId)
    if (!state || windowHasPanel(state.windowId)) return
    if (contentUIAppeared === false && state.latestUI === 'contentScript') return
    gestureOpenedTabs.add(tabId)
    void dependencies.sidePanel
      .open(tabId)
      .catch(() => {
        // A rejected open must not leave a stale skip mark that would make a
        // later `deliverPanel` skip its own open attempt.
        gestureOpenedTabs.delete(tabId)
      })
      .catch((error: unknown) =>
        traceError('side panel gesture open failed', error, {
          tabId,
          windowId,
          outcome: 'failed',
        })
      )
  }

  async function publish(tabId: number, update: ConversationUpdate): Promise<boolean> {
    const state = tabStates.get(tabId)
    if (!state) return false
    const route = deliveryRoutes.get(tabId)
    if (route?.to === 'sidePanel') {
      await dependencies.sidePanel.publish(route.windowId, update)
      return true
    }
    if (route?.to === 'contentScript') {
      await dependencies.content.publish(tabId, update)
      return true
    }
    if (route?.to === 'sidePanelRecovering') return true
    if (panelOwnsTab(state)) {
      await dependencies.sidePanel.publish(state.windowId, update)
      return true
    }
    if (state.contentUIAppeared) {
      await dependencies.content.publish(tabId, update)
      return true
    }
    return false
  }

  async function onTabActivated(tabId: number, windowId: number): Promise<void> {
    // Streaming publish must see the new panel owner immediately, so the active-tab
    // claim stays outside the serialized body even when the body is queued behind work.
    panelActiveTab.set(windowId, tabId)
    await runForTab(tabId, async () => {
      const tab = await dependencies.tabs.get(tabId)
      const pageUrl = tab.url ? normalizePageUrl(tab.url) : ''
      const state = tabStates.get(tabId) ?? (pageUrl ? freshState(tabId, windowId, pageUrl) : null)
      if (!state) return
      state.windowId = windowId
      if (pageUrl) await resetForNavigation(state, pageUrl)
      // A removed tab must reject without resurrecting its shared-maps entries.
      checkOpen(tabId)
      if (pageUrl) currentPages.set(tabId, pageUrl)
      tabStates.set(tabId, state)
      if (!windowHasPanel(windowId)) {
        await persist()
        return
      }
      const snapshot = await loadSnapshot(state)
      const expectedUrl = pageUrl || state.pageUrl
      if (snapshot) state.latestUI = 'sidePanel'
      if (snapshot) {
        await dependencies.sidePanel.publish(windowId, {
          type: 'conversation.sync',
          snapshot,
        })
      } else {
        await deliverPanel(state, { type: 'clear' }, { stage: 'tab-activated', expectedUrl })
      }
      deliveryRoutes.set(tabId, {
        to: 'sidePanel',
        windowId,
        panelSessionId: panelSessions.get(windowId)?.panelSessionId,
      })
      if (state.contentUIAppeared) {
        await dependencies.content.destroy(tabId)
        state.contentUIAppeared = false
      }
      state.sidePanelAppeared = true
      await persist()
    })
  }

  async function onTabUpdated(tabId: number, windowId: number, url: string): Promise<void> {
    // Invalidate an in-flight handoff before waiting for this tab's serialized work.
    const pageUrl = normalizePageUrl(url)
    if (currentPages.get(tabId) === pageUrl) return
    currentPages.set(tabId, pageUrl)
    invalidateHandoff(tabId)
    deliveryRoutes.delete(tabId)
    await runForTab(tabId, async () => {
      assertPage(tabId, pageUrl)
      const state = tabStates.get(tabId) ?? freshState(tabId, windowId, pageUrl)
      state.windowId = windowId
      await resetForNavigation(state, pageUrl)
      // A removed tab must reject without resurrecting its shared-maps entries.
      assertPage(tabId, pageUrl)
      tabStates.set(tabId, state)
      await persist()
    })
  }

  async function onTabRemoved(tabId: number, _windowId: number): Promise<void> {
    closedTabs.add(tabId)
    gestureOpenedTabs.delete(tabId)
    deliveryRoutes.delete(tabId)
    handoffEpochs.delete(tabId)
    currentPages.delete(tabId)
    for (const [windowId, activeTabId] of panelActiveTab) {
      if (activeTabId === tabId) {
        panelActiveTab.delete(windowId)
        panelSessions.delete(windowId)
      }
    }
    const state = tabStates.get(tabId)
    tabStates.delete(tabId)
    await persist()
    if (state?.selectionSessionId !== null && state?.selectionSessionId !== undefined) {
      await dependencies.conversations.stopSelectionSession(state.selectionSessionId)
      await dependencies.conversations.deleteSelectionSession(state.selectionSessionId)
    }
  }

  async function onPanelOpened(windowId: number): Promise<void> {
    panelWindows.add(windowId)
    for (const state of tabStates.values()) {
      if (state.windowId === windowId) state.sidePanelAppeared = true
    }
    await persist()
  }

  async function onPanelClosed(windowId: number): Promise<void> {
    panelWindows.delete(windowId)
    panelActiveTab.delete(windowId)
    panelSessions.delete(windowId)
    for (const state of tabStates.values()) {
      if (state.windowId !== windowId) continue
      state.sidePanelAppeared = false
      invalidateHandoff(state.tabId)
      if (state.contentUIAppeared) {
        deliveryRoutes.set(state.tabId, { to: 'contentScript' })
      } else {
        deliveryRoutes.delete(state.tabId)
      }
    }
    await persist()
  }

  async function attachPanelSession(session: ReadyPanelSession): Promise<void> {
    await runForTab(session.tabId, async () => {
      const tab = await dependencies.tabs.get(session.tabId)
      if (tab.windowId !== session.windowId || !tab.url) throw stale(session.tabId)
      const pageUrl = normalizePageUrl(tab.url)
      const state =
        tabStates.get(session.tabId) ?? freshState(session.tabId, session.windowId, pageUrl)
      state.windowId = session.windowId
      await resetForNavigation(state, pageUrl)
      checkOpen(session.tabId)
      tabStates.set(session.tabId, state)
      currentPages.set(session.tabId, pageUrl)
      panelWindows.add(session.windowId)
      panelActiveTab.set(session.windowId, session.tabId)
      panelSessions.set(session.windowId, { ...session })

      if (state.sidePanelAppeared && !state.contentUIAppeared) {
        const snapshot = await loadSnapshot(state)
        const synchronized = snapshot
          ? dependencies.sidePanel.publish(session.windowId, {
              type: 'conversation.sync',
              snapshot,
            })
          : dependencies.sidePanel
              .command(session.windowId, { type: 'clear' })
              .then(() => undefined)
        deliveryRoutes.set(session.tabId, {
          to: 'sidePanel',
          windowId: session.windowId,
          panelSessionId: session.panelSessionId,
        })
        await synchronized
        const current = panelSessions.get(session.windowId)
        if (
          current?.panelSessionId !== session.panelSessionId ||
          current.generation !== session.generation
        ) {
          throw stale(session.tabId)
        }
        assertPage(session.tabId, pageUrl)
        state.latestUI = 'sidePanel'
        state.selectionSessionId = snapshot?.selectionSession.id ?? state.selectionSessionId
      }
      await persist()
    })
  }

  async function disconnectPanelSession(input: {
    panelSessionId: string
    windowId: number
    generation: number
    channel: SidePanelChannel
  }): Promise<void> {
    const current = panelSessions.get(input.windowId)
    if (
      !current ||
      current.panelSessionId !== input.panelSessionId ||
      input.generation < current.generation
    ) {
      return
    }
    panelSessions.set(input.windowId, { ...current, generation: input.generation })
    if (input.channel !== 'update') return
    const route = deliveryRoutes.get(current.tabId)
    if (route?.to === 'sidePanel' && route.panelSessionId === input.panelSessionId) {
      deliveryRoutes.set(current.tabId, {
        to: 'sidePanelRecovering',
        windowId: input.windowId,
        panelSessionId: input.panelSessionId,
      })
    }
  }

  return {
    initialize,
    reportContentStatus,
    reportPanelStatus,
    routeSelection,
    togglePanel,
    selectTool,
    cycleTool,
    publish,
    openPanelForGesture,
    onTabActivated,
    onTabUpdated,
    onTabRemoved,
    onPanelOpened,
    onPanelClosed,
    attachPanelSession,
    disconnectPanelSession,
  }
}
