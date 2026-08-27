import { describe, expect, it, vi } from 'vitest'
import { createSseParser } from '@/dianzhi/provider/sse'

describe('provider SSE terminal signals', () => {
  it('completes when an OpenAI-compatible choice reports finish_reason', () => {
    const onDone = vi.fn()
    const parser = createSseParser({ onDelta: vi.fn(), onDone })

    parser.push(
      `data: ${JSON.stringify({
        choices: [
          {
            index: 0,
            delta: { content: '', role: 'assistant' },
            finish_reason: 'stop',
            native_finish_reason: 'stop',
          },
        ],
      })}\n\n`
    )

    expect(parser.done).toBe(true)
    expect(onDone).toHaveBeenCalledWith('finish_reason')
  })
})
