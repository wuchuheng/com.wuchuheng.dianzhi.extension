import { DianzhiError } from '@/dianzhi/domain/errors'
import { databaseReady, databaseRequest } from '@/events/config'
import type {
  DatabaseOperation,
  DatabaseOperationMap,
  DatabaseRequest,
  DatabaseResult,
} from '@/offscreen/database/rpc'

const OFFSCREEN_PATH = 'src/offscreen/index.html'
const DEFAULT_TIMEOUT_MS = 5_000

export interface OffscreenChromeApi {
  runtime: {
    getURL(path: string): string
    getContexts(filter: {
      contextTypes: chrome.runtime.ContextType[]
      documentUrls: string[]
    }): Promise<unknown[]>
  }
  offscreen: {
    createDocument(options: {
      url: string
      reasons: chrome.offscreen.Reason[] | string[]
      justification: string
    }): Promise<void>
  }
}

export interface TimerApi {
  setTimeout(callback: () => void, milliseconds: number): ReturnType<typeof setTimeout>
  clearTimeout(handle: ReturnType<typeof setTimeout>): void
}

export interface DatabaseRequestOptions {
  timeoutMs?: number
}

type DatabaseDispatcher = (request: DatabaseRequest) => Promise<DatabaseResult>
type ReadyDispatcher = () => Promise<true>

const defaultTimers: TimerApi = {
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => clearTimeout(handle),
}

function dbUnavailable(operation: string, error: unknown): DianzhiError {
  return new DianzhiError({
    code: 'DB_UNAVAILABLE',
    message: `The conversation database operation ${operation} failed.`,
    context: {
      operation,
      reason: error instanceof Error ? error.message.slice(0, 160) : String(error).slice(0, 160),
    },
  })
}

export function createOffscreenClient(
  chromeApi: OffscreenChromeApi,
  timers: TimerApi = defaultTimers,
  dispatch: DatabaseDispatcher = databaseRequest.dispatch,
  dispatchReady: ReadyDispatcher = () => databaseReady.dispatch(undefined)
) {
  let creation: Promise<void> | null = null
  let ready = false
  let nextRequestId = 0

  const wait = (milliseconds: number) =>
    new Promise<void>((resolve) => {
      timers.setTimeout(resolve, milliseconds)
    })

  async function waitUntilReady(): Promise<void> {
    let lastError: unknown
    for (let attempt = 0; attempt < 200; attempt += 1) {
      try {
        await dispatchReady()
        ready = true
        return
      } catch (error) {
        lastError = error
        await wait(50)
      }
    }
    throw dbUnavailable('databaseReady', lastError)
  }

  async function ensureDocument(): Promise<void> {
    if (ready) return
    if (creation) return creation
    const documentUrl = chromeApi.runtime.getURL(OFFSCREEN_PATH)
    creation = (async () => {
      const contexts = await chromeApi.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
        documentUrls: [documentUrl],
      })
      if (contexts.length === 0) {
        await chromeApi.offscreen.createDocument({
          url: documentUrl,
          reasons: ['WORKERS'],
          justification: 'Run the packaged SQLite OPFS worker for Dianzhi conversation storage.',
        })
      }
      await waitUntilReady()
    })().finally(() => {
      creation = null
    })
    return creation
  }

  async function dispatchWithTimeout(
    request: DatabaseRequest,
    timeoutMs: number
  ): Promise<DatabaseResult> {
    return new Promise<DatabaseResult>((resolve, reject) => {
      const timeout = timers.setTimeout(
        () => reject(new Error(`Database request timed out after ${timeoutMs}ms.`)),
        timeoutMs
      )
      dispatch(request).then(
        (result) => {
          timers.clearTimeout(timeout)
          resolve(result)
        },
        (error: unknown) => {
          timers.clearTimeout(timeout)
          reject(error)
        }
      )
    })
  }

  async function request<Operation extends DatabaseOperation>(
    operation: Operation,
    args: DatabaseOperationMap[Operation]['args'],
    options: DatabaseRequestOptions = {}
  ): Promise<DatabaseOperationMap[Operation]['result']> {
    await ensureDocument()
    const requestId = `db-${Date.now()}-${++nextRequestId}`
    const envelope = { requestId, operation, args } as DatabaseRequest
    const attempts =
      operation === 'getConversation' || operation === 'getSettings' || operation === 'listTools'
        ? 2
        : 1
    let lastError: unknown
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        if (attempt > 0) await ensureDocument()
        return (await dispatchWithTimeout(
          envelope,
          options.timeoutMs ?? DEFAULT_TIMEOUT_MS
        )) as DatabaseOperationMap[Operation]['result']
      } catch (error) {
        ready = false
        lastError = error
      }
    }
    throw dbUnavailable(operation, lastError)
  }

  return { ensureDocument, request }
}

export type OffscreenClient = ReturnType<typeof createOffscreenClient>
