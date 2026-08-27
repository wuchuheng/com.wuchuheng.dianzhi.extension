import { DianzhiError } from '@/dianzhi/domain/errors'
import type { ToolDefinition } from '@/dianzhi/domain/types'
import type { ConfigStore, LegacySettingsDocument } from './config-store'
import type {
  ConversationStore,
  CreateSelectionSessionInput,
  EnsureToolConversationInput,
  FinalizeAssistantInput,
} from './store'

export interface DatabaseOperationMap {
  createSelectionSession: {
    args: CreateSelectionSessionInput
    result: Awaited<ReturnType<ConversationStore['createSelectionSession']>>
  }
  getSelectionSession: {
    args: { id: number }
    result: Awaited<ReturnType<ConversationStore['getSelectionSession']>>
  }
  ensureToolConversation: {
    args: EnsureToolConversationInput
    result: Awaited<ReturnType<ConversationStore['ensureToolConversation']>>
  }
  getConversation: {
    args: { id: number }
    result: Awaited<ReturnType<ConversationStore['getConversation']>>
  }
  appendAssistant: {
    args: { conversationId: number }
    result: Awaited<ReturnType<ConversationStore['appendAssistant']>>
  }
  appendTurn: {
    args: { conversationId: number; content: string }
    result: Awaited<ReturnType<ConversationStore['appendTurn']>>
  }
  checkpointAssistant: {
    args: { messageId: number; content: string; reasoningContent: string }
    result: Awaited<ReturnType<ConversationStore['checkpointAssistant']>>
  }
  finalizeAssistant: {
    args: { messageId: number; input: FinalizeAssistantInput }
    result: Awaited<ReturnType<ConversationStore['finalizeAssistant']>>
  }
  setActiveConversation: {
    args: { selectionSessionId: number; conversationId: number }
    result: Awaited<ReturnType<ConversationStore['setActiveConversation']>>
  }
  deleteSelectionSession: {
    args: { id: number }
    result: Awaited<ReturnType<ConversationStore['deleteSelectionSession']>>
  }
  deleteOrphanSelectionSessions: {
    args: { retainedIds: number[] }
    result: Awaited<ReturnType<ConversationStore['deleteOrphanSelectionSessions']>>
  }
  getSettings: {
    args: Record<string, never>
    result: Awaited<ReturnType<ConfigStore['getSettings']>>
  }
  saveSettings: {
    args: { data: string }
    result: Awaited<ReturnType<ConfigStore['saveSettings']>>
  }
  listTools: {
    args: { includeRemoved?: boolean }
    result: Awaited<ReturnType<ConfigStore['listTools']>>
  }
  ensurePresets: {
    args: Record<string, never>
    result: Awaited<ReturnType<ConfigStore['ensurePresets']>>
  }
  createTool: {
    args: { name: string; prompt: string }
    result: Awaited<ReturnType<ConfigStore['createTool']>>
  }
  updateTool: {
    args: {
      id: number
      patch: { name?: string; prompt?: string; enabled?: boolean; isDefault?: boolean }
    }
    result: Awaited<ReturnType<ConfigStore['updateTool']>>
  }
  reorderTools: {
    args: { orderedIds: number[] }
    result: Awaited<ReturnType<ConfigStore['reorderTools']>>
  }
  softRemoveTool: {
    args: { id: number }
    result: Awaited<ReturnType<ConfigStore['softRemoveTool']>>
  }
  restoreTool: {
    args: { id: number }
    result: Awaited<ReturnType<ConfigStore['restoreTool']>>
  }
  deleteTool: {
    args: { id: number }
    result: Awaited<ReturnType<ConfigStore['deleteTool']>>
  }
  migrateLegacy: {
    args: { legacySettings: LegacySettingsDocument }
    result: Awaited<ReturnType<ConfigStore['migrateLegacy']>>
  }
}

export type DatabaseOperation = keyof DatabaseOperationMap

export type DatabaseRequest = {
  [Operation in DatabaseOperation]: {
    requestId: string
    operation: Operation
    args: DatabaseOperationMap[Operation]['args']
  }
}[DatabaseOperation]

export type DatabaseResult = DatabaseOperationMap[DatabaseOperation]['result']

const MUTATIONS = new Set<DatabaseOperation>([
  'createSelectionSession',
  'ensureToolConversation',
  'setActiveConversation',
  'appendAssistant',
  'appendTurn',
  'checkpointAssistant',
  'finalizeAssistant',
  'deleteSelectionSession',
  'deleteOrphanSelectionSessions',
  'saveSettings',
  'ensurePresets',
  'createTool',
  'updateTool',
  'reorderTools',
  'softRemoveTool',
  'restoreTool',
  'deleteTool',
  'migrateLegacy',
])

