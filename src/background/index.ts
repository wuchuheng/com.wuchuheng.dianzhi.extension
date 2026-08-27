import { createConversationManager, type ConversationManager } from './conversation-manager'
import { createMigrationCoordinator } from './migration-coordinator'
import { createOffscreenClient, type OffscreenClient } from './offscreen-client'
import { createOptionsToolTestRunner } from './options-test-runner'
import { createProviderRunner } from './provider-runner'
import { createSettingsLoader } from './settings-loader'
import { DianzhiError } from '@/dianzhi/domain/errors'
import {
  composeSettings,
  DEFAULT_TOOLS,
  mergeSettings,
  rowDataFromSettings,
  validateSettings,
} from '@/dianzhi/domain/settings'
import {
  parseConversationCommand,
  parseToolsCommand,
  type SettingsCommand,
  type ToolsCommand,
} from '@/dianzhi/domain/protocol'
import { streamChat } from '@/dianzhi/provider/client'
import type { ToolRecord } from '@/offscreen/database/config-store'
import {
  contentConversationCommand,
  contentCycleToolShortcut,
  contentPanelToggle,
  contentSelectToolShortcut,
  contentSettingsCommand,
  contentSurfaceStatus,
  contentUiCommand,
  conversationUpdateToContent,
  extensionConversationCommand,
  panelCycleToolShortcut,
  panelPanelToggle,
  panelSelectToolShortcut,
  panelSurfaceStatus,
  selectionRoute,
  settingsCommand,
  sidePanelCommand,
  sidePanelConversationUpdate,
  toolsCommand,
} from '@/events/config'
import { relayService } from '@/events/background/background'
import { log, logError, Scope } from '@/events/logger'
import { createUiSessionCoordinator, type TabSessionState } from './ui-session-coordinator'
import {
  createUiSessionEventHandlers,
  publishToOwnerWithFallback,
  reconcileUiSessionState,
  registerUiSessionRuntime,
  type UiSessionCoordinator,
} from './ui-session-runtime'

const SETTINGS_KEY = 'dianzhi.settings'
const SESSION_KEY = 'dianzhi.tab-conversations'
const UI_SESSION_KEY = 'dianzhi.ui-tab-sessions'
const nativeSidePanel = chrome.sidePanel as typeof chrome.sidePanel & {
  close(options: { windowId: number }): Promise<void>
}

function parseSettingsCommand(value: unknown): SettingsCommand {
  if (
    typeof value !== 'object' ||
    value === null ||
    typeof (value as { type?: unknown }).type !== 'string'
  ) {
    throw new DianzhiError({ code: 'INVALID_EVENT', message: 'The settings command is invalid.' })
  }
  const command = value as Partial<SettingsCommand>
  if (typeof command.requestId !== 'string' || !command.requestId.trim()) {
    throw new DianzhiError({
      code: 'INVALID_EVENT',
      message: 'The settings request ID is invalid.',
    })
  }
  if (!['settings.get', 'settings.save', 'settings.testProvider'].includes(command.type ?? '')) {
    throw new DianzhiError({ code: 'INVALID_EVENT', message: 'The settings operation is invalid.' })
  }
  if (command.type !== 'settings.get' && !('settings' in command)) {
    throw new DianzhiError({ code: 'INVALID_EVENT', message: 'The settings payload is missing.' })
  }
  return command as SettingsCommand
}

const database = createOffscreenClient(chrome)

const migrationCoordinator = createMigrationCoordinator({
  getSettings: () => database.request('getSettings', {}),
  listTools: (includeRemoved) => database.request('listTools', { includeRemoved }),
  ensurePresets: () => database.request('ensurePresets', {}),
  migrateLegacy: (input) => database.request('migrateLegacy', input),
  readLegacySettings: async () => {
    const stored = await chrome.storage.sync.get(SETTINGS_KEY)
    return stored[SETTINGS_KEY]
  },
  clearLegacySettings: async () => {
    await chrome.storage.sync.remove(SETTINGS_KEY)
  },
})

const loadSettings = createSettingsLoader({
  ensureMigrated: () => migrationCoordinator.ensureMigrated(),
  getSettings: () => database.request('getSettings', {}),
  listTools: (includeRemoved) => database.request('listTools', { includeRemoved }),
})
const managerRef: { current?: ConversationManager } = {}
const coordinatorRef: { current?: UiSessionCoordinator } = {}
const providerRunner = createProviderRunner({
  checkpoint: (messageId, content, reasoningContent) =>
    database.request('checkpointAssistant', { messageId, content, reasoningContent }),
  finalize: (messageId, input) => database.request('finalizeAssistant', { messageId, input }),
  publish: (update) => {
    if (!managerRef.current) throw new Error('Conversation manager is not initialized.')
    return managerRef.current.publish(update)
  },
})

