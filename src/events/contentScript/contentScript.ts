/**
 * Content script event patterns.
 */

import type { MessageOneToOneEvent, OneToOneEvent } from '../types'
import { createInMemoryEvent, createMessageEvent } from '../internal/factories'
import { buildEventName } from '../event-name'

const cs2csFactory = createInMemoryEvent('cs2cs')

/**
 * Content script to content script (in-memory).
 * @example
 * ```ts
 * const event = cs2cs<string, number>('my-event')
 * event.handle(async (arg) => arg.length)
 * await event.dispatch('hello') // returns number
 * ```
 */
export const cs2cs = <Args = void, Return = void>(name: string): OneToOneEvent<Args, Return> =>
  cs2csFactory<Args, Return>(buildEventName('cs2cs', name))

/**
 * Content script to background (chrome.runtime.sendMessage).
 * @example
 * ```ts
 * const event = cs2bg<string, string>('test:cs-to-bg')
 * // In background: event.handle(async (arg) => 'bg received: ' + arg)
 * await event.dispatch('hello') // returns string
 * ```
 */
export const cs2bg = <Args = void, Return = void>(
  name: string
): MessageOneToOneEvent<Args, Return> =>
  createMessageEvent<Args, Return>(buildEventName('cs2bg', name))

/**
 * Content script to extension page (chrome.runtime.sendMessage).
 * @example
 * ```ts
 * const event = cs2ep<string, void>('notification:show')
 * await event.dispatch('Hello World')
 * // In extension page: event.handle(async (arg) => console.log('Received:', arg))
 * ```
 */
export const cs2ep = <Args = void, Return = void>(name: string): OneToOneEvent<Args, Return> =>
  createMessageEvent<Args, Return>(buildEventName('cs2ep', name), {
    senderFilter: (sender) => !sender.origin?.startsWith('chrome-extension://'),
  })
