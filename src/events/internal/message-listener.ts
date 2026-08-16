/**
 * Factory for creating chrome.runtime.onMessage listeners.
 * Eliminates duplication across event patterns.
 */

import type { MessageFormat, SenderAwareCallback } from '../types'
import { errorToResponse } from './messaging'

export type MessageListenerCallback<Args, Return> = (
  request: MessageFormat<Args, Return>,
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: MessageFormat<Args, Return>['response']) => void
) => boolean

/**
 * Creates a message listener for a specific event name.
 *
 * @param eventName - The event name to listen for
 * @param options - Optional sender filter function
 * @returns A listener callback that can be passed to chrome.runtime.onMessage.addListener
 */
export function createMessageListener<Args = void, Return = void>(
  eventName: string,
  options?: {
    senderFilter?: (sender: chrome.runtime.MessageSender) => boolean
  }
): (callback: SenderAwareCallback<Args, Return>) => MessageListenerCallback<Args, Return> {
  return (callback: SenderAwareCallback<Args, Return>) => {
    const listener: MessageListenerCallback<Args, Return> = (request, sender, sendResponse) => {
      if (request.event !== eventName) return false
      if (options?.senderFilter && !options.senderFilter(sender)) return false

      callback(request.args, sender)
        .then((data) => sendResponse({ success: true, data }))
        .catch((error) => sendResponse({ success: false, error: errorToResponse(error) }))

      return true
    }

    return listener
  }
}
