import { DatabaseSync } from 'node:sqlite'
import {
  CONFIG_RELEASE,
  MESSAGE_THROUGHPUT_RELEASE,
  SCHEMA_RELEASE,
  TOOL_ID_RELEASE,
} from '@/offscreen/database/schema'
import type { DatabaseConnection, SqlParams, SqlValue } from '@/offscreen/database/store'

export interface NodeDb {
  db: DatabaseSync
  connection: DatabaseConnection
}

/**
 * ConfigStore emits positional `?` bindings only, and the vendored migration
 * DDL runs directly on the raw `db` (see createNodeDatabase), so every
 * statement that reaches the wrapper is single-statement SQL with positional
 * params. Named-object params would need name-binding this helper cannot
 * emulate faithfully — reject them rather than silently binding positionally.
 */
function toList(params: SqlParams | undefined): SqlValue[] {
  if (params === undefined) return []
  if (Array.isArray(params)) return params
  throw new Error('sqlite-helper does not support named-object parameters')
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
  db.exec(TOOL_ID_RELEASE.migrationSQL)
  db.exec(MESSAGE_THROUGHPUT_RELEASE.migrationSQL)

  const connection: DatabaseConnection = {
    async exec(sql, params) {
      // Uniform prepared path: statements without bindings run the same way,
      // returning real change counts instead of fabricating { changes: 0 }.
      const list = toList(params)
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
