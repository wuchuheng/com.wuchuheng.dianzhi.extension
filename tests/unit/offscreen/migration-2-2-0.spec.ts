// @vitest-environment node
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import * as schema from '@/offscreen/database/schema'

type ThroughputRelease = { version: string; migrationSQL: string }

describe('MESSAGE_THROUGHPUT_RELEASE 2.2.0', () => {
  it('adds a nullable estimated throughput column to existing messages', () => {
    const release = (schema as typeof schema & { MESSAGE_THROUGHPUT_RELEASE?: ThroughputRelease })
      .MESSAGE_THROUGHPUT_RELEASE
    expect(release?.version).toBe('2.2.0')
    if (!release) return

    const db = new DatabaseSync(':memory:')
    db.exec(schema.SCHEMA_RELEASE.migrationSQL)
    db.exec(schema.CONFIG_RELEASE.migrationSQL)
    db.exec(schema.TOOL_ID_RELEASE.migrationSQL)
    db.exec(`
      INSERT INTO conversations (
        selection_key, tab_id, tool_id, tool_name, title, selected_text,
        context_text, prompt_snapshot, created_at, updated_at
      ) VALUES (1, 9, 1, '词典', 'run', 'run', 'run fast', 'Explain run', '2026-08-27', '2026-08-27');
      INSERT INTO messages (
        conversation_id, sequence, role, content, reasoning_content, status,
        error_code, error_message, created_at, updated_at
      ) VALUES (1, 1, 'assistant', 'hello', '', 'completed', NULL, NULL, '2026-08-27', '2026-08-27');
    `)

    db.exec(release.migrationSQL)

    const row = db
      .prepare('SELECT estimated_throughput_tps AS value FROM messages WHERE id = 1')
      .get() as { value: number | null }
    expect(row.value).toBeNull()
  })
})
