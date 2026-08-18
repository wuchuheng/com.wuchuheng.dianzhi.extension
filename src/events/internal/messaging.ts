/**
 * Shared messaging utilities for chrome.runtime.sendMessage patterns.
 */

import type { CallBack, Cancel, MessageFormat, SenderAwareCallback } from '../types'
import {
  DianzhiError,
  type DianzhiErrorCode,
  type DianzhiErrorShape,
} from '@/dianzhi/domain/errors'
import { createMessageListener } from './message-listener'

/**
 * Default timeout for ep2cs requests (30 seconds).
 */
export const EP2CS_TIMEOUT_MS = 30_000

/**
 * Standardized error response format.
 */
export interface ErrorResponse {
  message: string
  stack: string
  code?: DianzhiErrorCode
  context?: DianzhiErrorShape['context']
}

const DIANZHI_ERROR_CODES = new Set<DianzhiErrorCode>([
  'INVALID_EVENT',
  'INVALID_SELECTION',
  'SETTINGS_INVALID',
  'PROVIDER_NOT_CONFIGURED',
  'PROVIDER_HTTP_ERROR',
  'PROVIDER_STREAM_ERROR',
  'CONVERSATION_NOT_FOUND',
  'DB_UNAVAILABLE',
  'SIDE_PANEL_OPEN_FAILED',
  'SIDE_PANEL_READY_TIMEOUT',
  'TOOL_NOT_FOUND',
  'TOOL_LAST_ENABLED',
  'TOOL_ORDER_INVALID',
  'TOOL_PRESET_INVALID',
])

function isDianzhiErrorCode(value: unknown): value is DianzhiErrorCode {
  return typeof value === 'string' && DIANZHI_ERROR_CODES.has(value as DianzhiErrorCode)
}

/**
 * Converts an unknown error to a standardized error response format.
 * Unified for both message and port-based responses.
 *
 * @param error - The error to convert
 * @returns Standardized error response
 */
export function errorToResponse(error: unknown): ErrorResponse {
  const response: ErrorResponse = {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? (error.stack ?? '') : '',
  }
  if (error instanceof DianzhiError) {
    response.code = error.code
    response.context = error.context
  }
  return response
}

/**
 * Reconstructs a trusted application error from an untrusted runtime response.
 * @param response - Error payload returned by another extension context.
 * @returns A Dianzhi error when its stable code is recognized, otherwise a standard Error.
 */
export function errorFromResponse(response: ErrorResponse | undefined): Error {
  if (!response) return new Error('Unknown error')
  if (!isDianzhiErrorCode(response.code)) return new Error(response.message)

  const error = new DianzhiError({
    code: response.code,
    message: response.message,
    ...(response.context ? { context: response.context } : {}),
  })
  if (response.stack) error.stack = response.stack
  return error
}

/**
 * Alias for errorToResponse for port-based responses.
 * Maintained for backwards compatibility.
 *
 * @deprecated Use errorToResponse instead
 */
export const errorToPortResponse = errorToResponse

/**
 * Sends a message via chrome.runtime.sendMessage and handles the response.
 *
 * @throws {Error} If the response indicates failure
 */
export async function sendMessage<Args, Return>(name: string, args: Args): Promise<Return> {
  const msg: MessageFormat<Args, Return> = { event: name, args }
  const result = (await chrome.runtime.sendMessage(msg)) as MessageFormat<Args, Return>['response']

  if (!result?.success) {
    throw errorFromResponse(result?.error)
  }

  return result.data as Return
}

/**
 * Sends a message via chrome.tabs.sendMessage to a specific tab.
 *
 * @throws {Error} If the response indicates failure
 */
export async function sendMessageToTab<Args, Return>(
  name: string,
  args: Args,
  tabId: number
): Promise<Return> {
  const msg: MessageFormat<Args, Return> = { event: name, args }
  const result = (await chrome.tabs.sendMessage(tabId, msg)) as MessageFormat<
    Args,
    Return
  >['response']

  if (!result?.success) {
    throw errorFromResponse(result?.error)
  }

  return result.data as Return
}

/**
 * Registers a chrome.runtime.onMessage listener for a specific event.
 * Returns a cancel function to unregister the listener.
 */
export function registerMessageListener<Args = void, Return = void>(
  name: string,
  callback: CallBack<Args, Return>,
  options?: {
    senderFilter?: (sender: chrome.runtime.MessageSender) => boolean
  }
): Cancel {
  const listener = createMessageListener<Args, Return>(name, options)((args) => callback(args))
  chrome.runtime.onMessage.addListener(listener)
  return () => chrome.runtime.onMessage.removeListener(listener)
}

/**
 * Registers a runtime-message listener that retains trusted Chrome sender metadata.
 * @param name - Fully qualified event name.
 * @param callback - Handler receiving validated channel arguments and the Chrome sender.
 * @param options - Optional sender filter applied before the handler.
 * @returns A function that removes the listener.
 */
export function registerSenderAwareMessageListener<Args = void, Return = void>(
  name: string,
  callback: SenderAwareCallback<Args, Return>,
  options?: {
    senderFilter?: (sender: chrome.runtime.MessageSender) => boolean
  }
): Cancel {
  const listener = createMessageListener<Args, Return>(name, options)(callback)
  chrome.runtime.onMessage.addListener(listener)
  return () => chrome.runtime.onMessage.removeListener(listener)
}
