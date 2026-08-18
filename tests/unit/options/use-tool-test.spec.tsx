import { describe, expect, it, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useToolTest, type UseToolTestResult } from '../../../src/options/tools/use-tool-test'
import type { ProviderSettings } from '@/dianzhi/domain/types'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const provider: ProviderSettings = {
  baseUrl: 'https://api.example.com/v1',
  apiKey: 'key',
  model: 'model',
  temperature: 0.7,
  reasoningEnabled: false,
  reasoningEffort: 'medium',
  thinkingParam: '',
  extraBody: '',
}

let latestResult: UseToolTestResult | null = null

function Harness({ connect }: { connect: typeof chrome.runtime.connect }) {
  const result = useToolTest({ connect })
  useEffect(() => {
    latestResult = result
  }, [result])
  return null
}

interface FakePortState {
  port: chrome.runtime.Port
  sent: unknown[]
  messageListeners: Array<(value: unknown) => void>
  disconnectListeners: Array<() => void>
  disconnectPort(): void
}

function createFakePortState(
  overrides: { postMessage?: (message: unknown) => void } = {}
): FakePortState {
  const state: FakePortState = {
    sent: [],
    messageListeners: [],
    disconnectListeners: [],
    port: undefined as unknown as chrome.runtime.Port,
    disconnectPort: () => undefined,
  }
  state.disconnectPort = () => {
    state.disconnectListeners.forEach((listener) => listener())
  }
  state.port = {
    name: 'dianzhi:options-tool-test',
    postMessage: overrides.postMessage ?? ((message: unknown) => state.sent.push(message)),
    onMessage: { addListener: (listener) => state.messageListeners.push(listener) },
    onDisconnect: {
      addListener: (listener: () => void) => state.disconnectListeners.push(listener),
    },
    disconnect: () => undefined,
  } as unknown as chrome.runtime.Port
  return state
}

function resultOf(): UseToolTestResult {
  if (!latestResult) throw new Error('The hook result was not committed by the effect.')
  return latestResult
}

function mount(connect: typeof chrome.runtime.connect): {
  root: Root
  container: HTMLDivElement
} {
  latestResult = null
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => {
    root.render(<Harness connect={connect} />)
  })
  return { root, container }
}

function unmount(root: Root, container: HTMLDivElement): void {
  act(() => root.unmount())
  container.remove()
}

describe('useToolTest', () => {
  it('reports a closed-port error instead of stranding in validating when the port cannot connect', () => {
    const { root, container } = mount(() => {
      throw new Error('background unavailable')
    })
    act(() => {
      resultOf().run({ prompt: 'Explain.', provider })
    })
    expect(resultOf().state.status).toBe('error')
    expect(resultOf().state.error?.code).toBe('TEST_PORT_CLOSED')
    unmount(root, container)
  })

  it('opens the port lazily and streams the current tool test to completion', () => {
    const state = createFakePortState()
    const { root, container } = mount(() => state.port)
    expect(state.sent).toHaveLength(0)

    act(() => {
      resultOf().run({ prompt: 'Explain.', provider })
    })
    expect(state.sent).toHaveLength(1)
    expect(resultOf().state.status).toBe('validating')
    const sent = state.sent[0] as { type: string; requestId: string }
    expect(sent.type).toBe('tool.test')

    act(() => {
      state.messageListeners.forEach((listener) =>
        listener({
          type: 'test.done',
          requestId: sent.requestId,
          content: 'ok',
          reasoningContent: 'plan',
          firstTokenMs: 3,
          totalMs: 4,
        })
      )
    })
    expect(resultOf().state.status).toBe('completed')
    unmount(root, container)
  })

  it('filters updates that belong to a superseded request id', () => {
    const state = createFakePortState()
    const { root, container } = mount(() => state.port)

    act(() => {
      resultOf().run({ prompt: 'First.', provider })
    })
    const first = state.sent[0] as { requestId: string }
    act(() => {
      resultOf().run({ prompt: 'Second.', provider })
    })
    const second = state.sent[1] as { requestId: string }
    expect(second.requestId).not.toBe(first.requestId)

    act(() => {
      // The first (aborted) run must not mutate the pane state.
      state.messageListeners.forEach((listener) =>
        listener({
          type: 'test.done',
          requestId: first.requestId,
          content: 'stale',
          reasoningContent: '',
          firstTokenMs: 1,
          totalMs: 1,
        })
      )
      state.messageListeners.forEach((listener) =>
        listener({
          type: 'test.done',
          requestId: second.requestId,
          content: 'fresh',
          reasoningContent: '',
          firstTokenMs: 2,
          totalMs: 2,
        })
      )
    })
    expect(resultOf().state.content).toBe('fresh')
    unmount(root, container)
  })

  it('reports a closed-port error when posting to a dead port throws', () => {
    const state = createFakePortState({
      postMessage: () => {
        throw new Error('Port is closed.')
      },
    })
    const { root, container } = mount(() => state.port)
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    act(() => {
      resultOf().run({ prompt: 'Explain.', provider })
    })
    expect(resultOf().state.status).toBe('error')
    expect(resultOf().state.error?.code).toBe('TEST_PORT_CLOSED')
    spy.mockRestore()
    unmount(root, container)
  })

  it('stops the running test and resets back to idle', () => {
    const state = createFakePortState()
    const { root, container } = mount(() => state.port)

    act(() => {
      resultOf().run({ prompt: 'Explain.', provider })
    })
    act(() => {
      resultOf().stop()
    })
    const stopMessage = state.sent[state.sent.length - 1] as { type: string }
    expect(stopMessage.type).toBe('tool.test.stop')

    act(() => {
      resultOf().reset()
    })
    expect(resultOf().state.status).toBe('idle')
    unmount(root, container)
  })

  it('disconnects the port when the component unmounts', () => {
    const state = createFakePortState()
    const disconnect = vi.spyOn(state.port, 'disconnect')
    const { root, container } = mount(() => state.port)
    act(() => {
      resultOf().run({ prompt: 'Explain.', provider })
    })
    unmount(root, container)
    expect(disconnect).toHaveBeenCalled()
  })
})
