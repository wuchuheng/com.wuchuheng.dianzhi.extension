import { DianzhiError } from '@/dianzhi/domain/errors'
import { effectivePrompt } from '@/dianzhi/domain/settings'
import { fillTemplate } from '@/dianzhi/domain/template'
import type {
  ConversationCommand,
  ConversationCommandResult,
  ConversationSnapshot,
  ConversationUpdate,
  MessageRecord,
} from '@/dianzhi/domain/protocol'
import { SIDEPANEL_PORT_NAME } from '@/dianzhi/domain/protocol'
import { log, logError, Scope } from '@/events/logger'
import type { DianzhiSettings } from '@/dianzhi/domain/types'
import type { OffscreenClient } from './offscreen-client'
import type { ProviderRunHandle, ProviderRunInput } from './provider-runner'
import type { StoredConversationSnapshot } from '@/offscreen/database/store'

export interface TabConversationState {
  selectionKey: number
  activeToolId: number
  activeConversationId: number
  panelOpen: boolean
  windowId?: number
}

export interface ConversationSessionStore {
  load(): Promise<Record<string, TabConversationState>>
  save(state: Record<string, TabConversationState>): Promise<void>
}

interface PendingHandoff {
  tabId: number
  resolve(): void
  reject(error: unknown): void
  timeout: ReturnType<typeof globalThis.setTimeout> | null
  superseded: boolean
}

interface PanelTabBinding {
  tabId: number
  windowId: number
}

export interface ConversationManagerDependencies {
  database: OffscreenClient
  loadSettings(): Promise<DianzhiSettings>
  providerRunner: {
    start(input: ProviderRunInput): ProviderRunHandle
    stop?(conversationId: number): boolean
  }
  sendToContent(tabId: number, update: ConversationUpdate): Promise<void>
  session: ConversationSessionStore
  sidePanel: {
    open(tabId: number): Promise<void>
    close(windowId: number): Promise<void>
  }
  setTimeout?(callback: () => void, milliseconds: number): ReturnType<typeof globalThis.setTimeout>
  clearTimeout?(handle: ReturnType<typeof globalThis.setTimeout>): void
  sidePanelReadyTimeoutMs?: number
  sidePanelDisconnectGraceMs?: number
}

const DEFAULT_SIDE_PANEL_READY_TIMEOUT_MS = 5_000
const DEFAULT_SIDE_PANEL_DISCONNECT_GRACE_MS = 500

function cloneSnapshot(snapshot: ConversationSnapshot): ConversationSnapshot {
  return {
    conversation: { ...snapshot.conversation },
    messages: snapshot.messages.map((message) => ({ ...message })),
    tools: snapshot.tools.map(({ tool, conversationId }) => ({
      tool: { ...tool },
      conversationId,
    })),
    activeToolId: snapshot.activeToolId,
  }
}

function invalid(message: string): DianzhiError {
  return new DianzhiError({ code: 'INVALID_EVENT', message })
}

