import { DianzhiError } from '@/dianzhi/domain/errors'
import type {
  ConversationRecord,
  MessageRecord,
  MessageStatus,
  SelectionSessionRecord,
} from '@/dianzhi/domain/protocol'
import type { ToolDefinition } from '@/dianzhi/domain/types'

export type SqlValue = null | number | string | boolean | bigint | Uint8Array | ArrayBuffer
export type SqlParams = SqlValue[] | Record<string, SqlValue>

export interface DatabaseExecutor {
  exec(
    sql: string,
    params?: SqlParams
  ): Promise<{ changes?: number | bigint; lastInsertRowid?: number | bigint }>
  query<T>(sql: string, params?: SqlParams): Promise<T[]>
}

export interface DatabaseConnection extends DatabaseExecutor {
  transaction<T>(callback: (tx: DatabaseExecutor) => Promise<T>): Promise<T>
}

/** Restorable selection-session state with its active conversation and tool history. */
export interface StoredConversationSnapshot {
  readonly selectionSession: Readonly<SelectionSessionRecord>
  readonly conversation: Readonly<ConversationRecord>
  readonly messages: readonly Readonly<MessageRecord>[]
  readonly conversations: readonly Readonly<ConversationRecord>[]
}

/** Data required to create a session and its first tool conversation. */
export interface CreateSelectionSessionInput {
  tabId: number
  replaceSelectionSessionId?: number
  tool: ToolDefinition
  selectedText: string
  contextText: string
  promptSnapshot: string
}

/** Data required to restore or create one tool conversation in a session. */
export interface EnsureToolConversationInput {
  selectionSessionId: number
  tool: ToolDefinition
  promptSnapshot: string
}

export interface FinalizeAssistantInput {
  status: Extract<MessageStatus, 'completed' | 'error' | 'stopped'>
  content: string
  reasoningContent: string
  estimatedThroughputTps: number | null
  errorCode?: string | null
  errorMessage?: string | null
}

const CONVERSATION_COLUMNS = `
  id,
  selection_session_id AS selectionSessionId,
  selection_session_id AS selectionKey,
  tab_id AS tabId,
  tool_id AS toolId,
  tool_name AS toolName,
  title,
  selected_text AS selectedText,
  context_text AS contextText,
  prompt_snapshot AS promptSnapshot,
  created_at AS createdAt,
  updated_at AS updatedAt`

const SELECTION_SESSION_COLUMNS = `
  id,
  active_conversation_id AS activeConversationId,
  created_at AS createdAt,
  updated_at AS updatedAt`

interface RawSelectionSessionRecord {
  id: number
  activeConversationId: number | null
  createdAt: string
  updatedAt: string
}

const MESSAGE_COLUMNS = `
  id,
  conversation_id AS conversationId,
  sequence,
  role,
  content,
  reasoning_content AS reasoningContent,
  estimated_throughput_tps AS estimatedThroughputTps,
  status,
  error_code AS errorCode,
  error_message AS errorMessage,
  created_at AS createdAt,
  updated_at AS updatedAt`

function integerId(value: number | bigint | undefined, operation: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new DianzhiError({
      code: 'DB_UNAVAILABLE',
      message: `SQLite did not return a valid ID for ${operation}.`,
      context: { operation },
    })
  }
  return id
}

function titleFor(selectedText: string): string {
  const compact = selectedText.trim().replace(/\s+/g, ' ')
  return compact.length > 60 ? `${compact.slice(0, 57)}...` : compact
}

function freezeSnapshot(snapshot: {
  selectionSession: SelectionSessionRecord
  conversation: ConversationRecord
  messages: MessageRecord[]
  conversations: ConversationRecord[]
}): StoredConversationSnapshot {
  const selectionSession = Object.freeze({ ...snapshot.selectionSession })
  const conversation = Object.freeze({ ...snapshot.conversation })
  const messages = Object.freeze(snapshot.messages.map((message) => Object.freeze({ ...message })))
  const conversations = Object.freeze(
    snapshot.conversations.map((item) => Object.freeze({ ...item }))
  )
  return Object.freeze({ selectionSession, conversation, messages, conversations })
}

function messageRecord(
  id: number,
  conversationId: number,
  sequence: number,
  role: 'user' | 'assistant',
  content: string,
  status: MessageStatus,
  now: string
): MessageRecord {
  return {
    id,
    conversationId,
    sequence,
    role,
    content,
    reasoningContent: '',
    estimatedThroughputTps: null,
    status,
    errorCode: null,
    errorMessage: null,
    createdAt: now,
    updatedAt: now,
  }
}

