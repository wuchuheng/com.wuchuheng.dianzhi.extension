import { sayHelloFromOffToCS } from '@/events/config'
import openDB from '@/vendor/web-sqlite'

console.log('[offscreen] Offscreen document loaded')

let dbPromise: ReturnType<typeof openDB> | null = null

async function getDB(): ReturnType<typeof openDB> {
  if (dbPromise) {
    return dbPromise
  }

  try {
    dbPromise = openDB('db.sqlite3', {
      debug: true,
      releases: [
        {
          version: '0.0.1',
          migrationSQL: `
            CREATE TABLE IF NOT EXISTS logs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              level TEXT,
              message TEXT,
              agentId TEXT,
              timestamp TEXT
            )`,
        },
      ],
    })

    console.log('[offscreen] Initialized database in offscreen')

    return await dbPromise
  } catch (err) {
    console.error('Failed to initialize database in offscreen', err)
    dbPromise = null
    throw err
  }
}

// Initialize database on load
getDB().catch((err) => {
  console.error('[offscreen] Failed to initialize database:', err)
})

let counter = 0
setInterval(() => {
  const content = `Hi, ${counter++}`
  console.log('[offscreen] Sending message to content script:', content)
  sayHelloFromOffToCS.dispatch(content)
}, 1000 * 5)
