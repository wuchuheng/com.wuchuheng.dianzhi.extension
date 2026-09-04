import type { DianzhiErrorShape } from './errors'
import type { DianzhiSettings, ProviderSettings, SettingsRowData, ToolDefinition } from './types'

export const CONTENT_PORT_NAME = 'dianzhi:content'
export const SIDEPANEL_PORT_NAME = 'dianzhi:sidepanel'
export const OPTIONS_TOOL_TEST_PORT_NAME = 'dianzhi:options-tool-test'

export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'error' | 'stopped'

/** Persistent aggregate root for all tool conversations from one selection. */
export interface SelectionSessionRecord {
  id: number
  activeConversationId: number
  createdAt: string
  updatedAt: string
}

export interface ConversationRecord {
  id: number
  selectionSessionId: number
  tabId: number
  toolId: number
  toolName: string
  title: string
  selectedText: string
  contextText: string
  promptSnapshot: string
  createdAt: string
  updatedAt: string
}

export interface MessageRecord {
  id: number
  conversationId: number
  sequence: number
  role: MessageRole
  content: string
  reasoningContent: string
  estimatedThroughputTps: number | null
  status: MessageStatus
  errorCode: string | null
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

export interface ToolConversationRef {
  tool: ToolDefinition
  conversationId: number | null
}

export interface ConversationSnapshot {
  selectionSession: SelectionSessionRecord
  conversation: ConversationRecord
  messages: MessageRecord[]
  tools: ToolConversationRef[]
  activeToolId: number
}

export type ConversationCommand =
  | {
      type: 'conversation.sync'
      requestId: string
      payload: { conversationId: number }
    }
  | {
      type: 'conversation.followup'
      requestId: string
      payload: { conversationId: number; content: string }
    }
  | {
      type: 'conversation.retry'
      requestId: string
      payload: { conversationId: number }
    }
  | {
      type: 'stream.stop'
      requestId: string
      payload: { conversationId: number }
    }

export interface ConversationCommandResult {
  accepted: true
  snapshot: ConversationSnapshot | null
}

export interface SidePanelConversationRequest {
  panelSessionId: string
  command: ConversationCommand
}

export type ConversationUpdate =
  | { type: 'conversation.sync'; snapshot: ConversationSnapshot }
  | { type: 'conversation.toolChanged'; snapshot: ConversationSnapshot }
  | { type: 'stream.started'; conversationId: number; message: MessageRecord }
  | {
      type: 'stream.delta' | 'stream.reasoning'
      conversationId: number
      messageId: number
      content: string
    }
  | {
      type: 'stream.done' | 'stream.stopped'
      conversationId: number
      message: MessageRecord
    }
  | {
      type: 'stream.error'
      conversationId: number
      message: MessageRecord
      error: DianzhiErrorShape
    }

export type SettingsCommand =
  | { type: 'settings.get'; requestId: string }
  | { type: 'settings.save'; requestId: string; settings: SettingsRowData }
  | { type: 'settings.testProvider'; requestId: string; settings: DianzhiSettings }

export type ToolUpdatePatch = {
  name?: string
  prompt?: string
  enabled?: boolean
  isDefault?: boolean
}

export type ToolsCommand =
  | { type: 'tools.list'; requestId: string; payload: { includeRemoved?: boolean } }
  | { type: 'tools.ensurePresets'; requestId: string; payload: Record<string, never> }
  | { type: 'tools.create'; requestId: string; payload: { name: string; prompt: string } }
  | {
      type: 'tools.update'
      requestId: string
      payload: { id: number; patch: ToolUpdatePatch }
    }
  | { type: 'tools.reorder'; requestId: string; payload: { orderedIds: number[] } }
  | { type: 'tools.softRemove'; requestId: string; payload: { id: number } }
  | { type: 'tools.restore'; requestId: string; payload: { id: number } }
  | { type: 'tools.delete'; requestId: string; payload: { id: number } }

export type ToolTestCommand =
  | {
      type: 'tool.test'
      requestId: string
      payload: { prompt: string; provider: ProviderSettings }
    }
  | { type: 'tool.test.stop'; requestId: string; payload: Record<string, never> }

export type ToolTestUpdate =
  | { type: 'test.validating'; requestId: string }
  | { type: 'test.started'; requestId: string }
  | { type: 'test.delta'; requestId: string; kind: 'content' | 'reasoning'; delta: string }
  | {
      type: 'test.done'
      requestId: string
      content: string
      reasoningContent: string
      firstTokenMs: number | null
      totalMs: number
    }
  | {
      type: 'test.stopped'
      requestId: string
      content: string
      reasoningContent: string
      firstTokenMs: number | null
      totalMs: number
    }
  | { type: 'test.error'; requestId: string; error: DianzhiErrorShape }

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: DianzhiErrorShape }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isProviderSettings(value: unknown): value is ProviderSettings {
  if (!isRecord(value)) return false
  const { baseUrl, apiKey, model, temperature, reasoningEnabled, reasoningEffort, extraBody } =
    value
  return (
    typeof baseUrl === 'string' &&
    typeof apiKey === 'string' &&
    typeof model === 'string' &&
    typeof temperature === 'number' &&
    Number.isFinite(temperature) &&
    typeof reasoningEnabled === 'boolean' &&
    (reasoningEffort === 'auto' ||
      reasoningEffort === 'low' ||
      reasoningEffort === 'medium' ||
      reasoningEffort === 'high') &&
    typeof extraBody === 'string'
  )
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function invalid(message: string): ParseResult<never> {
  return { ok: false, error: { code: 'INVALID_EVENT', message } }
}

function hasCallerTabId(payload: Record<string, unknown>): boolean {
  return Object.prototype.hasOwnProperty.call(payload, 'tabId')
}

/**
 * Parses an untrusted content or extension-page conversation command.
 * @param value - Runtime message payload received across a Chrome context boundary.
 * @returns A typed command or a stable validation failure.
 */
export function parseConversationCommand(value: unknown): ParseResult<ConversationCommand> {
  if (!isRecord(value) || !isRequestId(value.requestId) || typeof value.type !== 'string') {
    return invalid('Conversation command envelope is invalid.')
  }
  if (!isRecord(value.payload) || hasCallerTabId(value.payload)) {
    return invalid('Conversation command payload is invalid.')
  }

  const requestId = value.requestId
  const payload = value.payload
  switch (value.type) {
    case 'conversation.sync':
    case 'conversation.retry':
    case 'stream.stop':
      if (!isPositiveInteger(payload.conversationId)) return invalid('Conversation ID is invalid.')
      return {
        ok: true,
        value: { type: value.type, requestId, payload: { conversationId: payload.conversationId } },
      }
    case 'conversation.followup':
      if (!isPositiveInteger(payload.conversationId) || typeof payload.content !== 'string') {
        return invalid('Follow-up payload is invalid.')
      }
      if (!payload.content.trim()) return invalid('Follow-up content is empty.')
      return {
        ok: true,
        value: {
          type: value.type,
          requestId,
          payload: { conversationId: payload.conversationId, content: payload.content },
        },
      }
    default:
      return invalid('Conversation command type is invalid.')
  }
}

/** Parses a Side Panel command together with its live logical-session capability. */
export function parseSidePanelConversationRequest(
  value: unknown
): ParseResult<SidePanelConversationRequest> {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => key !== 'panelSessionId' && key !== 'command') ||
    typeof value.panelSessionId !== 'string' ||
    !value.panelSessionId.trim()
  ) {
    return invalid('Side Panel conversation request is invalid.')
  }
  const command = parseConversationCommand(value.command)
  if (!command.ok) return command
  return {
    ok: true,
    value: { panelSessionId: value.panelSessionId, command: command.value },
  }
}