function normalizeTabForCoordinator(tab: chrome.tabs.Tab): {
  id: number
  windowId: number
  url?: string
} {
  return { id: tab.id ?? -1, windowId: tab.windowId ?? -1, url: tab.url }
}

const manager = createConversationManager({
  database,
  loadSettings,
  providerRunner,
  publishToOwner: async (tabId, update) => {
    await publishToOwnerWithFallback({
      coordinator: coordinatorRef.current,
      tabId,
      update,
      deliverToContent: async (targetTabId, streamUpdate) => {
        await conversationUpdateToContent.dispatch([streamUpdate, targetTabId])
      },
    })
  },
  session: {
    load: async () => {
      const stored = await chrome.storage.session.get(SESSION_KEY)
      const value = stored[SESSION_KEY]
      return typeof value === 'object' && value !== null ? (value as Record<string, never>) : {}
    },
    save: async (state) => {
      await chrome.storage.session.set({ [SESSION_KEY]: state })
    },
  },
  sidePanel: {
    open: async (tabId) => chrome.sidePanel.open({ tabId }),
    close: async (windowId) => nativeSidePanel.close({ windowId }),
  },
})
managerRef.current = manager

const uiSessionStore = {
  load: async (): Promise<Record<string, TabSessionState>> => {
    const stored = await chrome.storage.session.get(UI_SESSION_KEY)
    const value = stored[UI_SESSION_KEY]
    return typeof value === 'object' && value !== null
      ? (value as Record<string, TabSessionState>)
      : {}
  },
  save: async (state: Record<string, TabSessionState>): Promise<void> => {
    await chrome.storage.session.set({ [UI_SESSION_KEY]: state })
  },
}

const coordinator = createUiSessionCoordinator({
  conversations: manager,
  loadSettings,
  sessionStore: uiSessionStore,
  tabs: {
    get: async (tabId) => normalizeTabForCoordinator(await chrome.tabs.get(tabId)),
    query: async (windowId) =>
      (await chrome.tabs.query({ windowId })).map(normalizeTabForCoordinator),
  },
  content: {
    destroy: async (tabId) => {
      await contentUiCommand.dispatch([{ type: 'destroy' }, tabId])
    },
    publish: async (tabId, update) => {
      await conversationUpdateToContent.dispatch([update, tabId])
    },
  },
  sidePanel: {
    open: async (tabId) => chrome.sidePanel.open({ tabId }),
    close: async (windowId) => nativeSidePanel.close({ windowId }),
    command: async (windowId, command) => sidePanelCommand.dispatch(command, windowId),
    publish: async (windowId, update) => {
      await sidePanelConversationUpdate.dispatch(update, windowId)
    },
  },
})
coordinatorRef.current = coordinator

registerUiSessionRuntime({
  chromeApi: chrome,
  coordinator,
  sidePanelCommand,
  sidePanelConversationUpdate,
})
const uiSessionHandlers = createUiSessionEventHandlers({ chromeApi: chrome, coordinator })
contentSurfaceStatus.handleWithSender(uiSessionHandlers.onContentSurfaceStatus)
selectionRoute.handleWithSender(uiSessionHandlers.onSelectionRoute)
contentPanelToggle.handleWithSender(uiSessionHandlers.onContentPanelToggle)
contentSelectToolShortcut.handleWithSender(uiSessionHandlers.onContentSelectToolShortcut)
contentCycleToolShortcut.handleWithSender(uiSessionHandlers.onContentCycleToolShortcut)
panelSurfaceStatus.handleWithSender(uiSessionHandlers.onPanelSurfaceStatus)
panelPanelToggle.handleWithSender(uiSessionHandlers.onPanelPanelToggle)
panelSelectToolShortcut.handleWithSender(uiSessionHandlers.onPanelSelectToolShortcut)
panelCycleToolShortcut.handleWithSender(uiSessionHandlers.onPanelCycleToolShortcut)
const optionsTestRunner = createOptionsToolTestRunner()

function handleConversationCommand(
  value: unknown,
  sender: chrome.runtime.MessageSender,
  source: 'content' | 'extension'
) {
  const parsed = parseConversationCommand(value)
  if (!parsed.ok) throw new DianzhiError(parsed.error)
  return manager.handle(parsed.value, sender, source)
}

function logCommandFailure(source: 'content' | 'extension', error: unknown): void {
  console.error(`[dianzhi] conversation command failed (${source}):`, error)
}

