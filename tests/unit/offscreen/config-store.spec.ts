// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { createConfigStore } from '@/offscreen/database/config-store'
import { createNodeDatabase } from './sqlite-helper'

const clock = () => '2026-08-26T00:00:00.000Z'

describe('ConfigStore customer-tool ID allocation', () => {
  it('allocates customer tool ids starting at 1025', async () => {
    const { connection } = createNodeDatabase()
    const config = createConfigStore(connection, clock)
    await config.ensurePresets()
    const first = await config.createTool({ name: '自定义1', prompt: 'p1' })
    expect(first.id).toBe(1025)
    const second = await config.createTool({ name: '自定义2', prompt: 'p2' })
    expect(second.id).toBe(first.id + 1)
  })

  it('never returns a preset-range id even when the max row id is small', async () => {
    const { connection, db } = createNodeDatabase()
    const now = clock()
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
    const config = createConfigStore(connection, clock)
    const tool = await config.createTool({ name: '自定义', prompt: 'p' })
    expect(tool.id).toBeGreaterThanOrEqual(1025)
  })

  it('maps legacy custom tools onto ids >= 1025 and rewires conversations', async () => {
    const { connection, db } = createNodeDatabase()
    const now = clock()
    db.prepare(
      `INSERT INTO conversations (selection_key, tab_id, tool_id, tool_id_legacy, tool_name, title, selected_text, context_text, prompt_snapshot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(0, 1, 0, 'myCustom', '我的工具', 't', 's', 'c', 'p', now, now)
    const config = createConfigStore(connection, clock)
    const mapping = await config.migrateLegacy({
      legacySettings: {
        version: 1,
        ui: { defaultToolId: 'context' },
        tools: [
          {
            id: 'myCustom',
            name: '我的工具',
            builtin: false,
            enabled: true,
            customPrompt: 'hello',
          },
        ],
      },
    })
    expect(mapping.myCustom).toBe(1025)
    const row = db
      .prepare('SELECT is_preset AS isPreset FROM tools WHERE id = ?')
      .get(mapping.myCustom) as { isPreset: number }
    expect(row.isPreset).toBe(0)
    const conv = db
      .prepare('SELECT tool_id AS toolId, tool_id_legacy AS toolIdLegacy FROM conversations')
      .get() as { toolId: number; toolIdLegacy: string | null }
    expect(conv.toolId).toBe(mapping.myCustom)
    expect(conv.toolIdLegacy).toBeNull()
  })

  it('does not reuse ids after soft removal', async () => {
    const { connection } = createNodeDatabase()
    const config = createConfigStore(connection, clock)
    await config.ensurePresets()
    const first = await config.createTool({ name: '自定义A', prompt: 'p' })
    expect(first.id).toBe(1025)
    await config.softRemoveTool(1025)
    const second = await config.createTool({ name: '自定义B', prompt: 'p' })
    expect(second.id).toBe(1026)
  })
})
