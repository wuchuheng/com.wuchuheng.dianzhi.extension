import { DianzhiError } from '@/dianzhi/domain/errors'
import type { ToolDefinition } from '@/dianzhi/domain/types'
import type {
  ConversationStore,
  CreateSelectionInput,
  EnsureToolConversationInput,
  FinalizeAssistantInput,
} from './store'

export interface DatabaseOperationMap {
  createSelection: {
    args: CreateSelectionInput
    result: Awaited<ReturnType<ConversationStore['createSelection']>>
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
  deleteSelection: {
    args: { tabId: number; selectionKey: number }
    result: Awaited<ReturnType<ConversationStore['deleteSelection']>>
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
  'createSelection',
  'ensureToolConversation',
  'appendAssistant',
  'appendTurn',
  'checkpointAssistant',
  'finalizeAssistant',
  'deleteSelection',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isTool(value: unknown): value is ToolDefinition {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    Boolean(value.id.trim()) &&
    typeof value.name === 'string' &&
    typeof value.builtin === 'boolean' &&
    typeof value.enabled === 'boolean' &&
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
    case 'createSelection':
      valid =
        isPositiveInteger(args.tabId) &&
        (args.replaceSelectionKey === undefined || isPositiveInteger(args.replaceSelectionKey)) &&
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
        isPositiveInteger(args.selectionKey) &&
        isTool(args.tool) &&
        typeof args.promptSnapshot === 'string' &&
        Boolean(args.promptSnapshot.trim())
      break
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
        (args.input.errorCode === undefined ||
          args.input.errorCode === null ||
          typeof args.input.errorCode === 'string') &&
        (args.input.errorMessage === undefined ||
          args.input.errorMessage === null ||
          typeof args.input.errorMessage === 'string')
      break
    case 'deleteSelection':
      valid = isPositiveInteger(args.tabId) && isPositiveInteger(args.selectionKey)
      break
    default:
      valid = false
  }
  if (!valid) throw invalidRequest()
}

function invalidRequest(): DianzhiError {
  return new DianzhiError({
    code: 'INVALID_EVENT',
    message: 'The database request is invalid or uses an unsupported operation.',
  })
}

async function dispatch(
  store: ConversationStore,
  request: DatabaseRequest
): Promise<DatabaseResult> {
  switch (request.operation) {
    case 'createSelection':
      return store.createSelection(request.args)
    case 'ensureToolConversation':
      return store.ensureToolConversation(request.args)
    case 'getConversation':
      return store.getConversation(request.args.id)
    case 'appendAssistant':
      return store.appendAssistant(request.args.conversationId)
    case 'appendTurn':
      return store.appendTurn(request.args.conversationId, request.args.content)
    case 'checkpointAssistant':
      return store.checkpointAssistant(
        request.args.messageId,
        request.args.content,
        request.args.reasoningContent
      )
    case 'finalizeAssistant':
      return store.finalizeAssistant(request.args.messageId, request.args.input)
    case 'deleteSelection':
      return store.deleteSelection(request.args.tabId, request.args.selectionKey)
  }
}

export function createDatabaseRpc(store: ConversationStore) {
  const completedMutations = new Map<string, DatabaseResult>()
  const pendingMutations = new Map<string, Promise<DatabaseResult>>()

  return async (untrustedRequest: unknown): Promise<DatabaseResult> => {
    assertDatabaseRequest(untrustedRequest)
    const request = untrustedRequest
    if (!MUTATIONS.has(request.operation)) return dispatch(store, request)

    if (completedMutations.has(request.requestId)) {
      return completedMutations.get(request.requestId) as DatabaseResult
    }
    const pending = pendingMutations.get(request.requestId)
    if (pending) return pending

    const operation = dispatch(store, request)
      .then((result) => {
        completedMutations.set(request.requestId, result)
        return result
      })
      .finally(() => pendingMutations.delete(request.requestId))
    pendingMutations.set(request.requestId, operation)
    return operation
  }
}