async function readMessage(db: DatabaseExecutor, messageId: number): Promise<MessageRecord> {
  const rows = await db.query<MessageRecord>(
    `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE id = ?`,
    [messageId]
  )
  const message = rows[0]
  if (!message) {
    throw new DianzhiError({
      code: 'DB_UNAVAILABLE',
      message: 'The assistant message could not be loaded after an update.',
      context: { messageId },
    })
  }
  return Object.freeze({ ...message })
}

export function createConversationStore(db: DatabaseConnection, clock: () => string) {
  async function snapshotForSession(
    selectionSessionId: number,
    requestedConversationId?: number
  ): Promise<StoredConversationSnapshot | null> {
    // 1. Load the aggregate root and its session conversations.
    const sessions = await db.query<RawSelectionSessionRecord>(
      `SELECT ${SELECTION_SESSION_COLUMNS} FROM selection_sessions WHERE id = ?`,
      [selectionSessionId]
    )
    const rawSelectionSession = sessions[0]
    if (!rawSelectionSession) return null

    const conversations = await db.query<ConversationRecord>(
      `SELECT ${CONVERSATION_COLUMNS} FROM conversations
       WHERE selection_session_id = ? ORDER BY id ASC`,
      [selectionSessionId]
    )
    if (conversations.length === 0) {
      throw new DianzhiError({
        code: 'DB_UNAVAILABLE',
        message: 'The selection session has no conversations to restore.',
        context: { selectionSessionId },
      })
    }

    // 2. Repair a nullable or stale active pointer before exposing the session.
    let activeConversation = conversations.find(
      (conversation) => conversation.id === rawSelectionSession.activeConversationId
    )
    let updatedAt = rawSelectionSession.updatedAt
    if (!activeConversation) {
      activeConversation = conversations[0]
      const now = clock()
      await db.exec(
        'UPDATE selection_sessions SET active_conversation_id = ?, updated_at = ? WHERE id = ?',
        [activeConversation.id, now, selectionSessionId]
      )
      updatedAt = now
    }

    const conversation =
      requestedConversationId === undefined
        ? activeConversation
        : conversations.find((item) => item.id === requestedConversationId)
    if (!conversation) return null
    const messages = await db.query<MessageRecord>(
      `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE conversation_id = ? ORDER BY sequence ASC`,
      [conversation.id]
    )

    // 3. Return an immutable session-aware snapshot.
    return freezeSnapshot({
      selectionSession: {
        id: rawSelectionSession.id,
        activeConversationId: activeConversation.id,
        createdAt: rawSelectionSession.createdAt,
        updatedAt,
      },
      conversation,
      messages,
      conversations,
    })
  }

  async function getSelectionSession(id: number): Promise<StoredConversationSnapshot | null> {
    return snapshotForSession(id)
  }

  async function getConversation(id: number): Promise<StoredConversationSnapshot | null> {
    const conversations = await db.query<ConversationRecord>(
      `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = ?`,
      [id]
    )
    const conversation = conversations[0]
    if (!conversation) return null
    return snapshotForSession(conversation.selectionSessionId, id)
  }

  async function updateActiveConversation(
    tx: DatabaseExecutor,
    selectionSessionId: number,
    conversationId: number,
    now: string
  ): Promise<void> {
    const result = await tx.exec(
      `UPDATE selection_sessions
       SET active_conversation_id = ?, updated_at = ?
       WHERE id = ?
         AND EXISTS (
           SELECT 1 FROM conversations
           WHERE id = ? AND selection_session_id = selection_sessions.id
         )`,
      [conversationId, now, selectionSessionId, conversationId]
    )
    if (Number(result.changes ?? 0) !== 1) {
      throw new DianzhiError({
        code: 'INVALID_EVENT',
        message: 'The active conversation must belong to the selection session.',
        context: { selectionSessionId, conversationId },
      })
    }
  }

  async function createSelectionSession(
    input: CreateSelectionSessionInput
  ): Promise<StoredConversationSnapshot> {
    const now = clock()
    const selectionSessionId = await db.transaction(async (tx) => {
      if (input.replaceSelectionSessionId !== undefined) {
        await tx.exec('DELETE FROM selection_sessions WHERE id = ?', [
          input.replaceSelectionSessionId,
        ])
      }
      const sessionInsert = await tx.exec(
        `INSERT INTO selection_sessions (active_conversation_id, created_at, updated_at)
         VALUES (NULL, ?, ?)`,
        [now, now]
      )
      const sessionId = integerId(sessionInsert.lastInsertRowid, 'createSelectionSession')
      const conversationInsert = await tx.exec(
        `INSERT INTO conversations (
          selection_session_id, tab_id, tool_id, tool_name, title, selected_text,
          context_text, prompt_snapshot, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          input.tabId,
          input.tool.id,
          input.tool.name,
          titleFor(input.selectedText),
          input.selectedText,
          input.contextText,
          input.promptSnapshot,
          now,
          now,
        ]
      )
      const conversationId = integerId(conversationInsert.lastInsertRowid, 'createSelectionSession')
      await tx.exec(
        `INSERT INTO messages (
          conversation_id, sequence, role, content, reasoning_content, status,
          error_code, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [conversationId, 1, 'user', input.promptSnapshot, '', 'completed', null, null, now, now]
      )
      await updateActiveConversation(tx, sessionId, conversationId, now)
      return sessionId
    })
    const snapshot = await getSelectionSession(selectionSessionId)
    if (snapshot) return snapshot
    throw new DianzhiError({
      code: 'DB_UNAVAILABLE',
      message: 'The selection session was created but could not be loaded.',
      context: { selectionSessionId },
    })
  }

  async function setActiveConversation(
    selectionSessionId: number,
    conversationId: number
  ): Promise<StoredConversationSnapshot> {
    await db.transaction((tx) =>
      updateActiveConversation(tx, selectionSessionId, conversationId, clock())
    )
    const snapshot = await getSelectionSession(selectionSessionId)
    if (snapshot) return snapshot
    throw new DianzhiError({
      code: 'CONVERSATION_NOT_FOUND',
      message: 'The selection session no longer exists.',
      context: { selectionSessionId },
    })
  }

  async function ensureToolConversation(
    input: EnsureToolConversationInput
  ): Promise<StoredConversationSnapshot> {
    const now = clock()
    let conversationId: number
    try {
      conversationId = await db.transaction(async (tx) => {
        const existing = await tx.query<ConversationRecord>(
          `SELECT ${CONVERSATION_COLUMNS} FROM conversations
           WHERE selection_session_id = ? AND tool_id = ?`,
          [input.selectionSessionId, input.tool.id]
        )
        if (existing[0]) {
          await updateActiveConversation(tx, input.selectionSessionId, existing[0].id, now)
          return existing[0].id
        }
        const roots = await tx.query<ConversationRecord>(
          `SELECT ${CONVERSATION_COLUMNS} FROM conversations
           WHERE selection_session_id = ? ORDER BY id ASC LIMIT 1`,
          [input.selectionSessionId]
        )
        const root = roots[0]
        if (!root) {
          throw new DianzhiError({
            code: 'CONVERSATION_NOT_FOUND',
            message: 'The selected-text session no longer exists.',
            context: { selectionSessionId: input.selectionSessionId },
          })
        }
        const conversationInsert = await tx.exec(
          `INSERT INTO conversations (
            selection_session_id, tab_id, tool_id, tool_name, title, selected_text,
            context_text, prompt_snapshot, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            input.selectionSessionId,
            root.tabId,
            input.tool.id,
            input.tool.name,
            root.title,
            root.selectedText,
            root.contextText,
            input.promptSnapshot,
            now,
            now,
          ]
        )
        const id = integerId(conversationInsert.lastInsertRowid, 'ensureToolConversation')
        await tx.exec(
          `INSERT INTO messages (
            conversation_id, sequence, role, content, reasoning_content, status,
            error_code, error_message, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, 1, 'user', input.promptSnapshot, '', 'completed', null, null, now, now]
        )
        await updateActiveConversation(tx, input.selectionSessionId, id, now)
        return id
      })
    } catch (error) {
      const raced = await db.query<ConversationRecord>(
        `SELECT ${CONVERSATION_COLUMNS} FROM conversations
         WHERE selection_session_id = ? AND tool_id = ?`,
        [input.selectionSessionId, input.tool.id]
      )
      if (!raced[0]) throw error
      conversationId = raced[0].id
      await setActiveConversation(input.selectionSessionId, conversationId)
    }
    const snapshot = await getConversation(conversationId)
    if (snapshot) return snapshot
    throw new DianzhiError({
      code: 'DB_UNAVAILABLE',
      message: 'The tool conversation was created but could not be loaded.',
      context: { selectionSessionId: input.selectionSessionId, toolId: input.tool.id },
    })
  }

  async function appendAssistant(conversationId: number): Promise<MessageRecord> {
    return db.transaction(async (tx) => {
      const rows = await tx.query<{ sequence: number }>(
        'SELECT COALESCE(MAX(sequence), 0) AS sequence FROM messages WHERE conversation_id = ?',
        [conversationId]
      )
      const sequence = (rows[0]?.sequence ?? 0) + 1
      const now = clock()
      const inserted = await tx.exec(
        `INSERT INTO messages (
          conversation_id, sequence, role, content, reasoning_content, status,
          error_code, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [conversationId, sequence, 'assistant', '', '', 'streaming', null, null, now, now]
      )
      await tx.exec('UPDATE conversations SET updated_at = ? WHERE id = ?', [now, conversationId])
      return Object.freeze(
        messageRecord(
          integerId(inserted.lastInsertRowid, 'appendAssistant'),
          conversationId,
          sequence,
          'assistant',
          '',
          'streaming',
          now
        )
      )
    })
  }

  async function appendTurn(conversationId: number, content: string) {
    return db.transaction(async (tx) => {
      const rows = await tx.query<{ sequence: number }>(
        'SELECT COALESCE(MAX(sequence), 0) AS sequence FROM messages WHERE conversation_id = ?',
        [conversationId]
      )
      const userSequence = (rows[0]?.sequence ?? 0) + 1
      const now = clock()
      const userInsert = await tx.exec(
        `INSERT INTO messages (
          conversation_id, sequence, role, content, reasoning_content, status,
          error_code, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [conversationId, userSequence, 'user', content, '', 'completed', null, null, now, now]
      )
      const assistantInsert = await tx.exec(
        `INSERT INTO messages (
          conversation_id, sequence, role, content, reasoning_content, status,
          error_code, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [conversationId, userSequence + 1, 'assistant', '', '', 'streaming', null, null, now, now]
      )
      await tx.exec('UPDATE conversations SET updated_at = ? WHERE id = ?', [now, conversationId])
      return Object.freeze({
        user: Object.freeze(
          messageRecord(
            integerId(userInsert.lastInsertRowid, 'appendTurnUser'),
            conversationId,
            userSequence,
            'user',
            content,
            'completed',
            now
          )
        ),
        assistant: Object.freeze(
          messageRecord(
            integerId(assistantInsert.lastInsertRowid, 'appendTurnAssistant'),
            conversationId,
            userSequence + 1,
            'assistant',
            '',
            'streaming',
            now
          )
        ),
      })
    })
  }

  async function checkpointAssistant(
    messageId: number,
    content: string,
    reasoningContent: string
  ): Promise<MessageRecord> {
    const now = clock()
    const result = await db.exec(
      `UPDATE messages
       SET content = ?, reasoning_content = ?, updated_at = ?
       WHERE id = ? AND role = 'assistant' AND status = 'streaming'`,
      [content, reasoningContent, now, messageId]
    )
    if (Number(result.changes ?? 0) !== 1) {
      throw new DianzhiError({
        code: 'DB_UNAVAILABLE',
        message: 'The assistant checkpoint was rejected because the stream is no longer active.',
        context: { messageId },
      })
    }
    return readMessage(db, messageId)
  }

  async function finalizeAssistant(
    messageId: number,
    input: FinalizeAssistantInput
  ): Promise<MessageRecord> {
    if (!['completed', 'error', 'stopped'].includes(input.status)) {
      throw new DianzhiError({
        code: 'INVALID_EVENT',
        message: 'Assistant finalization requires a terminal status.',
        context: { messageId },
      })
    }
    const now = clock()
    const result = await db.exec(
      `UPDATE messages
       SET content = ?, reasoning_content = ?, status = ?, error_code = ?,
           error_message = ?, estimated_throughput_tps = ?, updated_at = ?
       WHERE id = ? AND role = 'assistant' AND status = 'streaming'`,
      [
        input.content,
        input.reasoningContent,
        input.status,
        input.errorCode ?? null,
        input.errorMessage ?? null,
        input.estimatedThroughputTps,
        now,
        messageId,
      ]
    )
    if (Number(result.changes ?? 0) !== 1) {
      throw new DianzhiError({
        code: 'DB_UNAVAILABLE',
        message: 'The assistant finalization was rejected because the stream is no longer active.',
        context: { messageId },
      })
    }
    return readMessage(db, messageId)
  }

  async function deleteSelectionSession(id: number): Promise<void> {
    await db.exec('DELETE FROM selection_sessions WHERE id = ?', [id])
  }

  async function deleteOrphanSelectionSessions(retainedIds: number[]): Promise<void> {
    if (
      !retainedIds.every((id) => Number.isSafeInteger(id) && id > 0) ||
      new Set(retainedIds).size !== retainedIds.length
    ) {
      throw new DianzhiError({
        code: 'INVALID_EVENT',
        message: 'Retained selection-session IDs must be unique positive integers.',
      })
    }
    if (retainedIds.length === 0) {
      await db.exec('DELETE FROM selection_sessions')
      return
    }
    const placeholders = retainedIds.map(() => '?').join(', ')
    await db.exec(`DELETE FROM selection_sessions WHERE id NOT IN (${placeholders})`, retainedIds)
  }

  return {
    createSelectionSession,
    ensureToolConversation,
    getSelectionSession,
    getConversation,
    setActiveConversation,
    appendAssistant,
    appendTurn,
    checkpointAssistant,
    finalizeAssistant,
    deleteSelectionSession,
    deleteOrphanSelectionSessions,
  }
}

export type ConversationStore = ReturnType<typeof createConversationStore>
