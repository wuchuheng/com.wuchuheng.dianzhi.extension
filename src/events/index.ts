/**
 * Event system for Chrome extension communication.
 *
 * Provides type-safe event patterns for communication between:
 * - Content Scripts ↔ Background
 * - Content Scripts ↔ Extension Pages
 * - Background ↔ Extension Pages
 * - Background internal events
 *
 * @module
 *
 * @example
 * ```ts
 * // Content script to background
 * import { cs2bg } from '@/events'
 *
 * const event = cs2bg<string, string>('my-event')
 *
 * // In background:
 * event.handle(async (arg) => {
 *   return 'received: ' + arg
 * })
 *
 * // In content script:
 * const result = await event.dispatch('hello')
 * ```
 */

// ============================================================================
// Types
// ============================================================================
export type {
  CallBack,
  Cancel,
  MessageFormat,
  MessageOneToOneEvent,
  OneToManyEvent,
  OneToOneEvent,
  PortMessageFormat,
  PortResponseFormat,
  SenderAwareCallback,
} from './types'

// ============================================================================
// Logger
// ============================================================================
export { Scope, log, logError, logWarn } from './logger'

// ============================================================================
// Content Script Events
// ============================================================================
/**
 * Content script to content script (in-memory).
 * @example
 * ```ts
 * const event = cs2cs<string, number>('my-event')
 * await event.dispatch('hello') // returns number
 * ```
 */
export { cs2cs } from './contentScript/contentScript'

/**
 * Content script to background (chrome.runtime.sendMessage).
 * @example
 * ```ts
 * const event = cs2bg<string, string>('my-event')
 * await event.dispatch('hello') // returns string
 * ```
 */
export { cs2bg } from './contentScript/contentScript'

/**
 * Content script to extension page (chrome.runtime.sendMessage).
 * @example
 * ```ts
 * const event = cs2ep<string, void>('my-event')
 * await event.dispatch('hello')
 * ```
 */
export { cs2ep } from './contentScript/contentScript'

// ============================================================================
// Background Events
// ============================================================================
/**
 * Background to background (in-memory).
 * @example
 * ```ts
 * const event = bg2bg<string, void>('my-event')
 * await event.dispatch('hello')
 * ```
 */
export { bg2bg } from './background/background'

/**
 * Background to content script (chrome.tabs.sendMessage).
 * @example
 * ```ts
 * const event = bg2cs<number, void>('my-event')
 * await event.dispatch({ tabId: 123, data: 42 })
 * // or: await event.dispatch([42, 123])
 * ```
 */
export { bg2cs } from './background/background'

/**
 * Background to extension page (chrome.runtime.sendMessage).
 * @example
 * ```ts
 * const event = bg2ep<number, void>('my-event')
 * await event.dispatch(42)
 * ```
 */
export { bg2ep } from './background/background'

/**
 * Relay service for ep2cs (extension page to content script).
 * Must be called once in background initialization.
 * @example
 * ```ts
 * relayService()
 * ```
 */
export { relayService } from './background/background'

// ============================================================================
// Extension Page Events
// ============================================================================
/**
 * Extension page to background (chrome.runtime.sendMessage).
 * @example
 * ```ts
 * const event = ep2bg<void, string>('my-event')
 * await event.dispatch() // returns string
 * ```
 */
export { ep2bg } from './extensionPage/extensionPage'

// ============================================================================
// Unified Events
// ============================================================================
/**
 * Unified extension page/offscreen to content script event.
 * Uses runtime detection to select the correct behavior per context.
 * @example
 * ```ts
 * const event = ep2cs<string, number>('my-event')
 * // In content script:
 * event.handle(async (arg) => arg.length)
 * // In extension page/offscreen:
 * await event.dispatch('hello') // returns number[]
 * ```
 */
export { ep2cs } from './unified-ep2cs'
