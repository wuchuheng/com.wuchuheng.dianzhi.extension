import { describe, expect, it } from 'vitest'
import {
  INITIAL_TOOL_TEST_STATE,
  reduceToolTestState,
} from '../../../src/options/tools/tool-test-state'
import type { ToolTestUpdate } from '@/dianzhi/domain/protocol'

describe('reduceToolTestState', () => {
  it('starts idle', () => {
    expect(INITIAL_TOOL_TEST_STATE).toEqual({
      status: 'idle',
      requestId: null,
      content: '',
      reasoningContent: '',
      firstTokenMs: null,
      totalMs: null,
      error: null,
    })
  })

  it('starts a validating run and resets any previous output', () => {
    const state = reduceToolTestState(
      {
        ...INITIAL_TOOL_TEST_STATE,
        status: 'streaming',
        requestId: 'old',
        content: 'stale',
        reasoningContent: 'stale reasoning',
      },
      { type: 'test.validating', requestId: 'r2' }
    )
    expect(state).toEqual({
      ...INITIAL_TOOL_TEST_STATE,
      status: 'validating',
      requestId: 'r2',
    })
  })

  it('accumulates content and reasoning deltas separately', () => {
    let state = reduceToolTestState(INITIAL_TOOL_TEST_STATE, {
      type: 'test.validating',
      requestId: 'r1',
    })
    state = reduceToolTestState(state, { type: 'test.started', requestId: 'r1' })
    state = reduceToolTestState(state, {
      type: 'test.delta',
      requestId: 'r1',
      kind: 'reasoning',
      delta: 'plan ',
    })
    state = reduceToolTestState(state, {
      type: 'test.delta',
      requestId: 'r1',
      kind: 'content',
      delta: 'answer',
    })
    expect(state.status).toBe('streaming')
    expect(state.content).toBe('answer')
    expect(state.reasoningContent).toBe('plan ')
  })

  it('drops updates whose request id does not match the active run', () => {
    const active = reduceToolTestState(INITIAL_TOOL_TEST_STATE, {
      type: 'test.validating',
      requestId: 'r1',
    })
    const stale = reduceToolTestState(active, {
      type: 'test.delta',
      requestId: 'r0',
      kind: 'content',
      delta: 'stale',
    })
    expect(stale).toBe(active)
  })

  it('drops unknown message types instead of returning an invalid reducer result', () => {
    const active = reduceToolTestState(INITIAL_TOOL_TEST_STATE, {
      type: 'test.validating',
      requestId: 'r1',
    })
    const unknown = reduceToolTestState(active, {
      type: 'test.unknown',
      requestId: 'r1',
    } as unknown as ToolTestUpdate)
    expect(unknown).toBe(active)
  })

  it('freezes a terminal run against further same-request deltas', () => {
    let state = reduceToolTestState(INITIAL_TOOL_TEST_STATE, {
      type: 'test.validating',
      requestId: 'r1',
    })
    state = reduceToolTestState(state, {
      type: 'test.stopped',
      requestId: 'r1',
      content: 'partial',
      reasoningContent: '',
      firstTokenMs: 5,
      totalMs: 50,
    })
    expect(state.status).toBe('stopped')
    expect(state.content).toBe('partial')

    const after = reduceToolTestState(state, {
      type: 'test.delta',
      requestId: 'r1',
      kind: 'content',
      delta: ' late',
    })
    expect(after).toBe(state)
  })

  it('replaces accumulated strings with the authoritative done payload', () => {
    let state = reduceToolTestState(INITIAL_TOOL_TEST_STATE, {
      type: 'test.validating',
      requestId: 'r1',
    })
    state = reduceToolTestState(state, {
      type: 'test.delta',
      requestId: 'r1',
      kind: 'content',
      delta: 'draft',
    })
    state = reduceToolTestState(state, {
      type: 'test.done',
      requestId: 'r1',
      content: 'authoritative answer',
      reasoningContent: 'authoritative reasoning',
      firstTokenMs: 100,
      totalMs: 900,
    })
    expect(state).toMatchObject({
      status: 'completed',
      content: 'authoritative answer',
      reasoningContent: 'authoritative reasoning',
      firstTokenMs: 100,
      totalMs: 900,
      error: null,
    })
  })

  it('records the error payload and clears it on a later validating run', () => {
    let state = reduceToolTestState(INITIAL_TOOL_TEST_STATE, {
      type: 'test.validating',
      requestId: 'r1',
    })
    state = reduceToolTestState(state, {
      type: 'test.error',
      requestId: 'r1',
      error: { code: 'PROVIDER_HTTP_ERROR', message: 'HTTP 429' },
    })
    expect(state.status).toBe('error')
    expect(state.error?.code).toBe('PROVIDER_HTTP_ERROR')

    const next = reduceToolTestState(state, { type: 'test.validating', requestId: 'r2' })
    expect(next.status).toBe('validating')
    expect(next.error).toBeNull()
  })

  it('resets to idle from any state', () => {
    const state = reduceToolTestState(
      { ...INITIAL_TOOL_TEST_STATE, status: 'streaming', requestId: 'r1', content: 'x' },
      { type: 'test.reset' }
    )
    expect(state).toBe(INITIAL_TOOL_TEST_STATE)
  })

  it('handles the complete streaming lifecycle with typed transport updates', () => {
    const updates: ToolTestUpdate[] = [
      { type: 'test.validating', requestId: 'r1' },
      { type: 'test.started', requestId: 'r1' },
      { type: 'test.delta', requestId: 'r1', kind: 'reasoning', delta: 'r' },
      { type: 'test.delta', requestId: 'r1', kind: 'content', delta: 'a' },
      {
        type: 'test.done',
        requestId: 'r1',
        content: 'a',
        reasoningContent: 'r',
        firstTokenMs: 1,
        totalMs: 2,
      },
    ]
    const finalState = updates.reduce(reduceToolTestState, INITIAL_TOOL_TEST_STATE)
    expect(finalState.status).toBe('completed')
  })
})