const MAX_SETTINGS_DATA_LENGTH = 100_000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isToolName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isToolPrompt(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isOrderedIds(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every(isPositiveInteger)
}

function isUniquePositiveIntegerList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every(isPositiveInteger) && new Set(value).size === value.length
}

function isSettingsData(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_SETTINGS_DATA_LENGTH
}

function isTool(value: unknown): value is ToolDefinition {
  return (
    isRecord(value) &&
    isPositiveInteger(value.id) &&
    typeof value.name === 'string' &&
    typeof value.builtin === 'boolean' &&
    typeof value.enabled === 'boolean' &&
    typeof value.isDefault === 'boolean' &&
    (value.promptMode === 'preset' || value.promptMode === 'custom') &&
    typeof value.customPrompt === 'string'
  )
}

function assertDatabaseRequest(value: unknown): asserts value is DatabaseRequest {
  if (
    !isRecord(value) ||
    typeof value.requestId !== 'string' ||
    !value.requestId.trim() ||
    typeof value.operation !== 'string' ||
    !isRecord(value.args)
  ) {
    throw invalidRequest()
  }
  const args = value.args
  let valid = false
  switch (value.operation) {
    case 'createSelectionSession':
      valid =
        isPositiveInteger(args.tabId) &&
        (args.replaceSelectionSessionId === undefined ||
          isPositiveInteger(args.replaceSelectionSessionId)) &&
        isTool(args.tool) &&
        typeof args.selectedText === 'string' &&
        Boolean(args.selectedText.trim()) &&
        typeof args.contextText === 'string' &&
        Boolean(args.contextText.trim()) &&
        typeof args.promptSnapshot === 'string' &&
        Boolean(args.promptSnapshot.trim())
      break
    case 'ensureToolConversation':
      valid =
        isPositiveInteger(args.selectionSessionId) &&
        isTool(args.tool) &&
        typeof args.promptSnapshot === 'string' &&
        Boolean(args.promptSnapshot.trim())
      break
    case 'getSelectionSession':
    case 'getConversation':
      valid = isPositiveInteger(args.id)
      break
    case 'appendAssistant':
      valid = isPositiveInteger(args.conversationId)
      break
    case 'appendTurn':
      valid =
        isPositiveInteger(args.conversationId) &&
        typeof args.content === 'string' &&
        Boolean(args.content.trim())
      break
    case 'checkpointAssistant':
      valid =
        isPositiveInteger(args.messageId) &&
        typeof args.content === 'string' &&
        typeof args.reasoningContent === 'string'
      break
    case 'finalizeAssistant':
      valid =
        isPositiveInteger(args.messageId) &&
        isRecord(args.input) &&
        ['completed', 'error', 'stopped'].includes(String(args.input.status)) &&
        typeof args.input.content === 'string' &&
        typeof args.input.reasoningContent === 'string' &&
        (args.input.estimatedThroughputTps === null ||
          (typeof args.input.estimatedThroughputTps === 'number' &&
            Number.isSafeInteger(args.input.estimatedThroughputTps) &&
            args.input.estimatedThroughputTps >= 0)) &&
        (args.input.errorCode === undefined ||
          args.input.errorCode === null ||
          typeof args.input.errorCode === 'string') &&
        (args.input.errorMessage === undefined ||
          args.input.errorMessage === null ||
          typeof args.input.errorMessage === 'string')
      break
    case 'setActiveConversation':
      valid = isPositiveInteger(args.selectionSessionId) && isPositiveInteger(args.conversationId)
      break
    case 'deleteSelectionSession':
      valid = isPositiveInteger(args.id)
      break
    case 'deleteOrphanSelectionSessions':
      valid = isUniquePositiveIntegerList(args.retainedIds)
      break
    case 'getSettings':
    case 'ensurePresets':
      valid = Object.keys(args).length === 0
      break
    case 'saveSettings':
      valid = isSettingsData(args.data)
      break
    case 'listTools':
      valid = args.includeRemoved === undefined || typeof args.includeRemoved === 'boolean'
      break
    case 'createTool':
      valid = isToolName(args.name) && isToolPrompt(args.prompt)
      break
    case 'updateTool':
      valid =
        isPositiveInteger(args.id) &&
        isRecord(args.patch) &&
        (args.patch.name === undefined || isToolName(args.patch.name)) &&
        (args.patch.prompt === undefined || isToolPrompt(args.patch.prompt)) &&
        (args.patch.enabled === undefined || typeof args.patch.enabled === 'boolean') &&
        (args.patch.isDefault === undefined || typeof args.patch.isDefault === 'boolean')
      break
    case 'reorderTools':
      valid = isOrderedIds(args.orderedIds)
      break
    case 'softRemoveTool':
    case 'restoreTool':
    case 'deleteTool':
      valid = isPositiveInteger(args.id)
      break
    case 'migrateLegacy':
      valid = isRecord(args.legacySettings)
      break
    default:
      valid = false
  }
  if (!valid) {
    console.error('[dianzhi] rejected database request', {
      requestId: value.requestId,
      operation: value.operation,
      code: 'INVALID_EVENT',
    })
    throw invalidRequest()
  }
}

