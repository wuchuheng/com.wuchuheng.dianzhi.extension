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
} from '@/dianzhi/domain/protocol'
import type { DianzhiSettings } from '@/dianzhi/domain/types'
import type { DatabaseRequest, DatabaseResult } from '@/offscreen/database/rpc'

// ============================================================================
// Configuration
// ============================================================================

/**
 * Test mode flag.
 *
 * When true, enables test event handlers and verbose logging.
 * Set via environment variable or build flag.
 *
 * @example
 * ```ts
 * import { isTest } from '@/events/config'
 *
 * if (isTest) {
 *   setupTestHandlers()
 * }
 * ```
 */
export const isTest = true

// ============================================================================
// Application Events
// ============================================================================

/**
 * Offscreen to content script communication event.
 *
 * Environment detection happens at CALL time, not module init time.
 * - **Content scripts**: Use `.handle()` to receive messages
 * - **Offscreen/Extension pages**: Use `.dispatch()` to send messages
 *
 * @example
 * ```ts
 * // In content script (src/content/main.tsx):
 * import { sayHelloFromOffToCS } from '@/events/config'
 *
 * sayHelloFromOffToCS.handle(async (message) => {
 *   console.log('[Content Script] Received:', message)
 * })
 * ```
 *
 * @example
 * ```ts
 * // In offscreen document (src/offscreen/main.ts):
 * import { sayHelloFromOffToCS } from '@/events/config'
 *
 * await sayHelloFromOffToCS.dispatch('Hello from offscreen!')
 * ```
 */
export const sayHelloFromOffToCS = events.ep2cs<string, void>('sayHelloFromOfscreenToContentScript')

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

export const databaseRequest = events.bg2ep<DatabaseRequest, DatabaseResult>(
  'dianzhi:database-request'
)

export const databaseReady = events.bg2ep<void, true>('dianzhi:database-ready')
