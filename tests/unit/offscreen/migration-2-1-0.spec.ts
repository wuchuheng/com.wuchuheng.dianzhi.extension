// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { TOOL_ID_RELEASE } from '@/offscreen/database/schema'
import { createConfigStore } from '@/offscreen/database/config-store'
import { createNodeDatabase } from './sqlite-helper'

const clock = () => '2026-08-26T00:00:00.000Z'

describe('TOOL_ID_RELEASE 2.1.0', () => {
  it('declares a versioned release after 2.0.0', () => {
    expect(TOOL_ID_RELEASE.version).toBe('2.1.0')
    expect(TOOL_ID_RELEASE.migrationSQL).toContain('tool_floor_map')
    expect(TOOL_ID_RELEASE.migrationSQL).toContain('sqlite_sequence')
  })

  it('moves a pre-2.1.0 customer tool out of the reserved range and lets english insert at id 5', async () => {
    const { connection, db } = createNodeDatabase()
    const now = clock()
    // A pre-2.1.0 install: four presets plus a customer tool sitting at id 5.
    ;(
      [
        [1, '语境'],
        [2, '同义词'],
        [3, '翻译'],
        [4, '词典'],
      ] as const
    ).forEach(([id, name]) => {
      db.prepare(
        `INSERT INTO tools (id, name, prompt, is_preset, is_default, enabled, sort_order, deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, 1, 0, 1, ?, NULL, ?, ?)`
      ).run(id, name, 'p', id, now, now)
    })
    db.prepare(
      `INSERT INTO tools (id, name, prompt, is_preset, is_default, enabled, sort_order, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, 0, 0, 1, ?, NULL, ?, ?)`
    ).run(5, '旧自定义', 'p', 5, now, now)
    db.prepare(
      `INSERT INTO conversations (selection_key, tab_id, tool_id, tool_name, title, selected_text, context_text, prompt_snapshot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(0, 1, 5, '旧自定义', 't', 's', 'c', 'p', now, now)

    db.exec(TOOL_ID_RELEASE.migrationSQL)

    const moved = db.prepare('SELECT id FROM tools WHERE is_preset = 0 AND id >= 1025').get() as {
      id: number
    }
    expect(moved.id).toBe(1029)
    const conv = db.prepare('SELECT tool_id AS toolId FROM conversations').get() as {
      toolId: number
    }
    expect(conv.toolId).toBe(1029)
    const presetCount = db
      .prepare('SELECT COUNT(*) AS count FROM tools WHERE is_preset = 1')
      .get() as { count: number }
    expect(presetCount.count).toBe(4)

    // ensurePresets can now seed the english preset at id 5 without colliding.
    const config = createConfigStore(connection, clock)
    await config.ensurePresets()
    const english = db
      .prepare('SELECT COUNT(*) AS count FROM tools WHERE id = 5 AND is_preset = 1')
      .get() as { count: number }
    expect(english.count).toBe(1)
  })
})
