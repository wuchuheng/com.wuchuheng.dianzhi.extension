// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { DianzhiError } from '../../../src/dianzhi/domain/errors'
import type { ToolDefinition } from '../../../src/dianzhi/domain/types'
import { SCHEMA_RELEASE } from '../../../src/offscreen/database/schema'
import {
  createConversationStore,
  type DatabaseConnection,
  type DatabaseExecutor,
} from '../../../src/offscreen/database/store'

const tool: ToolDefinition = {
  id: 'context',
  name: '上下文',
  builtin: true,
  enabled: true,
  promptMode: 'preset',
  customPrompt: '',
}

class RecordingDatabase implements DatabaseConnection {
  readonly calls: Array<{ kind: 'exec' | 'query'; sql: string; params?: unknown }> = []
  transactions = 0
  nextId = 40
  updateChanges = 1

  async exec(sql: string, params?: unknown) {
    this.calls.push({ kind: 'exec', sql, params })
    if (/^\s*INSERT/i.test(sql)) this.nextId += 1
    return { changes: this.updateChanges, lastInsertRowid: this.nextId }
  }

  async query<T>(sql: string, params?: unknown): Promise<T[]> {
    this.calls.push({ kind: 'query', sql, params })
    if (sql.includes('COALESCE(MAX(sequence)')) return [{ sequence: 2 }] as T[]
    if (sql.includes('FROM messages') && sql.includes('WHERE id = ?')) {
      return [
        {
          id: 5,
          conversationId: 9,
          sequence: 2,
          role: 'assistant',
          content: 'partial',
          reasoningContent: 'thought',
          status: 'streaming',
          errorCode: null,
          errorMessage: null,
          createdAt: '2026-08-17T00:00:00.000Z',
          updatedAt: '2026-08-17T00:00:02.000Z',
        },
      ] as T[]
    }
    return []
  }

  async transaction<T>(callback: (tx: DatabaseExecutor) => Promise<T>): Promise<T> {
    this.transactions += 1
    return callback(this)
  }
}

describe('offscreen conversation store', () => {
  it('defines the versioned two-table schema with foreign keys and uniqueness', () => {
    expect(SCHEMA_RELEASE.version).toBe('1.0.0')
    expect(SCHEMA_RELEASE.migrationSQL).toContain('PRAGMA foreign_keys = ON')
    expect(SCHEMA_RELEASE.migrationSQL.match(/CREATE TABLE/g)).toHaveLength(2)
    expect(SCHEMA_RELEASE.migrationSQL).toContain('ON DELETE CASCADE')
    expect(SCHEMA_RELEASE.migrationSQL).toContain('UNIQUE(selection_key, tool_id)')
    expect(SCHEMA_RELEASE.migrationSQL).toContain('UNIQUE(conversation_id, sequence)')
  })

  it('creates the root conversation, fixes its selection key, and inserts the first message atomically', async () => {
    const db = new RecordingDatabase()
    const store = createConversationStore(db, () => '2026-08-17T00:00:00.000Z')

    const created = await store.createSelection({
      tabId: 7,
      tool,
      selectedText: 'learning',
      contextText: '<selected>learning</selected>',
      promptSnapshot: 'filled prompt',
    })

    expect(db.transactions).toBe(1)
    expect(created.conversation).toMatchObject({
      id: 41,
      selectionKey: 41,
      tabId: 7,
      toolId: 'context',
    })
    expect(created.messages[0]).toMatchObject({
      id: 42,
      conversationId: 41,
      sequence: 1,
      role: 'user',
      content: 'filled prompt',
      status: 'completed',
    })
    expect(db.calls[0]?.params).toBeInstanceOf(Array)
    expect(db.calls[1]).toMatchObject({
      kind: 'exec',
      params: [41, '2026-08-17T00:00:00.000Z', 41],
    })
    expect(Object.isFrozen(created)).toBe(true)
    expect(Object.isFrozen(created.conversation)).toBe(true)
    expect(Object.isFrozen(created.messages)).toBe(true)
  })

  it('returns an existing tool conversation without creating a duplicate', async () => {
    const existing = {
      id: 19,
      selectionKey: 11,
      tabId: 7,
      toolId: 'context',
      toolName: '上下文',
      title: 'word',
      selectedText: 'word',
      contextText: '<selected>word</selected>',
      promptSnapshot: 'prompt',
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
    }
    const db = new RecordingDatabase()
    db.query = async <T>(sql: string, params?: unknown): Promise<T[]> => {
      db.calls.push({ kind: 'query', sql, params })
      if (sql.includes('FROM conversations')) return [existing] as T[]
      return []
    }
    const store = createConversationStore(db, () => '2026-08-17T00:00:00.000Z')

    const snapshot = await store.ensureToolConversation({
      selectionKey: 11,
      tool,
      promptSnapshot: 'prompt',
    })

    expect(snapshot.conversation.id).toBe(19)
    expect(db.transactions).toBe(0)
  })

  it('appends a completed user row and streaming assistant placeholder in one transaction', async () => {
    const db = new RecordingDatabase()
    const store = createConversationStore(db, () => '2026-08-17T00:00:01.000Z')

    const turn = await store.appendTurn(9, 'Continue')

    expect(db.transactions).toBe(1)
    expect(turn.user).toMatchObject({ sequence: 3, role: 'user', status: 'completed' })
    expect(turn.assistant).toMatchObject({ sequence: 4, role: 'assistant', status: 'streaming' })
    expect(db.calls.filter((call) => call.kind === 'exec')).toHaveLength(3)
  })

  it('replaces the previous tab selection inside the root creation transaction', async () => {
    const db = new RecordingDatabase()
    const store = createConversationStore(db, () => '2026-08-17T00:00:01.000Z')

    await store.createSelection({
      tabId: 7,
      replaceSelectionKey: 12,
      tool,
      selectedText: 'replacement',
      contextText: '<selected>replacement</selected>',
      promptSnapshot: 'replacement prompt',
    })

    expect(db.transactions).toBe(1)
    expect(db.calls[0]).toMatchObject({ kind: 'exec', params: [7, 12] })
    expect(db.calls[0]?.sql).toContain('DELETE FROM conversations')
  })

  it('guards checkpoint and terminal transitions with the current streaming status', async () => {
    const db = new RecordingDatabase()
    const store = createConversationStore(db, () => '2026-08-17T00:00:02.000Z')

    await store.checkpointAssistant(5, 'partial', 'thought')
    expect(db.calls[0]?.sql).toContain("status = 'streaming'")
    await expect(
      store.finalizeAssistant(5, {
        status: 'streaming' as never,
        content: 'bad',
        reasoningContent: '',
      })
    ).rejects.toBeInstanceOf(DianzhiError)

    db.updateChanges = 0
    await expect(store.checkpointAssistant(5, 'late', '')).rejects.toMatchObject({
      code: 'DB_UNAVAILABLE',
    })
  })

  it('deletes an entire selection group using parameterized tab and selection IDs', async () => {
    const db = new RecordingDatabase()
    const store = createConversationStore(db, () => '2026-08-17T00:00:03.000Z')

    await store.deleteSelection(7, 41)

    expect(db.calls[0]).toMatchObject({ kind: 'exec', params: [7, 41] })
    expect(db.calls[0]?.sql).toContain('DELETE FROM conversations')
  })
})
