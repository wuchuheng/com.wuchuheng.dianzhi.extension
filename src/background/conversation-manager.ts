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
import { log, Scope } from '@/events/logger'
import type { DianzhiSettings } from '@/dianzhi/domain/types'
import type { OffscreenClient } from './offscreen-client'
import type { ProviderRunHandle, ProviderRunInput } from './provider-runner'
import type { StoredConversationSnapshot } from '@/offscreen/database/store'

export interface UiConversationGateway {
  createSelection(input: {
    tabId: number
    replaceSelectionSessionId: number | null
    selectedText: string
    contextText: string
  }): Promise<ConversationSnapshot>
  loadSelectionSession(selectionSessionId: number): Promise<ConversationSnapshot>
  activateTool(selectionSessionId: number, toolId: number): Promise<ConversationSnapshot>
  stopSelectionSession(selectionSessionId: number): Promise<void>
  deleteSelectionSession(selectionSessionId: number): Promise<void>
}

export interface ConversationManagerDependencies {
  database: OffscreenClient
  loadSettings(): Promise<DianzhiSettings>
  providerRunner: {
    start(input: ProviderRunInput): ProviderRunHandle
    stop?(conversationId: number): boolean
  }
  publishToOwner(tabId: number, update: ConversationUpdate): Promise<void>
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

function invalid(message: string): DianzhiError {
  return new DianzhiError({ code: 'INVALID_EVENT', message })
}

export function createConversationManager(dependencies: ConversationManagerDependencies) {
  const liveSnapshots = new Map<number, ConversationSnapshot>()
  const liveRuns = new Map<number, ProviderRunHandle>()

  async function initialize(): Promise<void> {}

  async function normalizeStoredSnapshot(
    stored: StoredConversationSnapshot
  ): Promise<StoredConversationSnapshot> {
    const conversations =
      stored.conversations.length > 0 ? stored.conversations : [stored.conversation]
    const active = conversations.find(
      (conversation) => conversation.id === stored.selectionSession.activeConversationId
    )
    if (!active) {
      const fallback = conversations[0]
      if (!fallback) throw invalid('The selection session has no valid active conversation.')
      log(Scope.BACKGROUND, 'Recovered stale selection-session active conversation pointer.', {
        selectionSessionId: stored.selectionSession.id,
        fallbackConversationId: fallback.id,
      })
      const recovered = await dependencies.database.request('setActiveConversation', {
        selectionSessionId: stored.selectionSession.id,
        conversationId: fallback.id,
      })
      return normalizeStoredSnapshot(recovered)
    }

    if (active.id !== stored.conversation.id) {
      const activeStored = await dependencies.database.request('getSelectionSession', {
        id: stored.selectionSession.id,
      })
      if (!activeStored) {
        throw new DianzhiError({
          code: 'CONVERSATION_NOT_FOUND',
          message: 'The requested selection session was not found.',
          context: { selectionSessionId: stored.selectionSession.id },
        })
      }
      return normalizeStoredSnapshot(activeStored)
    }

    return stored
  }

  async function snapshotFromStored(
    stored: StoredConversationSnapshot,
    settings: DianzhiSettings
  ): Promise<ConversationSnapshot> {
    const normalized = await normalizeStoredSnapshot(stored)
    const conversations =
      normalized.conversations.length > 0 ? normalized.conversations : [normalized.conversation]
    return {
      selectionSession: { ...normalized.selectionSession },
      conversation: { ...normalized.conversation },
      messages: normalized.messages.map((message) => ({ ...message })),
      tools: settings.tools
        .filter((tool) => tool.enabled)
        .map((tool) => ({
          tool: { ...tool },
          conversationId:
            conversations.find((conversation) => conversation.toolId === tool.id)?.id ?? null,
        })),
      activeToolId: normalized.conversation.toolId,
    }
  }

  function tabForConversation(conversationId: number): number | null {
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
    if (tabId !== null) await dependencies.publishToOwner(tabId, update).catch(() => undefined)
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
    const stored = await dependencies.database.request('getConversation', { id: conversationId })
    if (!stored) {
      throw new DianzhiError({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'The requested conversation was not found.',
        context: { conversationId },
      })
    }
    const normalized = await normalizeStoredSnapshot(stored)
    const live = liveSnapshots.get(normalized.conversation.id)
    if (live) return cloneSnapshot(live)
    const recoveredMessages = await Promise.all(
      normalized.messages.map((message) =>
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
    const snapshot = await snapshotFromStored(
      { ...normalized, messages: recoveredMessages },
      settings
    )
    liveSnapshots.set(snapshot.conversation.id, cloneSnapshot(snapshot))
    return snapshot
  }

  async function loadSelectionSession(selectionSessionId: number): Promise<ConversationSnapshot> {
    const settings = await dependencies.loadSettings()
    const stored = await dependencies.database.request('getSelectionSession', {
      id: selectionSessionId,
    })
    if (!stored) {
      throw new DianzhiError({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'The requested selection session was not found.',
        context: { selectionSessionId },
      })
    }
    const snapshot = await snapshotFromStored(stored, settings)
    liveSnapshots.set(snapshot.conversation.id, cloneSnapshot(snapshot))
    return cloneSnapshot(snapshot)
  }

  async function createSelection(
    input: {
      tabId: number
      replaceSelectionSessionId: number | null
      selectedText: string
      contextText: string
    },
    metadata: { requestId?: string; windowId?: number } = {}
  ): Promise<ConversationSnapshot> {
    const settings = await dependencies.loadSettings()
    const tool =
      settings.tools.find((item) => item.id === settings.ui.defaultToolId && item.enabled) ??
      settings.tools.find((item) => item.enabled)
    if (!tool) throw invalid('No enabled tool is available.')
    if (input.replaceSelectionSessionId !== null)
      await clearSelectionSessionState(input.replaceSelectionSessionId)
    const promptSnapshot = fillTemplate(effectivePrompt(tool), {
      selected: input.selectedText,
      context: input.contextText,
    })
    const createArgs = {
      tabId: input.tabId,
      ...(input.replaceSelectionSessionId !== null
        ? { replaceSelectionSessionId: input.replaceSelectionSessionId }
        : {}),
      tool,
      selectedText: input.selectedText,
      contextText: input.contextText,
      promptSnapshot,
    }
    const stored = await dependencies.database
      .request('createSelectionSession', createArgs)
      .catch((createError: unknown) => {
        console.error('[dianzhi] createSelectionSession failed', {
          operation: 'createSelectionSession',
          requestId: metadata.requestId,
          tabId: input.tabId,
          replaceSelectionSessionId: createArgs.replaceSelectionSessionId ?? null,
          code: createError instanceof DianzhiError ? createError.code : 'DB_UNAVAILABLE',
        })
        throw createError
      })
    const snapshot = await snapshotFromStored(stored, settings)
    liveSnapshots.set(snapshot.conversation.id, cloneSnapshot(snapshot))
    const assistant = await dependencies.database.request('appendAssistant', {
      conversationId: snapshot.conversation.id,
    })
    await startProvider(snapshot, settings, assistant)
    return cloneSnapshot(liveSnapshots.get(snapshot.conversation.id)!)
  }

  async function activateTool(
    selectionSessionId: number,
    toolId: number
  ): Promise<ConversationSnapshot> {
    const settings = await dependencies.loadSettings()
    const current = await loadSelectionSession(selectionSessionId)
    const tool = settings.tools.find((item) => item.id === toolId && item.enabled)
    if (!tool) throw invalid('The requested tool is unavailable.')
    const promptSnapshot = fillTemplate(effectivePrompt(tool), {
      selected: current.conversation.selectedText,
      context: current.conversation.contextText,
    })
    const stored = await dependencies.database.request('ensureToolConversation', {
      selectionSessionId,
      tool,
      promptSnapshot,
    })
    const snapshot = await snapshotFromStored(stored, settings)
    liveSnapshots.set(snapshot.conversation.id, cloneSnapshot(snapshot))
    await publish({ type: 'conversation.toolChanged', snapshot })
    if (snapshot.messages.length === 1) {
      const assistant = await dependencies.database.request('appendAssistant', {
        conversationId: snapshot.conversation.id,
      })
      await startProvider(snapshot, settings, assistant)
    }
    return cloneSnapshot(liveSnapshots.get(snapshot.conversation.id) ?? snapshot)
  }

  async function stopSelectionSession(selectionSessionId: number): Promise<void> {
    const conversationIds = [...liveSnapshots.entries()]
      .filter(([, snapshot]) => snapshot.conversation.selectionSessionId === selectionSessionId)
      .map(([conversationId]) => conversationId)
    const handles = conversationIds
      .map((conversationId) => liveRuns.get(conversationId))
      .filter((handle): handle is ProviderRunHandle => handle !== undefined)
    for (const handle of handles) handle.stop()
    await Promise.all(handles.map((handle) => handle.done.catch(() => undefined)))
  }

  async function clearSelectionSessionState(selectionSessionId: number): Promise<void> {
    await stopSelectionSession(selectionSessionId)
    const conversationIds = [...liveSnapshots.entries()]
      .filter(([, snapshot]) => snapshot.conversation.selectionSessionId === selectionSessionId)
      .map(([conversationId]) => conversationId)
    for (const conversationId of conversationIds) {
      liveSnapshots.delete(conversationId)
      liveRuns.delete(conversationId)
    }
  }

  async function deleteSelectionSession(selectionSessionId: number): Promise<void> {
    await clearSelectionSessionState(selectionSessionId)
    await dependencies.database.request('deleteSelectionSession', { id: selectionSessionId })
  }

  async function handle(
    command: ConversationCommand,
    sender: chrome.runtime.MessageSender,
    source: 'content' | 'extension' = sender.tab?.id ? 'content' : 'extension'
  ): Promise<ConversationCommandResult> {
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
      const conversationId = snapshot.conversation.id
      liveRuns.get(conversationId)?.stop()
      dependencies.providerRunner.stop?.(conversationId)
      return { accepted: true, snapshot }
    }

    if (command.type === 'conversation.followup') {
      const snapshot = await loadSnapshot(command.payload.conversationId, settings)
      if (source === 'content' && snapshot.conversation.tabId !== sender.tab?.id) {
        throw invalid('The conversation does not belong to the sender tab.')
      }
      const conversationId = snapshot.conversation.id
      const previous = liveRuns.get(conversationId)
      if (previous) {
        previous.stop()
        await previous.done.catch(() => undefined)
        const current = liveSnapshots.get(conversationId)
        if (current) snapshot.messages = current.messages.map((message) => ({ ...message }))
      }
      const turn = await dependencies.database.request('appendTurn', {
        conversationId,
        content: command.payload.content,
      })
      snapshot.messages.push({ ...turn.user }, { ...turn.assistant })
      await startProvider(snapshot, settings, turn.assistant)
      return {
        accepted: true,
        snapshot: cloneSnapshot(liveSnapshots.get(conversationId)!),
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
      const conversationId = snapshot.conversation.id
      const assistant = await dependencies.database.request('appendAssistant', {
        conversationId,
      })
      await startProvider(snapshot, settings, assistant)
      return {
        accepted: true,
        snapshot: cloneSnapshot(liveSnapshots.get(conversationId)!),
      }
    }

    return { accepted: true, snapshot: null }
  }

  function getLiveSnapshot(conversationId: number): ConversationSnapshot | null {
    const snapshot = liveSnapshots.get(conversationId)
    return snapshot ? cloneSnapshot(snapshot) : null
  }

  return {
    initialize,
    handle,
    publish,
    getLiveSnapshot,
    createSelection,
    loadSelectionSession,
    activateTool,
    stopSelectionSession,
    deleteSelectionSession,
  }
}

export type ConversationManager = ReturnType<typeof createConversationManager> &
  UiConversationGateway
