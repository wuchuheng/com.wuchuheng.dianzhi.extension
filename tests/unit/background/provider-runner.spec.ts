// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { mergeSettings } from '../../../src/dianzhi/domain/settings'
import type { MessageRecord } from '../../../src/dianzhi/domain/protocol'
import { createProviderRunner } from '../../../src/background/provider-runner'

const assistant: MessageRecord = {
  id: 3,
  conversationId: 2,
  sequence: 2,
  role: 'assistant',
  content: '',
  reasoningContent: '',
  status: 'streaming',
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-08-17T00:00:00.000Z',
  updatedAt: '2026-08-17T00:00:00.000Z',
}

describe('background provider runner', () => {
  it('broadcasts deltas immediately and finalizes persistence before done', async () => {
    const order: string[] = []
    const checkpoint = vi.fn(async () => ({ ...assistant, content: 'x'.repeat(1024) }))
    const finalize = vi.fn(async () => {
      order.push('finalize')
      return { ...assistant, content: 'x'.repeat(1024), status: 'completed' as const }
    })
    const runner = createProviderRunner({
      streamChat: vi.fn(async (_input, callbacks) => {
        callbacks.onDelta({ kind: 'content', delta: 'x'.repeat(1024) })
        callbacks.onDone()
      }),
      checkpoint,
      finalize,
      publish: vi.fn(async (update) => {
        order.push(update.type)
      }),
    })

    await runner.start({
      conversationId: 2,
      assistant,
      provider: mergeSettings({ provider: { apiKey: 'key' } }).provider,
      messages: [{ role: 'user', content: 'prompt' }],
    }).done

    expect(checkpoint).toHaveBeenCalledWith(3, 'x'.repeat(1024), '')
    expect(order).toEqual(['stream.delta', 'finalize', 'stream.done'])
  })

  it('finalizes partial content as stopped after abort', async () => {
    const finalize = vi.fn(async (_id, input) => ({ ...assistant, ...input }))
    const runner = createProviderRunner({
      streamChat: vi.fn(
        (input, callbacks) =>
          new Promise<void>((_resolve, reject) => {
            callbacks.onDelta({ kind: 'content', delta: 'partial' })
            input.signal.addEventListener('abort', () =>
              reject(new DOMException('aborted', 'AbortError'))
            )
          })
      ),
      checkpoint: vi.fn(async () => assistant),
      finalize,
      publish: vi.fn(async () => undefined),
    })

    const run = runner.start({
      conversationId: 2,
      assistant,
      provider: mergeSettings({ provider: { apiKey: 'key' } }).provider,
      messages: [{ role: 'user', content: 'prompt' }],
    })
    await Promise.resolve()
    run.stop()
    await run.done

    expect(finalize).toHaveBeenCalledWith(
      3,
      expect.objectContaining({ status: 'stopped', content: 'partial' })
    )
  })

  it('persists a stable configuration error when the provider is not configured', async () => {
    const finalize = vi.fn(async (_id, input) => ({ ...assistant, ...input }))
    const streamChat = vi.fn()
    const runner = createProviderRunner({
      streamChat,
      checkpoint: vi.fn(async () => assistant),
      finalize,
      publish: vi.fn(async () => undefined),
    })

    await runner.start({
      conversationId: 2,
      assistant,
      provider: mergeSettings({}).provider,
      messages: [{ role: 'user', content: 'prompt' }],
    }).done

    expect(streamChat).not.toHaveBeenCalled()
    expect(finalize).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        status: 'error',
        errorCode: 'PROVIDER_NOT_CONFIGURED',
      })
    )
  })
})