contentConversationCommand.handleWithSender((value, sender) => {
  const run = handleConversationCommand(value, sender, 'content')
  void run.catch((error: unknown) => logCommandFailure('content', error))
  return run
})
extensionConversationCommand.handleWithSender((value, sender) => {
  const run = handleConversationCommand(value, sender, 'extension')
  void run.catch((error: unknown) => logCommandFailure('extension', error))
  return run
})
settingsCommand.handle(async (value) => {
  const command = parseSettingsCommand(value)
  if (command.type === 'settings.get') return loadSettings()
  const row = mergeSettings(command.settings)
  const tools = command.type === 'settings.save' ? DEFAULT_TOOLS : command.settings.tools
  const settings = composeSettings(row, tools)
  const validation = validateSettings(settings)
  if (!validation.ok) {
    throw new DianzhiError({
      code: 'SETTINGS_INVALID',
      message: validation.errors[0]?.message ?? 'The settings are invalid.',
      context: { field: validation.errors[0]?.path ?? 'settings' },
    })
  }
  if (command.type === 'settings.testProvider') {
    if (!settings.provider.apiKey.trim()) {
      throw new DianzhiError({
        code: 'PROVIDER_NOT_CONFIGURED',
        message: 'API key is required before testing the provider.',
      })
    }
    await streamChat(
      {
        provider: settings.provider,
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        signal: new AbortController().signal,
      },
      {
        fetch: (request, init) => globalThis.fetch(request, init),
        onDelta: () => undefined,
        onDone: () => undefined,
      }
    )
  }
  if (command.type === 'settings.save') {
    await migrationCoordinator.ensureMigrated()
    await database.request('saveSettings', { data: JSON.stringify(rowDataFromSettings(settings)) })
    return loadSettings()
  }
  return settings
})

function dispatchToolsCommand(command: ToolsCommand, db: OffscreenClient): Promise<ToolRecord[]> {
  switch (command.type) {
    case 'tools.list':
      return db.request('listTools', { includeRemoved: command.payload.includeRemoved })
    case 'tools.ensurePresets':
      return db
        .request('ensurePresets', {})
        .then(() => db.request('listTools', { includeRemoved: true }))
    case 'tools.create':
      return db
        .request('createTool', { name: command.payload.name, prompt: command.payload.prompt })
        .then(() => db.request('listTools', { includeRemoved: true }))
    case 'tools.update':
      return db
        .request('updateTool', { id: command.payload.id, patch: command.payload.patch })
        .then(() => db.request('listTools', { includeRemoved: true }))
    case 'tools.reorder':
      return db
        .request('reorderTools', { orderedIds: command.payload.orderedIds })
        .then(() => db.request('listTools', { includeRemoved: true }))
    case 'tools.softRemove':
      return db
        .request('softRemoveTool', { id: command.payload.id })
        .then(() => db.request('listTools', { includeRemoved: true }))
    case 'tools.restore':
      return db
        .request('restoreTool', { id: command.payload.id })
        .then(() => db.request('listTools', { includeRemoved: true }))
    case 'tools.delete':
      return db
        .request('deleteTool', { id: command.payload.id })
        .then(() => db.request('listTools', { includeRemoved: true }))
  }
}

toolsCommand.handle(async (value) => {
  const parsed = parseToolsCommand(value)
  if (!parsed.ok) throw new DianzhiError(parsed.error)
  await migrationCoordinator.ensureMigrated()
  return dispatchToolsCommand(parsed.value, database)
})
contentSettingsCommand.handle(async (value) => {
  const command = parseSettingsCommand(value)
  if (command.type !== 'settings.get') {
    throw new DianzhiError({
      code: 'INVALID_EVENT',
      message: 'Content scripts may only read settings.',
    })
  }
  return loadSettings()
})

chrome.runtime.onConnect.addListener((port) => manager.connect(port))
chrome.runtime.onConnect.addListener((port) => optionsTestRunner.connect(port))
relayService()
void (async () => {
  try {
    await reconcileUiSessionState({
      sessionStore: uiSessionStore,
      getTab: async (tabId) => normalizeTabForCoordinator(await chrome.tabs.get(tabId)),
      deleteSelectionSession: (selectionSessionId) =>
        database.request('deleteSelectionSession', { id: selectionSessionId }),
    })
  } catch (error) {
    logError(Scope.BACKGROUND, 'Failed to reconcile Dianzhi UI tab sessions', error)
  }
  await coordinator.initialize()
  await manager.initialize()
  log(Scope.BACKGROUND, 'Dianzhi UI session runtime is ready')
})().catch((error: unknown) => {
  logError(Scope.BACKGROUND, 'Failed to restore Dianzhi session state', error)
})
