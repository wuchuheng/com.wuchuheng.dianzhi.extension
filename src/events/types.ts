/**
 * Type definitions for the Chrome extension event system.
 *
 * Provides type-safe event patterns for communication between:
 * - Content Scripts
 * - Background Service Worker
 * - Extension Pages (popup, options, sidepanel)
 */

// ============================================================================
// Core Event Types
// ============================================================================

/**
 * Callback function type for event handlers.
 *
 * @template Args - The arguments type passed to the handler
 * @template Return - The return type from the handler
 */
export type CallBack<Args, Return> = (args: Args) => Promise<Return>

export type SenderAwareCallback<Args, Return> = (
  args: Args,
  sender: chrome.runtime.MessageSender
) => Promise<Return>

/**
 * Cancel function type for unregistering event handlers.
 * Call this function to remove an event handler.
 */
export type Cancel = () => void

/**
 * One-to-one event type.
 *
 * Used for most event patterns where a single dispatcher communicates
 * with a single handler. Returns a single value.
 *
 * @template Args - The arguments type passed to the handler
 * @template Return - The return type from the handler
 */
export type OneToOneEvent<Args, Return> = {
  /** Dispatch an event with arguments, returns the handler's response */
  dispatch: (args: Args) => Promise<Return>
  /** Register a handler for this event, returns a cancel function */
  handle: (callback: CallBack<Args, Return>) => Cancel
}

export type MessageOneToOneEvent<Args, Return> = OneToOneEvent<Args, Return> & {
  /** Register a message handler that receives trusted Chrome sender metadata. */
  handleWithSender: (callback: SenderAwareCallback<Args, Return>) => Cancel
}

/**
 * One-to-many event type.
 *
 * Used for patterns like ep2cs where a single dispatcher communicates
 * with multiple handlers. Returns an array of values.
 *
 * @template Args - The arguments type passed to the handlers
 * @template Return - The return type from the handlers (returned as an array)
 */
export type OneToManyEvent<Args, Return> = {
  /** Dispatch an event with arguments, returns all handler responses as an array */
  dispatch: (args: Args) => Promise<Return[]>
  /** Register a handler for this event, returns a cancel function */
  handle: (callback: CallBack<Args, Return>) => Cancel
}

// ============================================================================
// Message Format Types
// ============================================================================

/**
 * Message format for chrome.runtime.sendMessage based patterns.
 * Used by cs2bg, cs2ep, bg2ep, ep2bg.
 */
export type MessageFormat<Args, Return> = {
  /** The event name identifier */
  event: string
  /** Arguments to pass to the handler */
  args: Args
  /** Optional response (only present in response messages) */
  response?: {
    /** Whether the handler execution was successful */
    success: boolean
    /** The return data from the handler (present on success) */
    data?: Return
    /** Error details (present on failure) */
    error?: {
      message: string
      stack: string
    }
  }
}

/**
 * Port-based message format for ep2cs relay (request side).
 * Sent from extension page to background relay.
 */
export type PortMessageFormat<Args> = {
  /** Unique message identifier for response correlation */
  msgId: string
  /** The event name identifier */
  event: string
  /** Arguments to pass to the handler */
  args: Args
}

/**
 * Port-based response format for ep2cs relay (response side).
 * Sent from content script back to background relay.
 */
export type PortResponseFormat<Return> = {
  /** Unique message identifier (must match request) */
  msgId: string
  /** The return data from the handler (present on success) */
  data?: Return
  /** Error details (present on failure) */
  error?: {
    message: string
    stack: string
  }
}
