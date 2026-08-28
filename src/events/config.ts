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
import type {
  ContentUiCommand,
  PanelToggleRequest,
  PanelToggleResult,
  SelectionRouteRequest,
  SelectionRouteResult,
  SidePanelCommand,
  SurfaceStatusRequest,
  SurfaceStatusResponse,
  ToolShortcutResult,
  ToolShortcutRequest,
} from '@/dianzhi/domain/ui-session-protocol'
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

export const contentSurfaceStatus = events.cs2bg<SurfaceStatusRequest, SurfaceStatusResponse>(
  'dianzhi:ui-surface-status'
)

export const panelSurfaceStatus = events.ep2bg<SurfaceStatusRequest, SurfaceStatusResponse>(
  'dianzhi:ui-surface-status'
)

export const selectionRoute = events.cs2bg<SelectionRouteRequest, SelectionRouteResult>(
  'dianzhi:selection-route'
)

export const contentPanelToggle = events.cs2bg<PanelToggleRequest, PanelToggleResult>(
  'dianzhi:shortcut-panel-toggle'
)

export const panelPanelToggle = events.ep2bg<PanelToggleRequest, PanelToggleResult>(
  'dianzhi:shortcut-panel-toggle'
)

export const contentToolShortcut = events.cs2bg<ToolShortcutRequest, ToolShortcutResult>(
  'dianzhi:shortcut-tool'
)

export const panelToolShortcut = events.ep2bg<ToolShortcutRequest, ToolShortcutResult>(
  'dianzhi:shortcut-tool'
)

export const contentUiCommand = events.bg2cs<ContentUiCommand, void>('dianzhi:content-ui-command')

export const sidePanelCommand = events.bg2sp<SidePanelCommand, true>('dianzhi:side-panel-command')

export const sidePanelConversationUpdate = events.bg2sp<ConversationUpdate, true>(
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
