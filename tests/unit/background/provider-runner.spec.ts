import { describe, expect, it, vi } from 'vitest'
import { createProviderRunner, type ProviderRunnerDependencies } from '@/background/provider-runner'
import type { MessageRecord } from '@/dianzhi/domain/protocol'
import { DEFAULT_SETTINGS } from '@/dianzhi/domain/settings'
import type { FinalizeAssistantInput } from '@/offscreen/database/store'

const assistant: MessageRecord = {
  id: 7,
  conversationId: 22,
  sequence: 2,
  role: 'assistant',
  content: '',
  reasoningContent: '',
  estimatedThroughputTps: null,
  status: 'streaming',
  errorCode: null,
  errorMessage: null,
  createdAt: '2026-08-27T00:00:00.000Z',
  updatedAt: '2026-08-27T00:00:00.000Z',
}

describe('provider runner throughput', () => {
  it('stores the terminal average from first output to completion', async () => {
    const finalize = vi.fn(async (_messageId: number, input: FinalizeAssistantInput) => ({
      ...assistant,
      ...input,
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
    }))
    const clock = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(2_000)
    const streamChat: ProviderRunnerDependencies['streamChat'] = async (_input, handlers) => {
      handlers.onDelta({ kind: 'content', delta: 'abcdefgh' })
      handlers.onDone('done_marker')
    }
    const dependencies = {
      streamChat,
      checkpoint: vi.fn(async () => assistant),
      finalize,
      publish: vi.fn(),
      now: clock,
    } as ProviderRunnerDependencies & { now: () => number }
    const runner = createProviderRunner(dependencies)

    await runner.start({
      conversationId: assistant.conversationId,
      assistant,
      provider: { ...DEFAULT_SETTINGS.provider, apiKey: 'test-key' },
      messages: [],
    }).done

    expect(finalize).toHaveBeenCalledWith(
      assistant.id,
      expect.objectContaining({ status: 'completed', estimatedThroughputTps: 2 })
    )
  })

  it('publishes a visible terminal error when final persistence fails', async () => {
    const publish = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const streamChat: ProviderRunnerDependencies['streamChat'] = async (_input, handlers) => {
      handlers.onDelta({ kind: 'content', delta: 'answer' })
      handlers.onDone('done_marker')
    }
    const runner = createProviderRunner({
      streamChat,
      checkpoint: vi.fn(async () => assistant),
      finalize: vi.fn(async () => {
        throw new Error('Database request timed out after 5000ms.')
      }),
      publish,
    })

    await runner.start({
      conversationId: assistant.conversationId,
      assistant,
      provider: { ...DEFAULT_SETTINGS.provider, apiKey: 'test-key' },
      messages: [],
    }).done

    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'stream.error',
        message: expect.objectContaining({ status: 'error', errorCode: 'DB_UNAVAILABLE' }),
      })
    )
    expect(consoleError).toHaveBeenCalledWith(
      '[background]',
      'Provider terminal persistence failed.',
      expect.objectContaining({ conversationId: 22, messageId: 7, phase: 'finalize' })
    )
    consoleError.mockRestore()
  })
})
