// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { mergeSettings } from '../../../src/dianzhi/domain/settings'
import { streamChat } from '../../../src/dianzhi/provider/client'

const provider = mergeSettings({
  provider: {
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'secret-key',
    model: 'model-name',
  },
}).provider

const input = {
  provider,
  messages: [{ role: 'user' as const, content: 'hello' }],
  signal: new AbortController().signal,
}

describe('streaming provider client', () => {
  it('streams normalized deltas and completes once', async () => {
    const onDelta = vi.fn()
    const onDone = vi.fn()
    const fetch = vi.fn(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"choices":[{"delta":{"content":"answer"}}]}\n\ndata: [DONE]\n\n'
                )
              )
              controller.close()
            },
          }),
          { status: 200, headers: { 'content-type': 'text/event-stream' } }
        )
    )

    await streamChat(input, { fetch, onDelta, onDone })

    expect(fetch).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer secret-key' }),
        signal: input.signal,
      })
    )
    expect(onDelta).toHaveBeenCalledWith({ kind: 'content', delta: 'answer' })
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('maps a non-200 provider body without assuming its error shape', async () => {
    const fetch = vi.fn(
      async () => new Response('{"error":{"message":123},"detail":"denied"}', { status: 401 })
    )

    await expect(
      streamChat(input, { fetch, onDelta: vi.fn(), onDone: vi.fn() })
    ).rejects.toMatchObject({
      code: 'PROVIDER_HTTP_ERROR',
      context: { status: 401 },
    })
  })

  it('redacts configured and Bearer credentials from provider error bodies', async () => {
    const fetch = vi.fn(
      async () => new Response('Bearer echoed-token secret-key must not escape', { status: 400 })
    )

    const error = await streamChat(input, {
      fetch,
      onDelta: vi.fn(),
      onDone: vi.fn(),
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'PROVIDER_HTTP_ERROR' })
    expect(String((error as Error).message)).not.toContain('secret-key')
    expect(String((error as Error).message)).not.toContain('echoed-token')
  })

  it('maps network failures but preserves AbortError for the caller state machine', async () => {
    await expect(
      streamChat(input, {
        fetch: vi.fn(async () => {
          throw new TypeError('network down')
        }),
        onDelta: vi.fn(),
        onDone: vi.fn(),
      })
    ).rejects.toMatchObject({ code: 'PROVIDER_STREAM_ERROR' })

    const abort = new DOMException('aborted', 'AbortError')
    await expect(
      streamChat(input, {
        fetch: vi.fn(async () => {
          throw abort
        }),
        onDelta: vi.fn(),
        onDone: vi.fn(),
      })
    ).rejects.toBe(abort)
  })

  it('redacts credentials from provider startup errors', async () => {
    const error = await streamChat(input, {
      fetch: vi.fn(async () => {
        throw new TypeError('failed to connect with secret-key and Bearer echoed-token')
      }),
      onDelta: vi.fn(),
      onDone: vi.fn(),
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'PROVIDER_STREAM_ERROR' })
    expect(String((error as Error).message)).not.toContain('secret-key')
    expect(String((error as Error).message)).not.toContain('echoed-token')
    expect((error as { context?: { reason?: string } }).context?.reason).not.toContain('secret-key')
  })
})
