import type {
  ConfigStore,
  LegacySettingsDocument,
  ToolRecord,
} from '@/offscreen/database/config-store'

export interface MigrationDependencies {
  getSettings(): Promise<string | null>
  listTools(includeRemoved: boolean): Promise<ToolRecord[]>
  ensurePresets(): Promise<void>
  migrateLegacy(input: Parameters<ConfigStore['migrateLegacy']>[0]): Promise<Record<string, number>>
  readLegacySettings(): Promise<unknown>
  clearLegacySettings(): Promise<void>
}

/**
 * Coordinates the one-time legacy migration from `chrome.storage.sync`
 * (`dianzhi.settings`, the v1 document) into the SQLite config tables, then
 * clears the sync key only after the commit succeeds.
 *
 * The running guard makes the migration at-most-once per background life:
 * `ensureMigrated` is invoked on every settings read and every tools command,
 * but the store ops are additionally idempotent (presets are never
 * re-inserted; conversation re-points are guarded by the consumed legacy-tool
 * staging data; the settings row is upserted from the same
 * document).
 */
export function createMigrationCoordinator(deps: MigrationDependencies) {
  let done = false
  return {
    async ensureMigrated(): Promise<void> {
      if (done) return
      await deps.ensurePresets()
      const legacy = await deps.readLegacySettings()
      if (legacy === undefined) {
        done = true
        return
      }
      await deps.migrateLegacy({ legacySettings: legacy as LegacySettingsDocument })
      await deps.clearLegacySettings()
      done = true
    },
  }
}
