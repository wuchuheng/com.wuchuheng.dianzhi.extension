/** Primary DB interface used by client code. */
declare interface DBInterface {
  /**
   * Execute a SQL script (one or more statements) without returning rows.
   * Intended for migrations, schema setup, or bulk SQL execution.
   *
   * @param sql - SQL string to execute.
   * @param params - Optional bind parameters for the statement.
   * @returns Result metadata (changes, lastInsertRowid).
   *
   * @example
   * ```ts
   * await db.exec("CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)");
   * await db.exec("INSERT INTO users (name) VALUES (?)", ["Alice"]);
   * ```
   */
  exec(sql: string, params?: SQLParams): Promise<ExecResult>
  /**
   * Execute a query and return all result rows as an array of objects.
   *
   * @param sql - SELECT SQL to execute.
   * @param params - Optional bind parameters for the query.
   * @returns Array of result rows.
   *
   * @example
   * ```ts
   * const users = await db.query<{ id: number; name: string }>(
   *   "SELECT id, name FROM users WHERE id = ?",
   *   [1]
   * );
   * ```
   */
  query<T = unknown>(sql: string, params?: SQLParams): Promise<T[]>
  /**
   * Execute a transaction with automatic rollback on error.
   *
   * @param fn - Transaction callback receiving transaction interface.
   * @returns Result of the transaction callback.
   *
   * @example
   * ```ts
   * await db.transaction(async (tx) => {
   *   await tx.exec("INSERT INTO users (name) VALUES (?)", ["Bob"]);
   *   await tx.exec("INSERT INTO posts (title) VALUES (?)", ["Hello"]);
   * });
   * ```
   */
  transaction<T>(fn: transactionCallback<T>): Promise<T>
  /**
   * Close the database and release worker resources.
   *
   * @example
   * ```ts
   * await db.close();
   * ```
   */
  close(): Promise<void>
  /**
   * Register a callback for database logs (worker SQL execution logs).
   *
   * @param callback - Function to receive log entries.
   * @returns Unregister function.
   *
   * @example
   * ```ts
   * const unregister = db.onLog((log) => {
   *   console.log(`[${log.level}]`, log.data);
   * });
   * // Later: unregister();
   * ```
   */
  onLog(callback: (log: LogEntry) => void): () => void
  /**
   * Dev tooling for creating and managing dev versions.
   */
  devTool: DevTool
}

/**
 * Dev tooling interface for creating and rolling back dev versions.
 */
declare type DevTool = {
  /**
   * Create a new dev version with migration and seed SQL.
   *
   * @param input - Release config with version, migration SQL, and optional seed SQL.
   *
   * @example
   * ```ts
   * await db.devTool.release({
   *   version: "1.0.1",
   *   migrationSQL: "ALTER TABLE users ADD COLUMN email TEXT",
   *   seedSQL: "UPDATE users SET email = 'test@example.com' WHERE email IS NULL",
   * });
   * ```
   */
  release(input: ReleaseConfig): Promise<void>
  /**
   * Roll back to a target version and remove dev versions above it.
   */
  rollback(version: string): Promise<void>
}

/**
 * Metadata returned for non-query statements.
 * @property changes Number of rows changed by last operation (may be bigint on some builds).
 * @property lastInsertRowid Last inserted row id when applicable.
 */
declare type ExecResult = {
  changes?: number | bigint
  lastInsertRowid?: number | bigint
}

/**
 * Log entry with level and structured data
 */
declare type LogEntry = {
  /**
   * Log level: 'info' | 'debug' | 'error'
   */
  level: 'info' | 'debug' | 'error'
  /**
   * Log data (SQL, timing, errors, events, etc.)
   */
  data: unknown
}

/**
 * Opens a SQLite database connection with release-versioning support.
 *
 * @param filename - The base database name (directory is created in OPFS).
 * @param options - Optional release configuration and debug flag.
 * @returns A DBInterface for the latest active version.
 *
 * @throws Error if the filename is invalid, release config is invalid,
 * or an archived release hash does not match.
 */
declare const openDB: (filename: string, options?: OpenDBOptions) => Promise<DBInterface>
export default openDB
export { openDB }

/**
 * Options for opening a database.
 */
declare type OpenDBOptions = {
  /** Immutable release history configuration. */
  releases?: ReleaseConfig[]
  /** Enable SQL timing logs in the worker. */
  debug?: boolean
}

/**
 * Release configuration entry for versioned migrations.
 */
declare type ReleaseConfig = {
  /** Semantic version string "x.x.x" (no leading zeros). */
  version: string
  /** Migration SQL to apply for this version. */
  migrationSQL: string
  /** Optional seed SQL to apply after migration. */
  seedSQL?: string | null
}

/** A bindable parameter collection: positional or named. */
declare type SQLParams = SqlValue[] | Record<string, SqlValue>

/**
 * A value which can be bound to a SQLite parameter.
 */
declare type SqlValue = null | number | string | boolean | bigint | Uint8Array | ArrayBuffer

/**
 * Transaction interface passed to transaction callbacks.
 * All operations execute within the same transaction.
 */
declare interface Transaction {
  /**
   * Execute a SQL statement within the transaction.
   */
  exec(sql: string, params?: SQLParams): Promise<ExecResult>
  /**
   * Execute a query within the transaction.
   */
  query<T = unknown>(sql: string, params?: SQLParams): Promise<T[]>
}

/**
 * Transaction callback interface.
 * Provides exec and query methods scoped to the transaction.
 */
declare type transactionCallback<T> = (tx: Transaction) => Promise<T>

export {}
