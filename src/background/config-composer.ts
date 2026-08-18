import {
  composeSettings,
  mergeSettings,
  rowDataFromSettings,
  toToolDefinition,
} from '@/dianzhi/domain/settings'
import type { DianzhiSettings, SettingsRowData } from '@/dianzhi/domain/types'
import type { ToolRecord } from '@/offscreen/database/config-store'

export { rowDataFromSettings, toToolDefinition }

/**
 * Converts the raw JSON stored in the single-row `settings` table into a
 * version-2 row document. Any parse failure falls back to defaults so a
 * corrupted row can never break settings composition.
 * @param raw - The JSON string stored at `settings.id = 1`, or null when unset.
 * @returns A merged, version-pinned row document.
 */
export function settingsRowToBase(raw: string | null): SettingsRowData {
  if (raw === null) return mergeSettings(null)
  try {
    return mergeSettings(JSON.parse(raw) as unknown)
  } catch {
    return mergeSettings(null)
  }
}

/**
 * Composes a runtime settings snapshot from the row document plus every tool
 * row, resolving `ui.defaultToolId` from the default-enabled tool.
 * @param base - Version-2 provider/shortcuts/ui row document.
 * @param records - Tool rows from the config store, in display order.
 * @returns The composed snapshot used by options, content, and side panel.
 */
export async function composeSettingsSnapshot(
  base: SettingsRowData,
  records: ToolRecord[]
): Promise<DianzhiSettings> {
  return composeSettings(base, records.map(toToolDefinition))
}
