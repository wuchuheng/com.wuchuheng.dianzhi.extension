export type DianzhiErrorCode =
  | 'INVALID_EVENT'
  | 'INVALID_SELECTION'
  | 'SETTINGS_INVALID'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_HTTP_ERROR'
  | 'PROVIDER_STREAM_ERROR'
  | 'CONVERSATION_NOT_FOUND'
  | 'DB_UNAVAILABLE'
  | 'SIDE_PANEL_OPEN_FAILED'
  | 'SIDE_PANEL_READY_TIMEOUT'
  | 'TEST_PORT_CLOSED'

export interface DianzhiErrorShape {
  code: DianzhiErrorCode
  message: string
  context?: Readonly<Record<string, string | number | boolean | null>>
}

/**
 * Carries a stable Dianzhi failure code and serializable, non-secret context across extension boundaries.
 */
export class DianzhiError extends Error {
  readonly code: DianzhiErrorCode
  readonly context?: DianzhiErrorShape['context']

  /**
   * Creates a structured application failure.
   * @param shape - Stable code, readable message, and optional safe context.
   */
  constructor(shape: DianzhiErrorShape) {
    super(shape.message)
    this.name = 'DianzhiError'
    this.code = shape.code
    this.context = shape.context
  }

  /**
   * Returns the structured runtime-message representation without an implementation stack.
   * @returns Serializable error data safe for extension messaging.
   */
  toJSON(): DianzhiErrorShape {
    return {
      code: this.code,
      message: this.message,
      ...(this.context ? { context: this.context } : {}),
    }
  }
}
