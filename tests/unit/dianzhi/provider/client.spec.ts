import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_SETTINGS } from '@/dianzhi/domain/settings'
import { streamChat } from '@/dianzhi/provider/client'

describe('streamChat', () => {
  it('completes after DONE even when reader cancellation never settles', async () => {
    const encoder = new TextEncoder()
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      },
      cancel() {
        return new Promise<void>(() => undefined)
      },
    })
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(body))
    const completion = streamChat(
      {
        provider: { ...DEFAULT_SETTINGS.provider, apiKey: 'test-key' },
        messages: [{ role: 'user', content: 'Hello' }],
        signal: new AbortController().signal,
      },
      { fetch, onDelta: () => undefined, onDone: () => undefined }
    ).then(() => 'completed')

    await expect(
      Promise.race([
        completion,
        new Promise<'timed-out'>((resolve) => setTimeout(() => resolve('timed-out'), 20)),
      ])
    ).resolves.toBe('completed')
  })

  it('retries once without reasoning fields after a provider rejects the generic reasoning dialect', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: 'Unsupported parameter: reasoning_effort' } }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
      .mockResolvedValueOnce(new Response('data: [DONE]\n\n'))

    await streamChat(
      {
        provider: {
          ...DEFAULT_SETTINGS.provider,
          baseUrl: 'https://example.invalid/v1',
          reasoningEnabled: true,
        },
        messages: [{ role: 'user', content: 'Hello' }],
        signal: new AbortController().signal,
      },
      { fetch, onDelta: () => undefined, onDone: () => undefined }
    )

    expect(fetch).toHaveBeenCalledTimes(2)
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toHaveProperty(
      'reasoning_effort',
      'medium'
    )
    expect(JSON.parse(String(fetch.mock.calls[1][1]?.body))).not.toHaveProperty('reasoning_effort')
  })

  it('uses the compatible fallback on later requests to the same provider and model', async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: { message: 'Unsupported parameter: reasoning_effort' } }),
          {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          }
        )
      )
      .mockResolvedValueOnce(new Response('data: [DONE]\n\n'))
      .mockResolvedValueOnce(new Response('data: [DONE]\n\n'))
    const input = {
      provider: {
        ...DEFAULT_SETTINGS.provider,
        baseUrl: 'https://compatibility-cache.invalid/v1',
        reasoningEnabled: true,
      },
      messages: [{ role: 'user' as const, content: 'Hello' }],
      signal: new AbortController().signal,
    }
    const dependencies = { fetch, onDelta: () => undefined, onDone: () => undefined }

    await streamChat(input, dependencies)
    await streamChat(input, dependencies)

    expect(fetch).toHaveBeenCalledTimes(3)
    expect(JSON.parse(String(fetch.mock.calls[2][1]?.body))).not.toHaveProperty('reasoning_effort')
  })

  it('does not retry a disabled generic-provider request that contains no reasoning field', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Invalid parameter: temperature' } }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      })
    )

    await expect(
      streamChat(
        {
          provider: {
            ...DEFAULT_SETTINGS.provider,
            baseUrl: 'https://disabled-generic.invalid/v1',
            reasoningEnabled: false,
          },
          messages: [{ role: 'user', content: 'Hello' }],
          signal: new AbortController().signal,
        },
        { fetch, onDelta: () => undefined, onDone: () => undefined }
      )
    ).rejects.toMatchObject({ code: 'PROVIDER_HTTP_ERROR' })

    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
