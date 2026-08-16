// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { createSseParser } from '../../../src/dianzhi/provider/sse'

describe('incremental provider SSE parser', () => {
  it('handles split lines, multiple events, content, reasoning, and DONE', () => {
    const onDelta = vi.fn()
    const onDone = vi.fn()
    const parser = createSseParser({ onDelta, onDone })

    parser.push('data: {"choices":[{"delta":{"content":"hel')
    parser.push('lo"}}]}\n\ndata: {"choices":[{"delta":{"reasoning_content":"why"}}]}\n\n')
    parser.push('data: [DONE]\n\n')
    parser.finish()

    expect(onDelta.mock.calls.map(([delta]) => delta)).toEqual([
      { kind: 'content', delta: 'hello' },
      { kind: 'reasoning', delta: 'why' },
    ])
    expect(onDone).toHaveBeenCalledTimes(1)
  })

  it('processes a final unterminated data line', () => {
    const onDelta = vi.fn()
    const parser = createSseParser({ onDelta, onDone: vi.fn() })

    parser.push('data: {"choices":[{"delta":{"content":"tail"}}]}')
    parser.finish()

    expect(onDelta).toHaveBeenCalledWith({ kind: 'content', delta: 'tail' })
  })

  it('rejects malformed JSON event data with a stable stream error', () => {
    const parser = createSseParser({ onDelta: vi.fn(), onDone: vi.fn() })

    expect(() => parser.push('data: {bad}\n\n')).toThrow(
      expect.objectContaining({
        code: 'PROVIDER_STREAM_ERROR',
      })
    )
  })
})
