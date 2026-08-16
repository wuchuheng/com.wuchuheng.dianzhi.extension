import { describe, expect, it } from 'vitest'
import { DianzhiError } from '@/dianzhi/domain/errors'

describe('DianzhiError', () => {
  it('preserves Error identity and serializes only safe structured context', () => {
    const error = new DianzhiError({
      code: 'PROVIDER_HTTP_ERROR',
      message: 'Provider returned HTTP 429.',
      context: { status: 429, retryable: true },
    })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('DianzhiError')
    expect(error.toJSON()).toEqual({
      code: 'PROVIDER_HTTP_ERROR',
      message: 'Provider returned HTTP 429.',
      context: { status: 429, retryable: true },
    })
  })

  it('omits absent context from serialized failures', () => {
    const error = new DianzhiError({ code: 'DB_UNAVAILABLE', message: 'Database unavailable.' })

    expect(error.toJSON()).toEqual({
      code: 'DB_UNAVAILABLE',
      message: 'Database unavailable.',
    })
  })
})