/**
 * Parses an untrusted Options-page tools command.
 * @param value - Runtime message payload received across a Chrome context boundary.
 * @returns A typed tools command or a stable validation failure.
 */
export function parseToolsCommand(value: unknown): ParseResult<ToolsCommand> {
  if (!isRecord(value) || !isRequestId(value.requestId) || typeof value.type !== 'string') {
    return invalid('Tools command envelope is invalid.')
  }
  if (!isRecord(value.payload) || hasCallerTabId(value.payload)) {
    return invalid('Tools command payload is invalid.')
  }
  const requestId = value.requestId
  const payload = value.payload
  const TOOL_PATCH_KEYS = ['name', 'prompt', 'enabled', 'isDefault'] as const
  switch (value.type) {
    case 'tools.list':
      if (payload.includeRemoved !== undefined && typeof payload.includeRemoved !== 'boolean') {
        return invalid('Tools list payload is invalid.')
      }
      return {
        ok: true,
        value: {
          type: value.type,
          requestId,
          payload:
            payload.includeRemoved === undefined ? {} : { includeRemoved: payload.includeRemoved },
        },
      }
    case 'tools.ensurePresets':
      if (Object.keys(payload).length > 0)
        return invalid('Tools ensurePresets payload must be empty.')
      return { ok: true, value: { type: value.type, requestId, payload: {} } }
    case 'tools.create':
      if (
        typeof payload.name !== 'string' ||
        !payload.name.trim() ||
        typeof payload.prompt !== 'string' ||
        !payload.prompt.trim()
      ) {
        return invalid('Tools create payload is invalid.')
      }
      return {
        ok: true,
        value: {
          type: value.type,
          requestId,
          payload: { name: payload.name, prompt: payload.prompt },
        },
      }
    case 'tools.update': {
      if (!isPositiveInteger(payload.id) || !isRecord(payload.patch)) {
        return invalid('Tools update payload is invalid.')
      }
      const patchKeys = Object.keys(payload.patch)
      if (
        patchKeys.length === 0 ||
        patchKeys.some((key) => !TOOL_PATCH_KEYS.includes(key as (typeof TOOL_PATCH_KEYS)[number]))
      ) {
        return invalid('Tools update patch is invalid.')
      }
      const patch: ToolUpdatePatch = {}
      if (typeof payload.patch.name === 'string') patch.name = payload.patch.name
      if (typeof payload.patch.prompt === 'string') patch.prompt = payload.patch.prompt
      if (typeof payload.patch.enabled === 'boolean') patch.enabled = payload.patch.enabled
      if (typeof payload.patch.isDefault === 'boolean') patch.isDefault = payload.patch.isDefault
      return {
        ok: true,
        value: { type: value.type, requestId, payload: { id: payload.id, patch } },
      }
    }
    case 'tools.reorder':
      if (
        !Array.isArray(payload.orderedIds) ||
        payload.orderedIds.length === 0 ||
        !payload.orderedIds.every(isPositiveInteger)
      ) {
        return invalid('Tools reorder payload is invalid.')
      }
      return {
        ok: true,
        value: {
          type: value.type,
          requestId,
          payload: { orderedIds: [...payload.orderedIds] },
        },
      }
    case 'tools.softRemove':
    case 'tools.restore':
    case 'tools.delete':
      if (!isPositiveInteger(payload.id)) return invalid('Tools id payload is invalid.')
      return { ok: true, value: { type: value.type, requestId, payload: { id: payload.id } } }
    default:
      return invalid('Tools command type is invalid.')
  }
}

