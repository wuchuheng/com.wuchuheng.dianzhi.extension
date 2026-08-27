// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import {
  CONFIG_RELEASE,
  MESSAGE_THROUGHPUT_RELEASE,
  SCHEMA_RELEASE,
  TOOL_ID_RELEASE,
} from '@/offscreen/database/schema'
import * as schema from '@/offscreen/database/schema'

type SelectionSessionRelease = { version: string; migrationSQL: string }

function databaseAt220(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_RELEASE.migrationSQL)
  db.exec(CONFIG_RELEASE.migrationSQL)
  db.exec(TOOL_ID_RELEASE.migrationSQL)
  db.exec(MESSAGE_THROUGHPUT_RELEASE.migrationSQL)
  return db
}

function databaseAt100(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_RELEASE.migrationSQL)
  return db
}

function insertConversation(
  db: DatabaseSync,
  input: { id?: number; selectionKey: number; toolId: number }
): void {
  const id = input.id ?? input.toolId
  db.prepare(
    `INSERT INTO conversations (
      id, selection_key, tab_id, tool_id, tool_name, title, selected_text,
      context_text, prompt_snapshot, created_at, updated_at
    ) VALUES (?, ?, 9, ?, 'tool', 'run', 'run', 'run fast', 'Explain run', '2026-08-27', '2026-08-27')`
  ).run(id, input.selectionKey, input.toolId)
}

function insertMessage(db: DatabaseSync, input: { id: number; conversationId: number }): void {
  db.prepare(
    `INSERT INTO messages (
      id, conversation_id, sequence, role, content, reasoning_content, status,
      error_code, error_message, created_at, updated_at
    ) VALUES (?, ?, 1, 'assistant', 'hello', '', 'completed', NULL, NULL, '2026-08-27', '2026-08-27')`
  ).run(input.id, input.conversationId)
}

function count(db: DatabaseSync, table: 'conversations' | 'messages'): number {
  return (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count
}

function selectionSessionRelease(): SelectionSessionRelease | undefined {
  return (schema as typeof schema & { SELECTION_SESSION_RELEASE?: SelectionSessionRelease })
    .SELECTION_SESSION_RELEASE
}

function migratedDatabase(): DatabaseSync {
  const release = selectionSessionRelease()
  expect(release?.version).toBe('2.3.0')
  if (!release) throw new Error('SELECTION_SESSION_RELEASE is not available')
  const db = databaseAt220()
  insertConversation(db, { id: 10, selectionKey: 10, toolId: 1 })
  applyRelease(db, release)
  return db
}

function applyRelease(db: DatabaseSync, release: SelectionSessionRelease): void {
  db.exec('BEGIN')
  try {
    db.exec(release.migrationSQL)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

describe('SELECTION_SESSION_RELEASE 2.3.0', () => {
  it('preserves distinct pre-runtime legacy tool identifiers during a direct upgrade', () => {
    const release = selectionSessionRelease()
    expect(release?.version).toBe('2.3.0')
    if (!release) return
    const db = databaseAt100()
    db.exec(`
      INSERT INTO conversations (
        id, selection_key, tab_id, tool_id, tool_name, title, selected_text,
        context_text, prompt_snapshot, created_at, updated_at
      ) VALUES
        (10, 10, 9, 'context', 'Context', 'run', 'run', 'run fast', 'Context run', '2026-08-27', '2026-08-27'),
        (11, 10, 9, 'custom-tool', 'Custom', 'run', 'run', 'run fast', 'Custom run', '2026-08-27', '2026-08-27');
    `)
    applyRelease(db, CONFIG_RELEASE)
    applyRelease(db, TOOL_ID_RELEASE)
    applyRelease(db, MESSAGE_THROUGHPUT_RELEASE)

    applyRelease(db, release)

    expect(db.prepare('SELECT id, tool_id FROM conversations ORDER BY id').all()).toEqual([
      { id: 10, tool_id: -10 },
      { id: 11, tool_id: -11 },
    ])
    expect(
      db
        .prepare(
          'SELECT conversation_id, tool_id_legacy FROM conversation_legacy_tools ORDER BY conversation_id'
        )
        .all()
    ).toEqual([
      { conversation_id: 10, tool_id_legacy: 'context' },
      { conversation_id: 11, tool_id_legacy: 'custom-tool' },
    ])
  })

  it('migrates one selection group into one explicit session', () => {
    const release = selectionSessionRelease()
    expect(release?.version).toBe('2.3.0')
    if (!release) return
    const db = databaseAt220()
    insertConversation(db, { id: 10, selectionKey: 10, toolId: 1 })
    insertConversation(db, { id: 11, selectionKey: 10, toolId: 2 })
    insertMessage(db, { id: 20, conversationId: 11 })

    applyRelease(db, release)

    expect(db.prepare('SELECT * FROM selection_sessions').all()).toEqual([
      expect.objectContaining({ id: 10, active_conversation_id: 10 }),
    ])
    expect(
      db.prepare('SELECT id, selection_session_id FROM conversations ORDER BY id').all()
    ).toEqual([
      { id: 10, selection_session_id: 10 },
      { id: 11, selection_session_id: 10 },
    ])
    expect(db.prepare('SELECT conversation_id FROM messages WHERE id = 20').get()).toEqual({
      conversation_id: 11,
    })
  })

  it('enforces unique tools and cascades session deletion twice', () => {
    const db = migratedDatabase()
    expect(() => insertConversation(db, { selectionKey: 10, toolId: 1 })).toThrow()
    db.exec('DELETE FROM selection_sessions WHERE id = 10')
    expect(count(db, 'conversations')).toBe(0)
    expect(count(db, 'messages')).toBe(0)
  })
})