export function createConversationManager(dependencies: ConversationManagerDependencies) {
  const tabStates = new Map<number, TabConversationState>()
  const liveSnapshots = new Map<number, ConversationSnapshot>()
  const liveRuns = new Map<number, ProviderRunHandle>()
  const subscribers = new Map<number, Set<chrome.runtime.Port>>()
  const pendingHandoffs = new Map<number, PendingHandoff>()
  const panelTabs = new Map<chrome.runtime.Port, PanelTabBinding>()
  const pendingPanelCloses = new Map<number, ReturnType<typeof globalThis.setTimeout>>()
  const schedule = dependencies.setTimeout ?? globalThis.setTimeout
  const cancel = dependencies.clearTimeout ?? globalThis.clearTimeout
  const sidePanelReadyTimeoutMs =
    dependencies.sidePanelReadyTimeoutMs ?? DEFAULT_SIDE_PANEL_READY_TIMEOUT_MS
  const sidePanelDisconnectGraceMs =
    dependencies.sidePanelDisconnectGraceMs ?? DEFAULT_SIDE_PANEL_DISCONNECT_GRACE_MS
  let saveChain = Promise.resolve()

  function takePendingHandoff(conversationId: number, expected?: PendingHandoff) {
    const pending = pendingHandoffs.get(conversationId)
    if (!pending || (expected && pending !== expected)) return null
    pendingHandoffs.delete(conversationId)
    if (pending.timeout !== null) cancel(pending.timeout)
    pending.timeout = null
    return pending
  }

  function cancelPendingPanelClose(tabId: number): void {
    const timeout = pendingPanelCloses.get(tabId)
    if (timeout === undefined) return
    pendingPanelCloses.delete(tabId)
    cancel(timeout)
  }

  function persistStates(): Promise<void> {
    const serialized = Object.fromEntries(
      [...tabStates.entries()].map(([tabId, state]) => [String(tabId), { ...state }])
    )
    saveChain = saveChain.then(() => dependencies.session.save(serialized))
    return saveChain
  }

  async function initialize(): Promise<void> {
    const stored = await dependencies.session.load()
    for (const [tabId, state] of Object.entries(stored)) {
      const numericTabId = Number(tabId)
      if (
        Number.isSafeInteger(numericTabId) &&
        numericTabId > 0 &&
        Number.isSafeInteger(state.selectionKey) &&
        state.selectionKey > 0 &&
        Number.isSafeInteger(state.activeConversationId) &&
        state.activeConversationId > 0 &&
        Number.isSafeInteger(state.activeToolId) &&
        state.activeToolId > 0 &&
        typeof state.panelOpen === 'boolean' &&
        (state.windowId === undefined ||
          (Number.isSafeInteger(state.windowId) && state.windowId > 0))
      ) {
        tabStates.set(numericTabId, { ...state })
      }
    }
  }

  function snapshotFromStored(
    stored: StoredConversationSnapshot,
    settings: DianzhiSettings,
    activeToolId = stored.conversation.toolId
  ): ConversationSnapshot {
    const conversations = stored.conversations
    const messages = stored.messages
    return {
      conversation: { ...stored.conversation },
      messages: messages.map((message) => ({ ...message })),
      tools: settings.tools
        .filter((tool) => tool.enabled)
        .map((tool) => ({
          tool: { ...tool },
          conversationId:
            conversations.find((conversation) => conversation.toolId === tool.id)?.id ??
            (stored.conversation.toolId === tool.id ? stored.conversation.id : null),
        })),
      activeToolId,
    }
  }

  function tabForConversation(conversationId: number): number | null {
    for (const [tabId, state] of tabStates) {
      if (state.activeConversationId === conversationId) return tabId
    }
    const snapshot = liveSnapshots.get(conversationId)
    return snapshot?.conversation.tabId ?? null
  }

  function moveSubscribers(fromConversationId: number, toConversationId: number): void {
    if (fromConversationId === toConversationId) return
    const ports = subscribers.get(fromConversationId)
    if (!ports) return
    subscribers.delete(fromConversationId)
    const destination = subscribers.get(toConversationId) ?? new Set<chrome.runtime.Port>()
    for (const port of ports) destination.add(port)
    subscribers.set(toConversationId, destination)
  }

  async function stopSelectionRuns(
    tabId: number,
    selectionKey: number,
    fallbackConversationId: number
  ): Promise<void> {
    const handles = [...liveRuns.entries()]
      .filter(([conversationId]) => {
        const conversation = liveSnapshots.get(conversationId)?.conversation
        return conversation?.tabId === tabId && conversation.selectionKey === selectionKey
      })
      .map(([, handle]) => handle)
    if (handles.length === 0) {
      dependencies.providerRunner.stop?.(fallbackConversationId)
      return
    }
    for (const handle of handles) handle.stop()
    await Promise.all(handles.map((handle) => handle.done.catch(() => undefined)))
  }

  function applyUpdate(update: ConversationUpdate): void {
    const snapshot = liveSnapshots.get(
      'snapshot' in update ? update.snapshot.conversation.id : update.conversationId
    )
    if ('snapshot' in update) {
      liveSnapshots.set(update.snapshot.conversation.id, cloneSnapshot(update.snapshot))
      return
    }
    if (!snapshot) return
    if (update.type === 'stream.started') {
      snapshot.messages = [
        ...snapshot.messages.filter((message) => message.id !== update.message.id),
        { ...update.message },
      ].sort((left, right) => left.sequence - right.sequence)
    } else if (update.type === 'stream.delta' || update.type === 'stream.reasoning') {
      const message = snapshot.messages.find((item) => item.id === update.messageId)
      if (message) {
        if (update.type === 'stream.delta') message.content += update.content
        else message.reasoningContent += update.content
      }
    } else if (
      update.type === 'stream.done' ||
      update.type === 'stream.stopped' ||
      update.type === 'stream.error'
    ) {
      const index = snapshot.messages.findIndex((message) => message.id === update.message.id)
      if (index >= 0) snapshot.messages[index] = { ...update.message }
    }
  }

  async function publish(update: ConversationUpdate): Promise<void> {
    applyUpdate(update)
    const conversationId =
      'snapshot' in update ? update.snapshot.conversation.id : update.conversationId
    const tabId = tabForConversation(conversationId)
    if (tabId !== null) await dependencies.sendToContent(tabId, update).catch(() => undefined)
    for (const port of subscribers.get(conversationId) ?? []) {
      try {
        port.postMessage(update)
      } catch {
        subscribers.get(conversationId)?.delete(port)
      }
    }
  }

  async function markPanelClosed(tabId: number, conversationId: number): Promise<void> {
    const state = tabStates.get(tabId)
    if (!state?.panelOpen) return
    state.panelOpen = false
    await persistStates()
    await publish({ type: 'panel.closed', conversationId })
  }

  /**
   * Idempotent panel closure: no-op when the panel is already marked closed,
   * and treats a browser rejection after a manual close or disconnect race as
   * the desired outcome.
   */
  async function closePanelIfOpen(
    tabId: number,
    conversationId: number,
    windowId?: number
  ): Promise<void> {
    if (!tabStates.get(tabId)?.panelOpen) return
    cancelPendingPanelClose(tabId)
    const resolvedWindowId = windowId ?? tabStates.get(tabId)?.windowId
    if (resolvedWindowId)
      await dependencies.sidePanel.close(resolvedWindowId).catch(() => undefined)
    await markPanelClosed(tabId, conversationId)
  }

  function providerMessages(messages: readonly MessageRecord[]) {
    return messages
      .filter(
        (message) =>
          message.role === 'user' ||
          (Boolean(message.content) && message.status !== 'error' && message.status !== 'stopped')
      )
      .map(({ role, content }) => ({ role, content }))
  }

  async function startProvider(
    snapshot: ConversationSnapshot,
    settings: DianzhiSettings,
    assistant: MessageRecord
  ): Promise<void> {
    const conversationId = snapshot.conversation.id
    const previous = liveRuns.get(conversationId)
    if (previous) {
      previous.stop()
      await previous.done.catch(() => undefined)
      const current = liveSnapshots.get(conversationId)
      if (current) snapshot.messages = current.messages.map((message) => ({ ...message }))
    }
    snapshot.messages = [
      ...snapshot.messages.filter((message) => message.id !== assistant.id),
      { ...assistant },
    ].sort((left, right) => left.sequence - right.sequence)
    liveSnapshots.set(conversationId, cloneSnapshot(snapshot))
    await publish({ type: 'stream.started', conversationId, message: assistant })
    const history = providerMessages(
      snapshot.messages.filter((message) => message.id !== assistant.id)
    )
    const handle = dependencies.providerRunner.start({
      conversationId,
      assistant,
      provider: settings.provider,
      messages: history,
    })
    liveRuns.set(conversationId, handle)
    void handle.done
      .catch(() => undefined)
      .finally(() => {
        if (liveRuns.get(conversationId) === handle) liveRuns.delete(conversationId)
      })
  }

  async function loadSnapshot(
    conversationId: number,
    settings: DianzhiSettings
  ): Promise<ConversationSnapshot> {
    const live = liveSnapshots.get(conversationId)
    if (live) return cloneSnapshot(live)
    const stored = await dependencies.database.request('getConversation', { id: conversationId })
    if (!stored) {
      throw new DianzhiError({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'The requested conversation was not found.',
        context: { conversationId },
      })
    }
    const recoveredMessages = await Promise.all(
      stored.messages.map((message) =>
        message.status === 'streaming'
          ? dependencies.database.request('finalizeAssistant', {
              messageId: message.id,
              input: {
                status: 'stopped',
                content: message.content,
                reasoningContent: message.reasoningContent,
                estimatedThroughputTps: null,
                errorCode: null,
                errorMessage: 'The background service restarted during generation.',
              },
            })
          : Promise.resolve(message)
      )
    )
    const snapshot = snapshotFromStored({ ...stored, messages: recoveredMessages }, settings)
    liveSnapshots.set(conversationId, cloneSnapshot(snapshot))
    return snapshot
  }

  async function handleCreate(
    command: Extract<ConversationCommand, { type: 'conversation.create' }>,
    sender: chrome.runtime.MessageSender
  ): Promise<ConversationCommandResult> {
    const tabId = sender.tab?.id
    if (!tabId) throw invalid('A trusted content-script tab is required to create a conversation.')
    const settings = await dependencies.loadSettings()
    const tool =
      settings.tools.find((item) => item.id === settings.ui.defaultToolId && item.enabled) ??
      settings.tools.find((item) => item.enabled)
    if (!tool) throw invalid('No enabled tool is available.')
    const previous = tabStates.get(tabId)
    if (previous) {
      await stopSelectionRuns(tabId, previous.selectionKey, previous.activeConversationId)
    }
    const promptSnapshot = fillTemplate(effectivePrompt(tool), {
      selected: command.payload.selectedText,
      context: command.payload.contextText,
    })
    const createArgs = {
      tabId,
      ...(previous ? { replaceSelectionSessionId: previous.selectionKey } : {}),
      tool,
      selectedText: command.payload.selectedText,
      contextText: command.payload.contextText,
      promptSnapshot,
    }
    const stored = await dependencies.database
      .request('createSelectionSession', createArgs)
      .catch((createError: unknown) => {
        console.error('[dianzhi] createSelectionSession failed', {
          operation: 'createSelectionSession',
          requestId: command.requestId,
          tabId,
          replaceSelectionSessionId: createArgs.replaceSelectionSessionId ?? null,
          code: createError instanceof DianzhiError ? createError.code : 'DB_UNAVAILABLE',
        })
        throw createError
      })
    const snapshot = snapshotFromStored(stored, settings, tool.id)
    tabStates.set(tabId, {
      selectionKey: stored.selectionSession.id,
      activeToolId: tool.id,
      activeConversationId: stored.conversation.id,
      panelOpen: previous?.panelOpen ?? false,
      windowId: sender.tab?.windowId,
    })
    await persistStates()
    const assistant = await dependencies.database.request('appendAssistant', {
      conversationId: stored.conversation.id,
    })
    await startProvider(snapshot, settings, assistant)
    if (previous?.panelOpen) {
      moveSubscribers(previous.activeConversationId, stored.conversation.id)
      const previousSubscribers = subscribers.get(stored.conversation.id)
      if (previousSubscribers) {
        const current = liveSnapshots.get(stored.conversation.id)
        if (current) {
          for (const port of previousSubscribers) {
            try {
              port.postMessage({ type: 'conversation.sync', snapshot: cloneSnapshot(current) })
            } catch {
              previousSubscribers.delete(port)
            }
          }
        }
      }
    }
    return { accepted: true, snapshot: cloneSnapshot(liveSnapshots.get(stored.conversation.id)!) }
  }

  async function handle(
    command: ConversationCommand,
    sender: chrome.runtime.MessageSender,
    source: 'content' | 'extension' = sender.tab?.id ? 'content' : 'extension'
  ): Promise<ConversationCommandResult> {
    if (command.type === 'conversation.create') {
      if (source !== 'content')
        throw invalid('Only a content script can create a selection conversation.')
      return handleCreate(command, sender)
    }

    if (command.type === 'panel.open' || command.type === 'panel.toggle') {
      if (source !== 'content')
        throw invalid('Only a content-script user gesture can open or toggle the Side Panel.')
      const tabId = sender.tab?.id
      if (!tabId)
        throw invalid('The Side Panel must be toggled from a content-script user gesture.')
      log(Scope.BACKGROUND, 'Content Side Panel command received.', {
        type: command.type,
        tabId,
        panelOpen: tabStates.get(tabId)?.panelOpen ?? false,
      })

      // Toggle-close is tab scoped: a hidden or stale content-script view may
      // hold an older conversation ID while this tab's Side Panel is open.
      if (command.type === 'panel.toggle') {
        const panelState = tabStates.get(tabId)
        if (panelState?.panelOpen) {
          log(Scope.BACKGROUND, 'Content Side Panel toggle is closing the open panel.', { tabId })
          await closePanelIfOpen(tabId, panelState.activeConversationId, sender.tab?.windowId)
          const settings = await dependencies.loadSettings()
          return {
            accepted: true,
            snapshot: await loadSnapshot(command.payload.conversationId, settings),
          }
        }
      }
      log(Scope.BACKGROUND, 'Content Side Panel command is opening the panel.', {
        tabId,
        conversationId: command.payload.conversationId,
      })
      let resolveReady!: () => void
      let rejectReady!: (error: unknown) => void
      const ready = new Promise<void>((resolve, reject) => {
        resolveReady = resolve
        rejectReady = reject
      })
      void ready.catch(() => undefined)
      const pending: PendingHandoff = {
        tabId,
        resolve: resolveReady,
        reject: rejectReady,
        timeout: null,
        superseded: false,
      }
      for (const [conversationId, existing] of pendingHandoffs) {
        if (conversationId !== command.payload.conversationId && existing.tabId !== tabId) continue
        existing.superseded = true
        takePendingHandoff(conversationId, existing)?.reject(
          new DianzhiError({
            code: 'SIDE_PANEL_OPEN_FAILED',
            message: 'A newer Side Panel handoff replaced this request.',
            context: { tabId, conversationId },
          })
        )
      }
      pendingHandoffs.set(command.payload.conversationId, pending)
      pending.timeout = schedule(() => {
        const expired = takePendingHandoff(command.payload.conversationId, pending)
        expired?.reject(
          new DianzhiError({
            code: 'SIDE_PANEL_READY_TIMEOUT',
            message: 'The Side Panel did not render the conversation in time.',
            context: { tabId, conversationId: command.payload.conversationId },
          })
        )
      }, sidePanelReadyTimeoutMs)
      let opened = false
      try {
        await dependencies.sidePanel.open(tabId)
        opened = true
        log(Scope.BACKGROUND, 'Chrome Side Panel open completed; awaiting panel readiness.', {
          tabId,
          conversationId: command.payload.conversationId,
        })
        const settings = await dependencies.loadSettings()
        const snapshot = await loadSnapshot(command.payload.conversationId, settings)
        if (snapshot.conversation.tabId !== tabId) {
          throw invalid('The conversation does not belong to this tab.')
        }
        await ready
        return { accepted: true, snapshot }
      } catch (error) {
        takePendingHandoff(command.payload.conversationId, pending)
        if (opened && !pending.superseded) {
          const windowId = sender.tab?.windowId
          if (windowId) await dependencies.sidePanel.close(windowId).catch(() => undefined)
        }
        logError(Scope.BACKGROUND, 'Chrome Side Panel open or handoff failed.', error)
        if (error instanceof DianzhiError) throw error
        throw new DianzhiError({
          code: 'SIDE_PANEL_OPEN_FAILED',
          message: 'The Side Panel could not be opened.',
          context: {
            tabId,
            reason:
              error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160),
          },
        })
      }
    }

    const settings = await dependencies.loadSettings()

    if (command.type === 'conversation.sync') {
      const snapshot = await loadSnapshot(command.payload.conversationId, settings)
      if (source === 'content' && snapshot.conversation.tabId !== sender.tab?.id) {
        throw invalid('The conversation does not belong to the sender tab.')
      }
      return { accepted: true, snapshot }
    }

    if (command.type === 'stream.stop') {
      const snapshot = await loadSnapshot(command.payload.conversationId, settings)
      if (source === 'content' && snapshot.conversation.tabId !== sender.tab?.id) {
        throw invalid('The conversation does not belong to the sender tab.')
      }
      liveRuns.get(command.payload.conversationId)?.stop()
      dependencies.providerRunner.stop?.(command.payload.conversationId)
      return { accepted: true, snapshot }
    }

    if (command.type === 'conversation.followup') {
      const snapshot = await loadSnapshot(command.payload.conversationId, settings)
      if (source === 'content' && snapshot.conversation.tabId !== sender.tab?.id) {
        throw invalid('The conversation does not belong to the sender tab.')
      }
      const previous = liveRuns.get(command.payload.conversationId)
      if (previous) {
        previous.stop()
        await previous.done.catch(() => undefined)
        const current = liveSnapshots.get(command.payload.conversationId)
        if (current) snapshot.messages = current.messages.map((message) => ({ ...message }))
      }
      const turn = await dependencies.database.request('appendTurn', {
        conversationId: command.payload.conversationId,
        content: command.payload.content,
      })
      snapshot.messages.push({ ...turn.user }, { ...turn.assistant })
      await startProvider(snapshot, settings, turn.assistant)
      return {
        accepted: true,
        snapshot: cloneSnapshot(liveSnapshots.get(command.payload.conversationId)!),
      }
    }

    if (command.type === 'conversation.retry') {
      const snapshot = await loadSnapshot(command.payload.conversationId, settings)
      if (source === 'content' && snapshot.conversation.tabId !== sender.tab?.id) {
        throw invalid('The conversation does not belong to the sender tab.')
      }
      const lastAssistant = [...snapshot.messages]
        .reverse()
        .find((message) => message.role === 'assistant')
      if (!lastAssistant || !['error', 'stopped'].includes(lastAssistant.status)) {
        throw invalid('Only a failed or stopped response can be retried.')
      }
      const assistant = await dependencies.database.request('appendAssistant', {
        conversationId: command.payload.conversationId,
      })
      await startProvider(snapshot, settings, assistant)
      return {
        accepted: true,
        snapshot: cloneSnapshot(liveSnapshots.get(command.payload.conversationId)!),
      }
    }

    if (command.type === 'conversation.ensureTool') {
      const stateEntry = [...tabStates.entries()].find(
        ([, state]) => state.selectionKey === command.payload.selectionKey
      )
      if (!stateEntry) throw invalid('The selection does not belong to an active tab.')
      const [tabId, state] = stateEntry
      if (source === 'content' && sender.tab?.id !== tabId) {
        throw invalid('The selection does not belong to the sender tab.')
      }
      const current = await loadSnapshot(state.activeConversationId, settings)
      const tool = settings.tools.find((item) => item.id === command.payload.toolId && item.enabled)
      if (!tool) throw invalid('The requested tool is unavailable.')
      const promptSnapshot = fillTemplate(effectivePrompt(tool), {
        selected: current.conversation.selectedText,
        context: current.conversation.contextText,
      })
      const stored = await dependencies.database.request('ensureToolConversation', {
        selectionSessionId: command.payload.selectionKey,
        tool,
        promptSnapshot,
      })
      const snapshot = snapshotFromStored(stored, settings, tool.id)
      const previousConversationId = state.activeConversationId
      state.activeToolId = tool.id
      state.activeConversationId = stored.conversation.id
      tabStates.set(tabId, state)
      liveSnapshots.set(stored.conversation.id, cloneSnapshot(snapshot))
      if (state.panelOpen) moveSubscribers(previousConversationId, stored.conversation.id)
      await persistStates()
      await publish({ type: 'conversation.toolChanged', snapshot })
      if (stored.messages.length === 1) {
        const assistant = await dependencies.database.request('appendAssistant', {
          conversationId: stored.conversation.id,
        })
        await startProvider(snapshot, settings, assistant)
      }
      return { accepted: true, snapshot: cloneSnapshot(liveSnapshots.get(stored.conversation.id)!) }
    }

    if (command.type === 'panel.rendered') {
      if (source !== 'extension') throw invalid('Only the Side Panel can acknowledge rendering.')
      const pending = takePendingHandoff(command.payload.conversationId)
      if (!pending) {
        const tabId = tabForConversation(command.payload.conversationId)
        const state = tabId === null ? null : tabStates.get(tabId)
        if (!state?.panelOpen || state.activeConversationId !== command.payload.conversationId) {
          throw invalid('No matching Side Panel handoff is pending.')
        }
        return {
          accepted: true,
          snapshot: await loadSnapshot(command.payload.conversationId, settings),
        }
      }
      try {
        const snapshot = await loadSnapshot(command.payload.conversationId, settings)
        const state = tabStates.get(pending.tabId)
        if (state) {
          state.panelOpen = true
          await persistStates()
        }
        await publish({
          type: 'panel.handoffReady',
          conversationId: command.payload.conversationId,
        })
        log(Scope.BACKGROUND, 'Side Panel rendered and handoff completed.', {
          tabId: pending.tabId,
          conversationId: command.payload.conversationId,
        })
        pending.resolve()
        return { accepted: true, snapshot }
      } catch (error) {
        pending.reject(error)
        throw error
      }
    }

    if (source !== 'extension') throw invalid('Only the Side Panel can request panel closure.')
    const tabId = tabForConversation(command.payload.conversationId)
    if (tabId === null) throw invalid('The Side Panel conversation is not associated with a tab.')
    await closePanelIfOpen(tabId, command.payload.conversationId)
    return {
      accepted: true,
      snapshot: await loadSnapshot(command.payload.conversationId, settings),
    }
  }

  function connect(port: chrome.runtime.Port): void {
    if (port.name !== SIDEPANEL_PORT_NAME) return
    const subscribe = (conversationId: number) => {
      const ports = subscribers.get(conversationId) ?? new Set<chrome.runtime.Port>()
      ports.add(port)
      subscribers.set(conversationId, ports)
      const snapshot = liveSnapshots.get(conversationId)
      if (snapshot)
        port.postMessage({ type: 'conversation.sync', snapshot: cloneSnapshot(snapshot) })
    }

    const senderTabId = port.sender?.tab?.id
    if (senderTabId) {
      const pending = [...pendingHandoffs.entries()].find(
        ([, handoff]) => handoff.tabId === senderTabId
      )
      if (pending) {
        const [conversationId] = pending
        subscribe(conversationId)
        if (!liveSnapshots.has(conversationId)) {
          void dependencies
            .loadSettings()
            .then((settings) => loadSnapshot(conversationId, settings))
            .then((snapshot) => port.postMessage({ type: 'conversation.sync', snapshot }))
            .catch(() => undefined)
        }
      }
    }

    port.onMessage.addListener(async (message: unknown) => {
      if (typeof message !== 'object' || message === null) return
      const input = message as {
        type?: unknown
        tabId?: unknown
        windowId?: unknown
        conversationId?: unknown
      }
      if (
        input.type === 'ready' &&
        Number.isSafeInteger(input.tabId) &&
        Number(input.tabId) > 0 &&
        Number.isSafeInteger(input.windowId) &&
        Number(input.windowId) > 0
      ) {
        const tabId = Number(input.tabId)
        const windowId = Number(input.windowId)
        log(Scope.BACKGROUND, 'Side Panel port ready received.', { tabId, windowId })
        cancelPendingPanelClose(tabId)
        panelTabs.set(port, { tabId, windowId })
        const pending = [...pendingHandoffs.entries()].find(
          ([, handoff]) => handoff.tabId === tabId
        )
        const state = tabStates.get(tabId)
        const conversationId =
          pending?.[0] ?? (state?.panelOpen ? state.activeConversationId : null)
        if (!conversationId) {
          log(Scope.BACKGROUND, 'Side Panel has no active conversation for its tab.', { tabId })
          return
        }
        log(Scope.BACKGROUND, 'Side Panel subscribing to the active conversation.', {
          tabId,
          conversationId,
        })
        subscribe(conversationId)
        if (!liveSnapshots.has(conversationId)) {
          void dependencies
            .loadSettings()
            .then((settings) => loadSnapshot(conversationId, settings))
            .then((snapshot) => port.postMessage({ type: 'conversation.sync', snapshot }))
            .catch(() => undefined)
        }
        return
      }
      if (input.type === 'close') {
        const binding = panelTabs.get(port)
        if (!binding) {
          logError(
            Scope.BACKGROUND,
            'Side Panel close request ignored because the port has no tab binding.'
          )
          return
        }
        const { tabId, windowId } = binding
        const conversationId = tabStates.get(tabId)?.activeConversationId
        log(Scope.BACKGROUND, 'Side Panel close request received.', {
          tabId,
          hasConversation: conversationId !== undefined,
        })
        try {
          await dependencies.sidePanel.close(windowId)
          log(Scope.BACKGROUND, 'Chrome Side Panel close completed.', { tabId, windowId })
        } catch (error) {
          logError(Scope.BACKGROUND, 'Chrome Side Panel close failed.', error)
        }
        if (conversationId) await markPanelClosed(tabId, conversationId)
        return
      }
      if (input.type !== 'subscribe' || !Number.isSafeInteger(input.conversationId)) return
      const conversationId = Number(input.conversationId)
      if (conversationId > 0) subscribe(conversationId)
    })
    port.onDisconnect.addListener(() => disconnect(port))
  }

  function disconnect(port: chrome.runtime.Port): void {
    for (const [conversationId, ports] of subscribers) {
      ports.delete(port)
      if (ports.size === 0) subscribers.delete(conversationId)
    }
    const binding = panelTabs.get(port)
    panelTabs.delete(port)
    if (!binding) return
    const { tabId } = binding
    const pending = [...pendingHandoffs.entries()].find(([, handoff]) => handoff.tabId === tabId)
    const conversationId = pending?.[0] ?? tabStates.get(tabId)?.activeConversationId
    if (!conversationId) return
    cancelPendingPanelClose(tabId)
    const timeout = schedule(() => {
      if (pendingPanelCloses.get(tabId) !== timeout) return
      pendingPanelCloses.delete(tabId)
      if (pending) {
        takePendingHandoff(conversationId, pending[1])?.reject(
          new DianzhiError({
            code: 'SIDE_PANEL_READY_TIMEOUT',
            message: 'The Side Panel closed before the conversation was ready.',
            context: { tabId, conversationId },
          })
        )
      }
      void markPanelClosed(tabId, conversationId)
    }, sidePanelDisconnectGraceMs)
    pendingPanelCloses.set(tabId, timeout)
  }

  function getLiveSnapshot(conversationId: number): ConversationSnapshot | null {
    const snapshot = liveSnapshots.get(conversationId)
    return snapshot ? cloneSnapshot(snapshot) : null
  }

  return { initialize, handle, publish, connect, disconnect, getLiveSnapshot }
}

export type ConversationManager = ReturnType<typeof createConversationManager>
