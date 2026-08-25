import { DatabaseSync } from 'node:sqlite'
import { CONFIG_RELEASE, SCHEMA_RELEASE } from '@/offscreen/database/schema'
import type { DatabaseConnection, SqlParams, SqlValue } from '@/offscreen/database/store'

export interface NodeDb {
  db: DatabaseSync
  connection: DatabaseConnection
}

function toList(params: SqlParams | undefined): SqlValue[] {
  if (params === undefined) return []
  return Array.isArray(params) ? params : Object.values(params)
}

function bindValue(value: SqlValue): unknown {
  return typeof value === 'boolean' ? (value ? 1 : 0) : value
}

/**
 * Builds an in-memory SQLite database using the vendored release DDL and
 * wraps it in the app's DatabaseConnection contract so ConfigStore can run
 * against a real SQL engine in unit tests.
 */
export function createNodeDatabase(): NodeDb {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_RELEASE.migrationSQL)
  db.exec(CONFIG_RELEASE.migrationSQL)

  const connection: DatabaseConnection = {
    async exec(sql, params) {
      const list = toList(params)
      if (list.length === 0) {
        db.exec(sql)
        return { changes: 0 }
      }
      const stmt = db.prepare(sql)
      const info = stmt.run(...list.map(bindValue))
      return { changes: info.changes, lastInsertRowid: info.lastInsertRowid }
    },
    async query<T>(sql: string, params?: SqlParams): Promise<T[]> {
      const list = toList(params)
      const stmt = db.prepare(sql)
      return stmt.all(...list.map(bindValue)) as T[]
    },
    async transaction<T>(callback: (tx: DatabaseConnection) => Promise<T>): Promise<T> {
      db.exec('BEGIN')
      try {
        const result = await callback(connection)
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }

  return { db, connection }
}