function invalidRequest(): DianzhiError {
  return new DianzhiError({
    code: 'INVALID_EVENT',
    message: 'The database request is invalid or uses an unsupported operation.',
  })
}

export interface DatabaseHandlers {
  conversation: ConversationStore
  config: ConfigStore
}

async function dispatch(
  handlers: DatabaseHandlers,
  request: DatabaseRequest
): Promise<DatabaseResult> {
  switch (request.operation) {
    case 'createSelectionSession':
      return handlers.conversation.createSelectionSession(request.args)
    case 'ensureToolConversation':
      return handlers.conversation.ensureToolConversation(request.args)
    case 'getSelectionSession':
      return handlers.conversation.getSelectionSession(request.args.id)
    case 'getConversation':
      return handlers.conversation.getConversation(request.args.id)
    case 'appendAssistant':
      return handlers.conversation.appendAssistant(request.args.conversationId)
    case 'appendTurn':
      return handlers.conversation.appendTurn(request.args.conversationId, request.args.content)
    case 'checkpointAssistant':
      return handlers.conversation.checkpointAssistant(
        request.args.messageId,
        request.args.content,
        request.args.reasoningContent
      )
    case 'finalizeAssistant':
      return handlers.conversation.finalizeAssistant(request.args.messageId, request.args.input)
    case 'setActiveConversation':
      return handlers.conversation.setActiveConversation(
        request.args.selectionSessionId,
        request.args.conversationId
      )
    case 'deleteSelectionSession':
      return handlers.conversation.deleteSelectionSession(request.args.id)
    case 'deleteOrphanSelectionSessions':
      return handlers.conversation.deleteOrphanSelectionSessions(request.args.retainedIds)
    case 'getSettings':
      return handlers.config.getSettings()
    case 'saveSettings':
      return handlers.config.saveSettings(request.args.data)
    case 'listTools':
      return handlers.config.listTools(request.args.includeRemoved)
    case 'ensurePresets':
      return handlers.config.ensurePresets()
    case 'createTool':
      return handlers.config.createTool(request.args)
    case 'updateTool':
      return handlers.config.updateTool(request.args.id, request.args.patch)
    case 'reorderTools':
      return handlers.config.reorderTools(request.args.orderedIds)
    case 'softRemoveTool':
      return handlers.config.softRemoveTool(request.args.id)
    case 'restoreTool':
      return handlers.config.restoreTool(request.args.id)
    case 'deleteTool':
      return handlers.config.deleteTool(request.args.id)
    case 'migrateLegacy':
      return handlers.config.migrateLegacy(request.args)
  }
}

export function createDatabaseRpc(handlers: DatabaseHandlers) {
  const completedMutations = new Map<string, DatabaseResult>()
  const pendingMutations = new Map<string, Promise<DatabaseResult>>()

  return async (untrustedRequest: unknown): Promise<DatabaseResult> => {
    assertDatabaseRequest(untrustedRequest)
    const request = untrustedRequest
    if (!MUTATIONS.has(request.operation)) return dispatch(handlers, request)

    if (completedMutations.has(request.requestId)) {
      return completedMutations.get(request.requestId) as DatabaseResult
    }
    const pending = pendingMutations.get(request.requestId)
    if (pending) return pending

    const operation = dispatch(handlers, request)
      .then((result) => {
        completedMutations.set(request.requestId, result)
        return result
      })
      .finally(() => pendingMutations.delete(request.requestId))
    pendingMutations.set(request.requestId, operation)
    return operation
  }
}
