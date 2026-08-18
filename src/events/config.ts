/**
 * Configuration for the event system.
 *
 * Centralizes event definitions with runtime environment detection.
 * Events defined here work seamlessly across all extension contexts.
 */

import * as events from './index'
import type {
  ConversationCommand,
  ConversationCommandResult,
  ConversationUpdate,
  SettingsCommand,
  ToolsCommand,
} from '@/dianzhi/domain/protocol'
import type { DianzhiSettings } from '@/dianzhi/domain/types'
import type { DatabaseRequest, DatabaseResult } from '@/offscreen/database/rpc'
import type { ToolRecord } from '@/offscreen/database/config-store'

// ============================================================================
// Application Events
// ============================================================================

export const contentConversationCommand = events.cs2bg<
  ConversationCommand,
  ConversationCommandResult
>('dianzhi:conversation-command')

export const extensionConversationCommand = events.ep2bg<
  ConversationCommand,
  ConversationCommandResult
>('dianzhi:conversation-command')

export const conversationUpdateToContent = events.bg2cs<ConversationUpdate, void>(
  'dianzhi:conversation-update'
)

export const conversationUpdateToExtension = events.bg2ep<ConversationUpdate, void>(
  'dianzhi:conversation-update'
)

export const settingsCommand = events.ep2bg<SettingsCommand, DianzhiSettings>(
  'dianzhi:settings-command'
)

export const toolsCommand = events.ep2bg<ToolsCommand, ToolRecord[]>('dianzhi:tools-command')

export const contentSettingsCommand = events.cs2bg<SettingsCommand, DianzhiSettings>(
  'dianzhi:settings-command'
)

export const databaseRequest = events.bg2ep<DatabaseRequest, DatabaseResult>(
  'dianzhi:database-request'
)

export const databaseReady = events.bg2ep<void, true>('dianzhi:database-ready')
