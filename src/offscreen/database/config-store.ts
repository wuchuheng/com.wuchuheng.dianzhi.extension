import { DianzhiError } from '@/dianzhi/domain/errors'
import {
  BUILTIN_PROMPTS,
  BUILTIN_TOOL_IDS,
  BUILTIN_TOOL_NAMES,
  CUSTOM_TOOL_ID_START,
  PRESET_TOOL_IDS,
} from '@/dianzhi/domain/presets'
import { mergeSettings } from '@/dianzhi/domain/settings'
import type { DatabaseConnection, DatabaseExecutor, SqlValue } from './store'

export interface ToolRecord {
  id: number
  name: string
  prompt: string
  isPreset: boolean
  isDefault: boolean
  enabled: boolean
  sortOrder: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface LegacyToolInput {
  id: string
  name: string
  isBuiltin: boolean
  enabled: boolean
  prompt: string
}

/**
 * The version-1 document that lived at `chrome.storage.sync['dianzhi.settings']`.
 * The store validates every field itself; malformed sections degrade to their
 * defaults (spec §5: `tools.migrateLegacy | { legacySettings }`).
 */
export interface LegacySettingsDocument {
  version?: unknown
  provider?: unknown
  shortcuts?: unknown
  ui?: unknown
  tools?: unknown
}

export interface ConfigStore {
  listTools(includeRemoved?: boolean): Promise<ToolRecord[]>
  ensurePresets(): Promise<void>
  createTool(input: { name: string; prompt: string }): Promise<ToolRecord>
  updateTool(
    id: number,
    patch: { name?: string; prompt?: string; enabled?: boolean; isDefault?: boolean }
  ): Promise<ToolRecord>
  reorderTools(orderedIds: number[]): Promise<void>
  softRemoveTool(id: number): Promise<void>
  restoreTool(id: number): Promise<void>
  getSettings(): Promise<string | null>
  saveSettings(data: string): Promise<void>
  migrateLegacy(input: { legacySettings: LegacySettingsDocument }): Promise<Record<string, number>>
}

const TOOL_COLUMNS = `id, name, prompt, is_preset AS isPreset, is_default AS isDefault,
  enabled, sort_order AS sortOrder, deleted_at AS deletedAt, created_at AS createdAt, updated_at AS updatedAt`

const PRESET_INSERT_SQL = `INSERT INTO tools (
  id, name, prompt, is_preset, is_default, enabled, sort_order, deleted_at, created_at, updated_at
) VALUES (?, ?, ?, 1, 0, 1, (SELECT COALESCE(MAX(sort_order),0)+1 FROM tools WHERE deleted_at IS NULL), NULL, ?, ?)`

const CUSTOM_TOOL_INSERT_SQL = `INSERT INTO tools (
  id, name, prompt, is_preset, is_default, enabled, sort_order, deleted_at, created_at, updated_at
) VALUES (?, ?, ?, 0, 0, ?, ?, NULL, ?, ?)`

const GHOST_TOOL_INSERT_SQL = `INSERT INTO tools (
  id, name, prompt, is_preset, is_default, enabled, sort_order, deleted_at, created_at, updated_at
) VALUES (?, ?, ?, 0, 0, 0, 0, ?, ?, ?)`

const PRESET_TOOL_IDS_ORDERED: readonly number[] = BUILTIN_TOOL_IDS.map((id) => PRESET_TOOL_IDS[id])

const PRESET_ID_BY_NAME: Readonly<Record<string, number>> = Object.fromEntries(
  BUILTIN_TOOL_IDS.map((name) => [name, PRESET_TOOL_IDS[name]] as const)
) as Readonly<Record<string, number>>

function toolNotFound(id: number): DianzhiError {
  return new DianzhiError({
    code: 'TOOL_NOT_FOUND',
    message: 'The tool does not exist or is no longer available.',
    context: { id },
  })
}

/**
 * SQLite has no boolean type: the three flag columns read back as 0/1
 * integers. Normalize them to real booleans so `ToolRecord`'s contract holds
 * for every consumer (tool composition, rpc validation, Options rendering).
 */
function normalizeToolRow(row: ToolRecord): ToolRecord {
  const flags = row as unknown as { isPreset: number; isDefault: number; enabled: number }
  return {
    ...row,
    isPreset: flags.isPreset === 1,
    isDefault: flags.isDefault === 1,
    enabled: flags.enabled === 1,
  }
}

function freezeTools(rows: readonly ToolRecord[]): ToolRecord[] {
  return Object.freeze(
    rows.map((row) => Object.freeze(normalizeToolRow(row)))
  ) as unknown as ToolRecord[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Converts one legacy storage tool item (v1 shape: `builtin`, `promptMode`,
 * `customPrompt`) into the {@link LegacyToolInput} shape the migration expects
 * (`isBuiltin`, `prompt`). Malformed items are dropped.
 */
function toLegacyToolInput(value: unknown): LegacyToolInput | null {
  if (!isRecord(value)) return null
  if (typeof value.id !== 'string' || value.id.trim().length === 0) return null
  if (typeof value.name !== 'string') return null
  if (typeof value.builtin !== 'boolean') return null
  if (typeof value.enabled !== 'boolean') return null
  return {
    id: value.id,
    name: value.name,
    isBuiltin: value.builtin,
    enabled: value.enabled,
    prompt: typeof value.customPrompt === 'string' ? value.customPrompt : '',
  }
}

function legacyDefaultToolId(value: unknown): string | null {
  if (!isRecord(value) || typeof value.defaultToolId !== 'string') return null
  return value.defaultToolId
}

function presetIdForLegacy(id: string): number | undefined {
  return PRESET_ID_BY_NAME[id]
}

async function ensurePresetsInner(
  tx: DatabaseExecutor,
  now: string,
  applyDefault: boolean
): Promise<void> {
  const present = await tx.query<{ id: number }>(
    `SELECT id FROM tools WHERE id IN (${PRESET_TOOL_IDS_ORDERED.map(() => '?').join(', ')})`,
    [...PRESET_TOOL_IDS_ORDERED]
  )
  const presentIds = new Set(present.map((row) => row.id))
  for (const builtinId of BUILTIN_TOOL_IDS) {
    const id = PRESET_TOOL_IDS[builtinId]
    if (presentIds.has(id)) continue
    await tx.exec(PRESET_INSERT_SQL, [
      id,
      BUILTIN_TOOL_NAMES[builtinId],
      BUILTIN_PROMPTS[builtinId],
      now,
      now,
    ])
  }
  if (!applyDefault) return
  const defaults = await tx.query<{ count: number }>(
    'SELECT COUNT(*) AS count FROM tools WHERE is_default = 1 AND deleted_at IS NULL'
  )
  if (Number(defaults[0]?.count ?? 0) === 0) {
    await tx.exec('UPDATE tools SET is_default = 1, updated_at = ? WHERE id = ?', [
      now,
      PRESET_TOOL_IDS.context,
    ])
  }
}

export function createConfigStore(db: DatabaseConnection, clock: () => string): ConfigStore {
  async function listTools(includeRemoved = false): Promise<ToolRecord[]> {
    const rows = await db.query<ToolRecord>(
      includeRemoved
        ? `SELECT ${TOOL_COLUMNS} FROM tools ORDER BY sort_order`
        : `SELECT ${TOOL_COLUMNS} FROM tools WHERE deleted_at IS NULL ORDER BY sort_order`
    )
    return freezeTools(rows)
  }

  async function ensurePresets(): Promise<void> {
    const now = clock()
    await db.transaction((tx) => ensurePresetsInner(tx, now, true))
  }

  async function createTool(input: { name: string; prompt: string }): Promise<ToolRecord> {
    const now = clock()
    const id = await db.transaction(async (tx) => {
      const rows = await tx.query<{ maxId: number }>(
        'SELECT COALESCE(MAX(id), 0) AS maxId FROM tools'
      )
      const id = Math.max(CUSTOM_TOOL_ID_START, (rows[0]?.maxId ?? 0) + 1)
      await tx.exec(
        `INSERT INTO tools (id, name, prompt, is_preset, is_default, enabled, sort_order, deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, 0, 0, 1, (SELECT COALESCE(MAX(sort_order),0)+1 FROM tools WHERE deleted_at IS NULL), NULL, ?, ?)`,
        [id, input.name, input.prompt, now, now]
      )
      return id
    })
    const rows = await db.query<ToolRecord>(`SELECT ${TOOL_COLUMNS} FROM tools WHERE id = ?`, [id])
    const row = rows[0]
    if (!row) throw toolNotFound(id)
    return Object.freeze(normalizeToolRow(row))
  }

  async function updateTool(
    id: number,
    patch: { name?: string; prompt?: string; enabled?: boolean; isDefault?: boolean }
  ): Promise<ToolRecord> {
    const now = clock()
    await db.transaction(async (tx) => {
      if (patch.enabled === false) {
        const current = await tx.query<ToolRecord>(
          `SELECT ${TOOL_COLUMNS} FROM tools WHERE id = ?`,
          [id]
        )
        const row = current[0]
        if (!row) throw toolNotFound(id)
        if (row.enabled) {
          const remaining = await tx.query<{ count: number }>(
            'SELECT COUNT(*) AS count FROM tools WHERE enabled = 1 AND deleted_at IS NULL AND id != ?',
            [id]
          )
          if (Number(remaining[0]?.count ?? 0) === 0) {
            throw new DianzhiError({
              code: 'TOOL_LAST_ENABLED',
              message: 'At least one tool must remain enabled.',
              context: { id },
            })
          }
        }
      }
      if (patch.isDefault === true) {
        await tx.exec('UPDATE tools SET is_default = 0 WHERE is_default = 1')
      }
      const sets: string[] = []
      const params: SqlValue[] = []
      if (patch.name !== undefined) {
        sets.push('name = ?')
        params.push(patch.name)
      }
      if (patch.prompt !== undefined) {
        sets.push('prompt = ?')
        params.push(patch.prompt)
      }
      if (patch.enabled !== undefined) {
        sets.push(patch.enabled ? 'enabled = 1' : 'enabled = 0')
      }
      if (patch.isDefault !== undefined) {
        sets.push(patch.isDefault ? 'is_default = 1' : 'is_default = 0')
      }
      if (sets.length === 0) {
        const touched = await tx.exec('UPDATE tools SET updated_at = ? WHERE id = ?', [now, id])
        if (Number(touched.changes ?? 0) !== 1) throw toolNotFound(id)
        return
      }
      const result = await tx.exec(
        `UPDATE tools SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`,
        [...params, now, id]
      )
      if (Number(result.changes ?? 0) !== 1) throw toolNotFound(id)
    })
    const rows = await db.query<ToolRecord>(`SELECT ${TOOL_COLUMNS} FROM tools WHERE id = ?`, [id])
    const row = rows[0]
    if (!row) throw toolNotFound(id)
    return Object.freeze(normalizeToolRow(row))
  }

  async function reorderTools(orderedIds: number[]): Promise<void> {
    const now = clock()
    await db.transaction(async (tx) => {
      const rows = await tx.query<ToolRecord>(
        `SELECT ${TOOL_COLUMNS} FROM tools WHERE deleted_at IS NULL ORDER BY sort_order`
      )
      const activeIds = rows.map((row) => row.id)
      const activeSet = new Set(activeIds)
      if (orderedIds.length !== activeIds.length || orderedIds.some((id) => !activeSet.has(id))) {
        throw new DianzhiError({
          code: 'TOOL_ORDER_INVALID',
          message: 'The reorder list must exactly match the active tools.',
          context: { expected: activeIds.length, received: orderedIds.length },
        })
      }
      for (let index = 0; index < orderedIds.length; index += 1) {
        await tx.exec('UPDATE tools SET sort_order = ? WHERE id = ?', [
          100000 + index,
          orderedIds[index],
        ])
      }
      for (let index = 0; index < orderedIds.length; index += 1) {
        await tx.exec('UPDATE tools SET sort_order = ?, updated_at = ? WHERE id = ?', [
          index + 1,
          now,
          orderedIds[index],
        ])
      }
    })
  }

  async function softRemoveTool(id: number): Promise<void> {
    if (PRESET_TOOL_IDS_ORDERED.includes(id)) {
      throw new DianzhiError({
        code: 'TOOL_PRESET_INVALID',
        message: 'Built-in preset tools cannot be removed.',
        context: { id },
      })
    }
    const rows = await db.query<{ deletedAt: string | null }>(
      'SELECT deleted_at AS deletedAt FROM tools WHERE id = ?',
      [id]
    )
    const row = rows[0]
    if (!row || row.deletedAt !== null) throw toolNotFound(id)
    const now = clock()
    await db.exec('UPDATE tools SET deleted_at = ?, is_default = 0, updated_at = ? WHERE id = ?', [
      now,
      now,
      id,
    ])
  }

  async function restoreTool(id: number): Promise<void> {
    const rows = await db.query<{ deletedAt: string | null }>(
      'SELECT deleted_at AS deletedAt FROM tools WHERE id = ?',
      [id]
    )
    const row = rows[0]
    if (!row) throw toolNotFound(id)
    if (row.deletedAt === null) return
    const now = clock()
    await db.exec(
      `UPDATE tools SET deleted_at = NULL,
       sort_order = (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM tools WHERE deleted_at IS NULL),
       updated_at = ? WHERE id = ?`,
      [now, id]
    )
  }

  async function getSettings(): Promise<string | null> {
    const rows = await db.query<{ data: string }>('SELECT data FROM settings WHERE id = 1')
    return rows[0]?.data ?? null
  }

  async function saveSettings(data: string): Promise<void> {
    await db.exec(
      'INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
      [data]
    )
  }

  async function migrateLegacy(input: {
    legacySettings: LegacySettingsDocument
  }): Promise<Record<string, number>> {
    const now = clock()
    const legacyTools = Array.isArray(input.legacySettings.tools)
      ? input.legacySettings.tools
          .map(toLegacyToolInput)
          .filter((tool): tool is LegacyToolInput => tool !== null)
      : []
    const defaultToolId = legacyDefaultToolId(input.legacySettings.ui)

    const mapping: Record<string, number> = {}
    return db.transaction(async (tx) => {
      await ensurePresetsInner(tx, now, false)

      const existing = new Set(
        (await tx.query<{ id: number }>('SELECT id FROM tools')).map((row) => row.id)
      )

      for (const builtinId of BUILTIN_TOOL_IDS) {
        mapping[builtinId] = PRESET_TOOL_IDS[builtinId]
      }

      let nextId = CUSTOM_TOOL_ID_START
      const usedIds = new Set<number>([...PRESET_TOOL_IDS_ORDERED])
      for (const legacyTool of legacyTools) {
        const presetId = presetIdForLegacy(legacyTool.id)
        if (presetId !== undefined) {
          // Spec §5: sync preset rows' name/enabled state from the legacy array.
          mapping[legacyTool.id] = presetId
          await tx.exec(
            'UPDATE tools SET name = ?, enabled = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL',
            [legacyTool.name, legacyTool.enabled ? 1 : 0, now, presetId]
          )
          continue
        }
        if (mapping[legacyTool.id] !== undefined) continue
        while (usedIds.has(nextId) || existing.has(nextId)) nextId += 1
        mapping[legacyTool.id] = nextId
        usedIds.add(nextId)
        nextId += 1
        await tx.exec(CUSTOM_TOOL_INSERT_SQL, [
          mapping[legacyTool.id],
          legacyTool.name,
          legacyTool.prompt,
          legacyTool.enabled ? 1 : 0,
          mapping[legacyTool.id],
          now,
          now,
        ])
      }

      const ghostRows = await tx.query<{ tool_id_legacy: string }>(
        'SELECT DISTINCT tool_id_legacy FROM conversations WHERE tool_id_legacy IS NOT NULL'
      )
      for (const row of ghostRows) {
        const legacy = row.tool_id_legacy
        if (mapping[legacy] !== undefined) continue
        while (usedIds.has(nextId) || existing.has(nextId)) nextId += 1
        mapping[legacy] = nextId
        usedIds.add(nextId)
        nextId += 1
        await tx.exec(GHOST_TOOL_INSERT_SQL, [mapping[legacy], legacy, '', now, now, now])
      }

      for (const [legacy, id] of Object.entries(mapping)) {
        await tx.exec('UPDATE conversations SET tool_id = ? WHERE tool_id_legacy = ?', [id, legacy])
      }
      await tx.exec(
        'UPDATE conversations SET tool_id_legacy = NULL WHERE tool_id_legacy IS NOT NULL'
      )

      // Tool ids are now distinct per (selection_key, tool_id): v1's unique
      // pair used TEXT tool ids and the mapping is injective per selection, so
      // the reconstructed table is unique. The constraint was deferred out of
      // the 2.0.0 rebuild (which stages every legacy row at tool_id = 0); create
      // it now, before any conversation upsert can rely on it.
      await tx.exec(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_conversations_selection_tool ON conversations(selection_key, tool_id)'
      )

      await tx.exec('UPDATE tools SET is_default = 0 WHERE is_default = 1 AND deleted_at IS NULL')
      if (defaultToolId !== null) {
        const defaultId = mapping[defaultToolId]
        if (defaultId !== undefined) {
          await tx.exec('UPDATE tools SET is_default = 1 WHERE id = ?', [defaultId])
        }
      }

      // Spec §5: upsert the settings row from legacy provider + shortcuts + ui
      // (minus defaultToolId, minus tools). A stale row (crash between commit
      // and sync-key clear) is overwritten with the same merged document, so
      // re-runs stay idempotent.
      await tx.exec(
        'INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data',
        [JSON.stringify(mergeSettings(input.legacySettings))]
      )
      return mapping
    })
  }

  return {
    listTools,
    ensurePresets,
    createTool,
    updateTool,
    reorderTools,
    softRemoveTool,
    restoreTool,
    getSettings,
    saveSettings,
    migrateLegacy,
  }
}
