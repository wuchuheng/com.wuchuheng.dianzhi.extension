import type { DianzhiErrorShape } from './errors'
import type { DianzhiSettings, ToolDefinition } from './types'

export const CONTENT_PORT_NAME = 'dianzhi:content'
export const SIDEPANEL_PORT_NAME = 'dianzhi:sidepanel'

export type MessageRole = 'user' | 'assistant'
export type MessageStatus = 'pending' | 'streaming' | 'completed' | 'error' | 'stopped'

export interface ConversationRecord {
  id: number
  selectionKey: number
  tabId: number
  toolId: string
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
  conversation: ConversationRecord
  messages: MessageRecord[]
  tools: ToolConversationRef[]
  activeToolId: string
}

export type ConversationCommand =
  | {
      type: 'conversation.create'
      requestId: string
      payload: { selectedText: string; contextText: string }
    }
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
      type: 'conversation.ensureTool'
      requestId: string
      payload: { selectionKey: number; toolId: string }
    }
  | {
      type: 'stream.stop'
      requestId: string
      payload: { conversationId: number }
    }
  | {
      type: 'panel.open'
      requestId: string
      payload: { conversationId: number }
    }
  | {
      type: 'panel.rendered'
      requestId: string
      payload: { conversationId: number }
    }
  | {
      type: 'panel.close'
      requestId: string
      payload: { conversationId: number }
    }

export interface ConversationCommandResult {
  accepted: true
  snapshot: ConversationSnapshot | null
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
  | { type: 'panel.handoffReady'; conversationId: number }

export type SettingsCommand =
  | { type: 'settings.get'; requestId: string }
  | { type: 'settings.save'; requestId: string; settings: DianzhiSettings }
  | { type: 'settings.testProvider'; requestId: string; settings: DianzhiSettings }

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: DianzhiErrorShape }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
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
    case 'conversation.create':
      if (
        typeof payload.selectedText !== 'string' ||
        payload.selectedText.trim().length < 1 ||
        payload.selectedText.trim().length > 300 ||
        typeof payload.contextText !== 'string' ||
        !payload.contextText.trim()
      ) {
        return invalid('Selection command content is invalid.')
      }
      return {
        ok: true,
        value: {
          type: value.type,
          requestId,
          payload: { selectedText: payload.selectedText, contextText: payload.contextText },
        },
      }
    case 'conversation.sync':
    case 'stream.stop':
    case 'panel.open':
    case 'panel.rendered':
    case 'panel.close':
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
    case 'conversation.ensureTool':
      if (!isPositiveInteger(payload.selectionKey) || typeof payload.toolId !== 'string') {
        return invalid('Tool conversation payload is invalid.')
      }
      if (!payload.toolId.trim()) return invalid('Tool ID is empty.')
      return {
        ok: true,
        value: {
          type: value.type,
          requestId,
          payload: { selectionKey: payload.selectionKey, toolId: payload.toolId },
        },
      }
    default:
      return invalid('Conversation command type is invalid.')
  }
}
