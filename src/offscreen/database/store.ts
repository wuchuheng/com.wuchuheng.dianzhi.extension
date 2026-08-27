import { DianzhiError } from '@/dianzhi/domain/errors'
import type { ConversationRecord, MessageRecord, MessageStatus } from '@/dianzhi/domain/protocol'
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

export interface StoredConversationSnapshot {
  readonly conversation: Readonly<ConversationRecord>
  readonly messages: readonly Readonly<MessageRecord>[]
  readonly conversations: readonly Readonly<ConversationRecord>[]
}

export interface CreateSelectionInput {
  tabId: number
  replaceSelectionKey?: number
  tool: ToolDefinition
  selectedText: string
  contextText: string
  promptSnapshot: string
}

export interface EnsureToolConversationInput {
  selectionKey: number
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
  selection_key AS selectionKey,
  tab_id AS tabId,
  tool_id AS toolId,
  tool_name AS toolName,
  title,
  selected_text AS selectedText,
  context_text AS contextText,
  prompt_snapshot AS promptSnapshot,
  created_at AS createdAt,
  updated_at AS updatedAt`

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
  conversation: ConversationRecord
  messages: MessageRecord[]
  conversations: ConversationRecord[]
}): StoredConversationSnapshot {
  const conversation = Object.freeze({ ...snapshot.conversation })
  const messages = Object.freeze(snapshot.messages.map((message) => Object.freeze({ ...message })))
  const conversations = Object.freeze(
    snapshot.conversations.map((item) => Object.freeze({ ...item }))
  )
  return Object.freeze({ conversation, messages, conversations })
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
  async function getConversation(id: number): Promise<StoredConversationSnapshot | null> {
    const rows = await db.query<ConversationRecord>(
      `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE id = ?`,
      [id]
    )
    const conversation = rows[0]
    if (!conversation) return null

    const [messages, conversations] = await Promise.all([
      db.query<MessageRecord>(
        `SELECT ${MESSAGE_COLUMNS} FROM messages WHERE conversation_id = ? ORDER BY sequence ASC`,
        [id]
      ),
      db.query<ConversationRecord>(
        `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE selection_key = ? ORDER BY id ASC`,
        [conversation.selectionKey]
      ),
    ])
    return freezeSnapshot({ conversation, messages, conversations })
  }

  async function createSelection(input: CreateSelectionInput): Promise<StoredConversationSnapshot> {
    const now = clock()
    const result = await db.transaction(async (tx) => {
      if (input.replaceSelectionKey !== undefined) {
        await tx.exec('DELETE FROM conversations WHERE tab_id = ? AND selection_key = ?', [
          input.tabId,
          input.replaceSelectionKey,
        ])
      }
      const inserted = await tx.exec(
        `INSERT INTO conversations (
          selection_key, tab_id, tool_id, tool_name, title, selected_text,
          context_text, prompt_snapshot, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          0,
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
      const conversationId = integerId(inserted.lastInsertRowid, 'createSelection')
      await tx.exec('UPDATE conversations SET selection_key = ?, updated_at = ? WHERE id = ?', [
        conversationId,
        now,
        conversationId,
      ])
      const messageInsert = await tx.exec(
        `INSERT INTO messages (
          conversation_id, sequence, role, content, reasoning_content, status,
          error_code, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [conversationId, 1, 'user', input.promptSnapshot, '', 'completed', null, null, now, now]
      )
      return {
        conversationId,
        messageId: integerId(messageInsert.lastInsertRowid, 'createSelectionMessage'),
      }
    })

    const conversation: ConversationRecord = {
      id: result.conversationId,
      selectionKey: result.conversationId,
      tabId: input.tabId,
      toolId: input.tool.id,
      toolName: input.tool.name,
      title: titleFor(input.selectedText),
      selectedText: input.selectedText,
      contextText: input.contextText,
      promptSnapshot: input.promptSnapshot,
      createdAt: now,
      updatedAt: now,
    }
    return freezeSnapshot({
      conversation,
      messages: [
        messageRecord(
          result.messageId,
          result.conversationId,
          1,
          'user',
          input.promptSnapshot,
          'completed',
          now
        ),
      ],
      conversations: [conversation],
    })
  }

  async function ensureToolConversation(
    input: EnsureToolConversationInput
  ): Promise<StoredConversationSnapshot> {
    const existing = await db.query<ConversationRecord>(
      `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE selection_key = ? AND tool_id = ?`,
      [input.selectionKey, input.tool.id]
    )
    if (existing[0]) {
      const snapshot = await getConversation(existing[0].id)
      if (snapshot) return snapshot
    }

    const roots = await db.query<ConversationRecord>(
      `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE selection_key = ? ORDER BY id ASC LIMIT 1`,
      [input.selectionKey]
    )
    const root = roots[0]
    if (!root) {
      throw new DianzhiError({
        code: 'CONVERSATION_NOT_FOUND',
        message: 'The selected-text conversation no longer exists.',
        context: { selectionKey: input.selectionKey },
      })
    }

    const now = clock()
    try {
      const ids = await db.transaction(async (tx) => {
        const conversationInsert = await tx.exec(
          `INSERT INTO conversations (
          selection_key, tab_id, tool_id, tool_name, title, selected_text,
          context_text, prompt_snapshot, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            root.selectionKey,
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
        const conversationId = integerId(
          conversationInsert.lastInsertRowid,
          'ensureToolConversation'
        )
        const messageInsert = await tx.exec(
          `INSERT INTO messages (
          conversation_id, sequence, role, content, reasoning_content, status,
          error_code, error_message, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [conversationId, 1, 'user', input.promptSnapshot, '', 'completed', null, null, now, now]
        )
        integerId(messageInsert.lastInsertRowid, 'ensureToolMessage')
        return conversationId
      })

      const snapshot = await getConversation(ids)
      if (snapshot) return snapshot
    } catch (error) {
      const raced = await db.query<ConversationRecord>(
        `SELECT ${CONVERSATION_COLUMNS} FROM conversations WHERE selection_key = ? AND tool_id = ?`,
        [input.selectionKey, input.tool.id]
      )
      if (raced[0]) {
        const snapshot = await getConversation(raced[0].id)
        if (snapshot) return snapshot
      }
      throw error
    }

    throw new DianzhiError({
      code: 'DB_UNAVAILABLE',
      message: 'The tool conversation was created but could not be loaded.',
      context: { selectionKey: input.selectionKey, toolId: input.tool.id },
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

  async function deleteSelection(tabId: number, selectionKey: number): Promise<void> {
    await db.exec('DELETE FROM conversations WHERE tab_id = ? AND selection_key = ?', [
      tabId,
      selectionKey,
    ])
  }

  return {
    createSelection,
    ensureToolConversation,
    getConversation,
    appendAssistant,
    appendTurn,
    checkpointAssistant,
    finalizeAssistant,
    deleteSelection,
  }
}

export type ConversationStore = ReturnType<typeof createConversationStore>
