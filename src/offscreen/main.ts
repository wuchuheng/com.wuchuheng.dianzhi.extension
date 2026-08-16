import { databaseReady, databaseRequest } from '@/events/config'
import { log, logError, Scope } from '@/events/logger'
import openDB from '@/vendor/web-sqlite'
import { createDatabaseRpc } from './database/rpc'
import { SCHEMA_RELEASE } from './database/schema'
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
    releases: [SCHEMA_RELEASE],
  })) as DatabaseConnection
  await db.exec('PRAGMA foreign_keys = ON')

  const store = createConversationStore(db, () => new Date().toISOString())
  databaseRequest.handle(createDatabaseRpc(store))
  databaseReady.handle(async () => true)
  log(Scope.EXTENSION_PAGE, 'Dianzhi OPFS conversation database is ready')
}

void initialize().catch((error: unknown) => {
  logError(Scope.EXTENSION_PAGE, 'Dianzhi OPFS conversation database failed to initialize', error)
})
