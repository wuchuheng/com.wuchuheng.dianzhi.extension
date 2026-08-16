/**
 * Factory functions for creating event patterns.
 * Eliminates duplication across event types.
 */

import type {
  CallBack,
  MessageOneToOneEvent,
  OneToOneEvent,
  OneToManyEvent,
  PortMessageFormat,
  PortResponseFormat,
} from '../types'
import { CallbackMap } from './callback-map'
import {
  sendMessage,
  registerMessageListener,
  registerSenderAwareMessageListener,
  errorToPortResponse,
  EP2CS_TIMEOUT_MS,
} from './messaging'
import { generateMsgId } from './port-relay'
import { log, logWarn, Scope } from '../logger'
import { getGlobalStorage } from './global-storage'

declare global {
  var cs2csCallbacks: CallbackMap
  var bg2bgCallbacks: CallbackMap
}

const CS2CS_KEY = 'cs2csCallbacks'
const BG2BG_KEY = 'bg2bgCallbacks'

/**
 * Gets the content script to content script callback map.
 */
function getCs2csCallbacks(): CallbackMap {
  return getGlobalStorage(CS2CS_KEY, () => new CallbackMap())
}

/**
 * Gets the background to background callback map.
 */
function getBg2bgCallbacks(): CallbackMap {
  return getGlobalStorage(BG2BG_KEY, () => new CallbackMap())
}

/**
 * Storage key configuration for in-memory events.
 */
const IN_MEMORY_STORAGE = {
  cs2cs: getCs2csCallbacks,
  bg2bg: getBg2bgCallbacks,
} as const

/**
 * Creates an in-memory one-to-one event (for cs2cs, bg2bg).
 * Uses globalThis for callback storage.
 *
 * @param storageKey - The key for the callback storage
 * @returns A function that creates an event for the given storage type
 */
export function createInMemoryEvent(
  storageKey: keyof typeof IN_MEMORY_STORAGE
): <Args = void, Return = void>(name: string) => OneToOneEvent<Args, Return> {
  const getStorage = IN_MEMORY_STORAGE[storageKey]
  return <Args = void, Return = void>(name: string): OneToOneEvent<Args, Return> => ({
    dispatch: async (args: Args) => {
      const callback = getStorage().getFirst<Args, Return>(name)
      if (!callback) throw new Error(`No handler registered for event: ${name}`)
      return callback(args)
    },
    handle: (callback: CallBack<Args, Return>) => getStorage().register(name, callback),
  })
}

/**
 * Creates a sendMessage-based one-to-one event (for cs2bg, cs2ep, ep2bg, bg2ep).
 */
export function createMessageEvent<Args = void, Return = void>(
  name: string,
  options?: {
    dispatch?: (args: Args) => Promise<Return>
    senderFilter?: (sender: chrome.runtime.MessageSender) => boolean
  }
): MessageOneToOneEvent<Args, Return> {
  const dispatchFn = options?.dispatch ?? ((args: Args) => sendMessage<Args, Return>(name, args))
  return {
    dispatch: dispatchFn,
    handle: (callback) =>
      registerMessageListener<Args, Return>(name, callback, {
        senderFilter: options?.senderFilter,
      }),
    handleWithSender: (callback) =>
      registerSenderAwareMessageListener<Args, Return>(name, callback, {
        senderFilter: options?.senderFilter,
      }),
  }
}

/**
 * Creates a port-based relay handler (for ep2cs in content scripts).
 * Auto-connects to background relay service on first handle() call.
 */
export function createPortHandler<Args = void, Return = void>(
  name: string
): OneToManyEvent<Args, Return>['handle'] {
  const connectionName = `ep2cs:${name}`
  let port: chrome.runtime.Port | null = null
  let isConnected = false

  return (callback: CallBack<Args, Return>) => {
    if (!isConnected) {
      port = chrome.runtime.connect({ name: connectionName })
      isConnected = true

      port.onMessage.addListener(async (msg: PortMessageFormat<Args>) => {
        const { msgId, event, args } = msg
        if (event !== name) return

        const response: PortResponseFormat<Return> = { msgId }
        try {
          response.data = await callback(args)
        } catch (error) {
          response.error = errorToPortResponse(error)
        }
        port?.postMessage(response)
      })

      port.onDisconnect.addListener(() => {
        isConnected = false
        port = null
      })
    }

    return () => {
      port?.disconnect()
      isConnected = false
      port = null
    }
  }
}

/**
 * Creates a port-based relay dispatcher (for ep2cs in extension pages).
 * Connects to background relay service and aggregates responses.
 */
export function createPortDispatcher<Args = void, Return = void>(
  name: string
): OneToManyEvent<Args, Return>['dispatch'] {
  const connectionName = `ep2cs:${name}`

  return async (args: Args): Promise<Return[]> => {
    const msgId = generateMsgId()
    log(Scope.EXTENSION_PAGE, `[ep2cs] Dispatching event '${name}' with msgId: ${msgId}`)

    const port = chrome.runtime.connect({ name: connectionName })

    return new Promise<Return[]>((resolve, reject) => {
      const timeout = setTimeout(() => {
        port.disconnect()
        reject(new Error(`ep2cs: Timeout waiting for response for event '${name}'`))
      }, EP2CS_TIMEOUT_MS)

      const responses: Return[] = []

      port.onMessage.addListener((msg: PortResponseFormat<Return>) => {
        if (msg.msgId !== msgId) return

        clearTimeout(timeout)

        if (msg.error) {
          reject(new Error(msg.error.message))
          port.disconnect()
          return
        }

        if (msg.data !== undefined) {
          responses.push(msg.data)
        }

        if (Array.isArray(msg.data)) {
          resolve(msg.data as unknown as Return[])
          port.disconnect()
        }
      })

      port.onDisconnect.addListener(() => {
        clearTimeout(timeout)
        if (responses.length === 0) {
          logWarn(Scope.EXTENSION_PAGE, `[ep2cs] No content scripts responded to event '${name}'`)
          resolve([])
        }
      })

      const portMsg: PortMessageFormat<Args> = { msgId, event: name, args }
      port.postMessage(portMsg)
    })
  }
}
