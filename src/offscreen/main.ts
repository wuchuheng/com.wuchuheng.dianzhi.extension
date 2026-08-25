import { databaseReady, databaseRequest } from '@/events/config'
import { log, logError, Scope } from '@/events/logger'
import openDB from '@/vendor/web-sqlite'
import { createConfigStore } from './database/config-store'
import { createDatabaseRpc } from './database/rpc'
import { CONFIG_RELEASE, SCHEMA_RELEASE, TOOL_ID_RELEASE } from './database/schema'
import { createConversationStore, type DatabaseConnection } from './database/store'

function assertRuntimeCapabilities(): void {
  if (!globalThis.crossOriginIsolated) {
    throw new Error('The offscreen document is not cross-origin isolated.')
  }
  if (typeof globalThis.SharedArrayBuffer !== 'function') {
    throw new Error('SharedArrayBuffer is unavailable in the offscreen document.')
  }
  if (typeof navigator.storage?.getDirectory !== 'function') {
    throw new Error('The OPFS directory API is unavailable in the offscreen document.')
  }
}

async function initialize(): Promise<void> {
  assertRuntimeCapabilities()
  const db = (await openDB('dianzhi.sqlite3', {
    debug: false,
    releases: [SCHEMA_RELEASE, CONFIG_RELEASE, TOOL_ID_RELEASE],
  })) as DatabaseConnection
  await db.exec('PRAGMA foreign_keys = ON')

  const clock = () => new Date().toISOString()
  const store = createConversationStore(db, clock)
  const config = createConfigStore(db, clock)
  databaseRequest.handle(createDatabaseRpc({ conversation: store, config }))
  databaseReady.handle(async () => true)
  log(Scope.EXTENSION_PAGE, 'Dianzhi OPFS database is ready')
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-expect-error
  window.websqlite = db
}

void initialize().catch((error: unknown) => {
  logError(Scope.EXTENSION_PAGE, 'Dianzhi OPFS conversation database failed to initialize', error)
})
