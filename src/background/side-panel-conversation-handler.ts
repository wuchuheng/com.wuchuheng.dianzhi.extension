import { DianzhiError } from '@/dianzhi/domain/errors'
import {
  parseSidePanelConversationRequest,
  type ConversationCommand,
  type ConversationCommandResult,
} from '@/dianzhi/domain/protocol'
import type { SidePanelSessionRegistry } from './side-panel-session-registry'

interface ConversationCommandManager {
  handle(
    command: ConversationCommand,
    sender: chrome.runtime.MessageSender,
    source: 'extension',
    authorizedTabId: number
  ): Promise<ConversationCommandResult>
}

export function createSidePanelConversationHandler(input: {
  runtimeReady: Promise<void>
  panelSessions: Pick<SidePanelSessionRegistry, 'waitUntilReady'>
  manager: ConversationCommandManager
}) {
  return async (value: unknown, sender: chrome.runtime.MessageSender) => {
    const parsed = parseSidePanelConversationRequest(value)
    if (!parsed.ok) throw new DianzhiError(parsed.error)
    await input.runtimeReady
    const session = await input.panelSessions.waitUntilReady(parsed.value.panelSessionId)
    return input.manager.handle(parsed.value.command, sender, 'extension', session.tabId)
  }
}
