/**
 * Extension page event patterns.
 */

import type { MessageOneToOneEvent } from '../types'
import { createMessageEvent } from '../internal/factories'
import { buildEventName } from '../event-name'

/**
 * Extension page to background (chrome.runtime.sendMessage).
 * @example
 * ```ts
 * const event = ep2bg<void, string>('fetch:data')
 * await event.dispatch() // returns string
 * // In background: event.handle(async () => 'data from background')
 * ```
 */
export const ep2bg = <Args = void, Return = void>(
  name: string
): MessageOneToOneEvent<Args, Return> =>
  createMessageEvent<Args, Return>(buildEventName('ep2bg', name), {
    senderFilter: (sender) => sender.origin?.startsWith('chrome-extension://') ?? false,
  })
