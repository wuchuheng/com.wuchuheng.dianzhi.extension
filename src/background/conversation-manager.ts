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
import type { DianzhiSettings } from '@/dianzhi/domain/types'
import type { OffscreenClient } from './offscreen-client'
import type { ProviderRunHandle, ProviderRunInput } from './provider-runner'
import type { StoredConversationSnapshot } from '@/offscreen/database/store'

export interface TabConversationState {
  selectionKey: number
  activeToolId: string
  activeConversationId: number
  panelOpen: boolean
}

export interface ConversationSessionStore {
  load(): Promise<Record<string, TabConversationState>>
  save(state: Record<string, TabConversationState>): Promise<void>
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
    close(tabId: number): Promise<void>
  }
}

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
  const pendingHandoffs = new Map<number, number>()
  let saveChain = Promise.resolve()

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
        typeof state.activeToolId === 'string' &&
        typeof state.panelOpen === 'boolean'
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

  function providerMessages(messages: readonly MessageRecord[]) {
    return messages
      .filter((message) => message.role === 'user' || Boolean(message.content))
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
      const previousRun = liveRuns.get(previous.activeConversationId)
      if (previousRun) {
        previousRun.stop()
        await previousRun.done.catch(() => undefined)
      } else {
        dependencies.providerRunner.stop?.(previous.activeConversationId)
      }
    }
    const promptSnapshot = fillTemplate(effectivePrompt(tool), {
      selected: command.payload.selectedText,
      context: command.payload.contextText,
    })
    const stored = await dependencies.database.request('createSelection', {
      tabId,
      ...(previous ? { replaceSelectionKey: previous.selectionKey } : {}),
      tool,
      selectedText: command.payload.selectedText,
      contextText: command.payload.contextText,
      promptSnapshot,
    })
    const snapshot = snapshotFromStored(stored, settings, tool.id)
    tabStates.set(tabId, {
      selectionKey: stored.conversation.selectionKey,
      activeToolId: tool.id,
      activeConversationId: stored.conversation.id,
      panelOpen: previous?.panelOpen ?? false,
    })
    await persistStates()
    const assistant = await dependencies.database.request('appendAssistant', {
      conversationId: stored.conversation.id,
    })
    await startProvider(snapshot, settings, assistant)
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

    if (command.type === 'panel.open') {
      if (source !== 'content')
        throw invalid('Only a content-script user gesture can open the Side Panel.')
      const tabId = sender.tab?.id
      if (!tabId) throw invalid('The Side Panel must be opened from a content-script user gesture.')
      pendingHandoffs.set(command.payload.conversationId, tabId)
      let opened = false
      try {
        await dependencies.sidePanel.open(tabId)
        opened = true
        const settings = await dependencies.loadSettings()
        const snapshot = await loadSnapshot(command.payload.conversationId, settings)
        if (snapshot.conversation.tabId !== tabId) {
          throw invalid('The conversation does not belong to this tab.')
        }
        const state = tabStates.get(tabId)
        if (state) {
          state.panelOpen = true
          await persistStates()
        }
        return { accepted: true, snapshot }
      } catch (error) {
        pendingHandoffs.delete(command.payload.conversationId)
        if (opened) await dependencies.sidePanel.close(tabId).catch(() => undefined)
        throw error
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
        selectionKey: command.payload.selectionKey,
        tool,
        promptSnapshot,
      })
      const snapshot = snapshotFromStored(stored, settings, tool.id)
      state.activeToolId = tool.id
      state.activeConversationId = stored.conversation.id
      tabStates.set(tabId, state)
      liveSnapshots.set(stored.conversation.id, cloneSnapshot(snapshot))
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
      const tabId = pendingHandoffs.get(command.payload.conversationId)
      if (!tabId) throw invalid('No matching Side Panel handoff is pending.')
      const snapshot = await loadSnapshot(command.payload.conversationId, settings)
      await publish({ type: 'panel.handoffReady', conversationId: command.payload.conversationId })
      pendingHandoffs.delete(command.payload.conversationId)
      return { accepted: true, snapshot }
    }

    if (source !== 'extension') throw invalid('Only the Side Panel can request panel closure.')
    const tabId = tabForConversation(command.payload.conversationId)
    if (tabId === null) throw invalid('The Side Panel conversation is not associated with a tab.')
    await dependencies.sidePanel.close(tabId)
    const state = tabStates.get(tabId)
    if (state) {
      state.panelOpen = false
      await persistStates()
    }
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
      const pending = [...pendingHandoffs.entries()].find(([, tabId]) => tabId === senderTabId)
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

    port.onMessage.addListener((message: unknown) => {
      if (
        typeof message !== 'object' ||
        message === null ||
        (message as { type?: unknown }).type !== 'subscribe' ||
        !Number.isSafeInteger((message as { conversationId?: unknown }).conversationId)
      ) {
        return
      }
      const conversationId = (message as { conversationId: number }).conversationId
      if (conversationId < 1) return
      subscribe(conversationId)
    })
    port.onDisconnect.addListener(() => disconnect(port))
  }

  function disconnect(port: chrome.runtime.Port): void {
    for (const [conversationId, ports] of subscribers) {
      ports.delete(port)
      if (ports.size === 0) subscribers.delete(conversationId)
    }
  }

  function getLiveSnapshot(conversationId: number): ConversationSnapshot | null {
    const snapshot = liveSnapshots.get(conversationId)
    return snapshot ? cloneSnapshot(snapshot) : null
  }

  return { initialize, handle, publish, connect, disconnect, getLiveSnapshot }
}

export type ConversationManager = ReturnType<typeof createConversationManager>
