/**
 * Background event patterns.
 */

import type { OneToOneEvent } from '../types'
import { createInMemoryEvent, createMessageEvent } from '../internal/factories'
import { sendMessageToTab } from '../internal/messaging'
import { parseArgsAndTabId } from '../internal/parse-tab-id'
import { buildEventName } from '../event-name'
import {
  initializeRelayStorage,
  extractEventName,
  isExtensionPage,
  isContentScript,
  handleExtensionPageConnection,
  handleContentScriptConnection,
} from '../internal/port-relay'
import { log, Scope } from '../logger'

const bg2bgFactory = createInMemoryEvent('bg2bg')

/**
 * Background to background (in-memory).
 * @example
 * ```ts
 * const event = bg2bg<string, void>('storage:updated')
 * event.handle(async (arg) => log(Scope.BACKGROUND, 'Updated:', arg))
 * await event.dispatch('key changed')
 * ```
 */
export const bg2bg = <Args = void, Return = void>(name: string): OneToOneEvent<Args, Return> =>
  bg2bgFactory<Args, Return>(buildEventName('bg2bg', name))

/**
 * Background to content script (chrome.tabs.sendMessage).
 * @example
 * ```ts
 * const event = bg2cs<number, void>('refresh')
 * await event.dispatch({ tabId: 123, data: 42 })
 * // or: await event.dispatch([42, 123])
 * ```
 */
export const bg2cs = <Args = void, Return = void>(name: string) => {
  type DispatchArgs = (Args & { tabId: number }) | [Args, number]
  type Bg2CsEvent = Omit<OneToOneEvent<Args, Return>, 'dispatch'> & {
    dispatch: (argsAndTabId: DispatchArgs) => Promise<Return>
  }

  const eventName = buildEventName('bg2cs', name)
  const event: Bg2CsEvent = {
    dispatch: async (argsAndTabId: DispatchArgs) => {
      const [args, tabId] = parseArgsAndTabId<Args>(argsAndTabId)
      return sendMessageToTab<Args, Return>(eventName, args, tabId)
    },
    handle: createMessageEvent<Args, Return>(eventName).handle,
  }

  return event
}

export function isPrivilegedExtensionSender(sender: chrome.runtime.MessageSender): boolean {
  return (
    sender.id === chrome.runtime.id &&
    !sender.tab &&
    (!sender.origin || sender.origin.startsWith('chrome-extension://'))
  )
}

/**
 * Background to extension page (chrome.runtime.sendMessage).
 * @example
 * ```ts
 * const event = bg2ep<number, void>('badge:update')
 * await event.dispatch(5)
 * // In extension page: event.handle(async (arg) => console.log('Badge count:', arg))
 * ```
 */
export const bg2ep = <Args = void, Return = void>(name: string): OneToOneEvent<Args, Return> =>
  createMessageEvent<Args, Return>(buildEventName('bg2ep', name), {
    senderFilter: isPrivilegedExtensionSender,
  })

/**
 * Relay service for ep2cs (extension page to content script).
 * Call this once when the background script initializes.
 * @example
 * ```ts
 * relayService()
 * ```
 */
export const relayService = () => {
  initializeRelayStorage()

  chrome.runtime.onConnect.addListener((port) => {
    const eventName = extractEventName(port.name)
    if (!eventName) return

    log(Scope.BACKGROUND, `[relayService] Port connected for event: ${eventName}`)

    if (isExtensionPage(port)) {
      handleExtensionPageConnection(port, eventName)
    } else if (isContentScript(port)) {
      handleContentScriptConnection(port, eventName)
    }
  })

  log(Scope.BACKGROUND, '[relayService] Service started')
}
