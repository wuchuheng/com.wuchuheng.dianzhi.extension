import { createConversationManager, type ConversationManager } from './conversation-manager'
import { createOffscreenClient } from './offscreen-client'
import { createOptionsToolTestRunner } from './options-test-runner'
import { createProviderRunner } from './provider-runner'
import { DianzhiError } from '@/dianzhi/domain/errors'
import { mergeSettings, validateSettings } from '@/dianzhi/domain/settings'
import { parseConversationCommand, type SettingsCommand } from '@/dianzhi/domain/protocol'
import { streamChat } from '@/dianzhi/provider/client'
import {
  contentConversationCommand,
  contentSettingsCommand,
  conversationUpdateToContent,
  extensionConversationCommand,
  settingsCommand,
} from '@/events/config'
import { relayService } from '@/events/background/background'
import { log, logError, Scope } from '@/events/logger'

const SETTINGS_KEY = 'dianzhi.settings'
const SESSION_KEY = 'dianzhi.tab-conversations'
const nativeSidePanel = chrome.sidePanel as typeof chrome.sidePanel & {
  close(options: { tabId: number }): Promise<void>
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

async function loadSettings() {
  const stored = await chrome.storage.sync.get(SETTINGS_KEY)
  return mergeSettings(stored[SETTINGS_KEY])
}

const database = createOffscreenClient(chrome)
const managerRef: { current?: ConversationManager } = {}
const providerRunner = createProviderRunner({
  checkpoint: (messageId, content, reasoningContent) =>
    database.request('checkpointAssistant', { messageId, content, reasoningContent }),
  finalize: (messageId, input) => database.request('finalizeAssistant', { messageId, input }),
  publish: (update) => {
    if (!managerRef.current) throw new Error('Conversation manager is not initialized.')
    return managerRef.current.publish(update)
  },
})

const manager = createConversationManager({
  database,
  loadSettings,
  providerRunner,
  sendToContent: async (tabId, update) => {
    await conversationUpdateToContent.dispatch([update, tabId])
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
    close: async (tabId) => nativeSidePanel.close({ tabId }),
  },
})
managerRef.current = manager
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

contentConversationCommand.handleWithSender((value, sender) =>
  handleConversationCommand(value, sender, 'content')
)
extensionConversationCommand.handleWithSender((value, sender) =>
  handleConversationCommand(value, sender, 'extension')
)
settingsCommand.handle(async (value) => {
  const command = parseSettingsCommand(value)
  if (command.type === 'settings.get') return loadSettings()
  const settings = mergeSettings(command.settings)
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
  if (command.type === 'settings.save') await chrome.storage.sync.set({ [SETTINGS_KEY]: settings })
  return settings
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
void manager.initialize().then(
  () => log(Scope.BACKGROUND, 'Dianzhi conversation manager is ready'),
  (error: unknown) => logError(Scope.BACKGROUND, 'Failed to restore Dianzhi session state', error)
)
