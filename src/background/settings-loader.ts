import { DEFAULT_TOOLS, mergeSettings } from '@/dianzhi/domain/settings'
import { composeSettings } from '@/dianzhi/domain/settings'
import type { DianzhiSettings } from '@/dianzhi/domain/types'
import type { ToolRecord } from '@/offscreen/database/config-store'
import { composeSettingsSnapshot, settingsRowToBase } from './config-composer'

export interface SettingsLoaderDependencies {
  ensureMigrated(): Promise<void>
  getSettings(): Promise<string | null>
  listTools(includeRemoved: boolean): Promise<ToolRecord[]>
}

/**
 * Composes the runtime settings snapshot from the SQLite settings row plus the
 * active tool rows. Any failure (unavailable database, rejected RPC, malformed
 * row) degrades to the fully defaulted snapshot: reads never throw and no
 * writes are attempted against a missing database (spec §5).
 */
export function createSettingsLoader(deps: SettingsLoaderDependencies) {
  return async function loadSettings(): Promise<DianzhiSettings> {
    try {
      await deps.ensureMigrated()
      const raw = await deps.getSettings()
      const records = await deps.listTools(false)
      return composeSettingsSnapshot(settingsRowToBase(raw), records)
    } catch {
      // Spec §5: a missing or rejecting database degrades to the fully
      // defaulted snapshot; reads never throw and no writes are attempted.
      return composeSettings(mergeSettings(null), DEFAULT_TOOLS)
    }
  }
}