/**
 * Parses an untrusted Options-page tool-test command received over the test port.
 * @param value - Runtime message payload received across a Chrome context boundary.
 * @returns A typed tool-test command or a stable validation failure.
 */
export function parseOptionsTestCommand(value: unknown): ParseResult<ToolTestCommand> {
  if (!isRecord(value) || !isRequestId(value.requestId) || typeof value.type !== 'string') {
    return invalid('Tool-test command envelope is invalid.')
  }
  if (!isRecord(value.payload) || hasCallerTabId(value.payload)) {
    return invalid('Tool-test command payload is invalid.')
  }
  const requestId = value.requestId
  const payload = value.payload
  if (value.type === 'tool.test') {
    if (typeof payload.prompt !== 'string' || !payload.prompt.trim()) {
      return invalid('Tool-test prompt is empty.')
    }
    if (!isProviderSettings(payload.provider)) {
      return invalid('Tool-test provider payload is invalid.')
    }
    return {
      ok: true,
      value: {
        type: value.type,
        requestId,
        payload: { prompt: payload.prompt, provider: payload.provider },
      },
    }
  }
  if (value.type === 'tool.test.stop') {
    if (Object.keys(payload).length > 0) return invalid('Tool-test stop payload must be empty.')
    return { ok: true, value: { type: value.type, requestId, payload: {} } }
  }
  return invalid('Tool-test command type is invalid.')
}
