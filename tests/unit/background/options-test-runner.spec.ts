// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import type { ToolTestUpdate } from '@/dianzhi/domain/protocol'
import type { ProviderSettings } from '@/dianzhi/domain/types'
import { createOptionsToolTestRunner } from '../../../src/background/options-test-runner'

const VALID_PROVIDER: ProviderSettings = {
  baseUrl: 'https://example.com/v1',
  apiKey: 'sk-draft',
  model: 'draft-model',
  temperature: 0.7,
  reasoningEnabled: true,
  reasoningEffort: 'medium',
  thinkingParam: '',
  extraBody: '',
}

interface FakePort {
  messages: ToolTestUpdate[]
  disconnect: ReturnType<typeof vi.fn>
  name: string
  sender: { url: string }
  postMessage(message: ToolTestUpdate): void
  onMessage: { addListener(listener: (message: unknown) => void): void }
  onDisconnect: { addListener(listener: () => void): void }
  receive(message: unknown): void
  disconnectPort(): void
}

function createFakePort(overrides: Partial<FakePort> = {}): FakePort {
  const messages: ToolTestUpdate[] = []
  const messageListeners: Array<(message: unknown) => void> = []
  const disconnectListeners: Array<() => void> = []
  const port: FakePort = {
    name: 'dianzhi:options-tool-test',
    sender: { url: 'chrome-extension://efgh/src/options/index.html' },
    messages,
    disconnect: vi.fn(),
    postMessage: (message) => {
      messages.push(message)
    },
    onMessage: {
      addListener: (listener) => {
        messageListeners.push(listener)
      },
    },
    onDisconnect: {
      addListener: (listener) => {
        disconnectListeners.push(listener)
      },
    },
    receive: (message) => {
      messageListeners.forEach((listener) => listener(message))
    },
    disconnectPort: () => {
      disconnectListeners.forEach((listener) => listener())
    },
    ...overrides,
  }
  return port
}

function toolCommand(requestId: string, overrides: Record<string, unknown> = {}) {
  return {
    type: 'tool.test' as const,
    requestId,
    payload: { prompt: 'Explain {{selected}} as used in {{context}}.', provider: VALID_PROVIDER },
    ...overrides,
  }
}

async function flush(turns = 20): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve()
  }
}

describe('background options tool test runner', () => {
  it('streams a tool test and reports first-token and total timing', async () => {
    let clock = 1_000
    const streamChat = vi.fn(async (_input, callbacks) => {
      clock = 1_050
      callbacks.onDelta({ kind: 'reasoning', delta: 'plan ' })
      clock = 2_000
      callbacks.onDelta({ kind: 'content', delta: 'answer' })
      clock = 2_010
      callbacks.onDone()
    })
    const runner = createOptionsToolTestRunner({
      streamChat,
      now: () => clock,
      isExtensionUrl: () => true,
    })
    const port = createFakePort()
    runner.connect(port as unknown as chrome.runtime.Port)
    port.receive(toolCommand('r1'))
    await flush()

    expect(streamChat).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: VALID_PROVIDER,
        messages: [{ role: 'user', content: 'Explain {{selected}} as used in {{context}}.' }],
      }),
      expect.any(Object)
    )
    expect(port.messages).toEqual([
      { type: 'test.validating', requestId: 'r1' },
      { type: 'test.started', requestId: 'r1' },
      { type: 'test.delta', requestId: 'r1', kind: 'reasoning', delta: 'plan ' },
      { type: 'test.delta', requestId: 'r1', kind: 'content', delta: 'answer' },
      {
        type: 'test.done',
        requestId: 'r1',
        content: 'answer',
        reasoningContent: 'plan ',
        firstTokenMs: 50,
        totalMs: 1010,
      },
    ])
  })

  it('rejects an empty API key or model with PROVIDER_NOT_CONFIGURED without streaming', async () => {
    const streamChat = vi.fn()
    const runner = createOptionsToolTestRunner({
      streamChat,
      isExtensionUrl: () => true,
    })
    const port = createFakePort()
    runner.connect(port as unknown as chrome.runtime.Port)
    port.receive(
      toolCommand('r1', {
        payload: {
          prompt: 'Explain.',
          provider: { ...VALID_PROVIDER, apiKey: '', model: '' },
        },
      })
    )
    await flush()

    expect(streamChat).not.toHaveBeenCalled()
    expect(port.messages).toEqual([
      { type: 'test.validating', requestId: 'r1' },
      {
        type: 'test.error',
        requestId: 'r1',
        error: expect.objectContaining({ code: 'PROVIDER_NOT_CONFIGURED' }),
      },
    ])
  })

  it('aborts the previous run when a new tool test starts on the same port', async () => {
    const firstSignal = { current: null as AbortSignal | null }
    const streamChat = vi.fn((input, _callbacks) => {
      if (firstSignal.current === null) {
        firstSignal.current = input.signal
        // Keep the first run in flight forever so the new start must abort it.
        return new Promise<void>(() => undefined)
      }
      return Promise.resolve()
    })
    const runner = createOptionsToolTestRunner({
      streamChat,
      isExtensionUrl: () => true,
    })
    const port = createFakePort()
    runner.connect(port as unknown as chrome.runtime.Port)
    port.receive(toolCommand('r1'))
    await flush()
    port.receive(toolCommand('r2'))
    await flush()

    expect(firstSignal.current?.aborted).toBe(true)
    // The aborted first run must not post its terminal update after r2 starts.
    expect(
      port.messages.filter((message) => message.requestId === 'r1' && message.type === 'test.done')
    ).toEqual([])
  })

  it('aborts the running stream when the port disconnects', async () => {
    const signal = { current: null as AbortSignal | null }
    const streamChat = vi.fn((input) => {
      signal.current = input.signal
      return new Promise<void>((_resolve, reject) => {
        input.signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })
    const runner = createOptionsToolTestRunner({
      streamChat,
      isExtensionUrl: () => true,
    })
    const port = createFakePort()
    runner.connect(port as unknown as chrome.runtime.Port)
    port.receive(toolCommand('r1'))
    await flush()
    expect(port.messages.some((message) => message.type === 'test.started')).toBe(true)

    port.disconnectPort()
    await flush()

    expect(signal.current?.aborted).toBe(true)
    // A disconnected run never posts a terminal update.
    expect(
      port.messages.filter(
        (message) =>
          message.requestId === 'r1' &&
          (message.type === 'test.done' ||
            message.type === 'test.stopped' ||
            message.type === 'test.error')
      )
    ).toEqual([])
  })

  it('ignores ports with a different name and rejects non-extension senders', () => {
    const runner = createOptionsToolTestRunner({
      isExtensionUrl: (url) => url.startsWith('chrome-extension://efgh/'),
    })

    const wrongName = createFakePort({ name: 'dianzhi:sidepanel' })
    runner.connect(wrongName as unknown as chrome.runtime.Port)
    expect(wrongName.disconnect).not.toHaveBeenCalled()

    const foreignSender = createFakePort({ sender: { url: 'https://evil.example/' } })
    runner.connect(foreignSender as unknown as chrome.runtime.Port)
    expect(foreignSender.disconnect).toHaveBeenCalled()
  })

  it('aborts the run when posting an update to a dead port throws', async () => {
    const signal = { current: null as AbortSignal | null }
    const streamChat = vi.fn((input) => {
      signal.current = input.signal
      return Promise.resolve()
    })
    const runner = createOptionsToolTestRunner({
      streamChat,
      isExtensionUrl: () => true,
    })
    const port = createFakePort({
      postMessage: () => {
        throw new Error('Port is closed.')
      },
    })
    runner.connect(port as unknown as chrome.runtime.Port)
    port.receive(toolCommand('r1'))
    await flush()

    expect(signal.current?.aborted).toBe(true)
    expect(port.messages).toEqual([])
  })

  it('surfaces a non-abort stream failure as a test.error update', async () => {
    const streamChat = vi.fn(async () => {
      throw new Error('boom')
    })
    const runner = createOptionsToolTestRunner({
      streamChat,
      isExtensionUrl: () => true,
    })
    const port = createFakePort()
    runner.connect(port as unknown as chrome.runtime.Port)
    port.receive(toolCommand('r1'))
    await flush()

    expect(port.messages).toEqual([
      { type: 'test.validating', requestId: 'r1' },
      { type: 'test.started', requestId: 'r1' },
      {
        type: 'test.error',
        requestId: 'r1',
        error: expect.objectContaining({ code: 'PROVIDER_STREAM_ERROR' }),
      },
    ])
  })

  it('stops a running tool test when a stop command arrives', async () => {
    const streamChat = vi.fn((input) => {
      return new Promise<void>((_resolve, reject) => {
        input.signal.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })
    })
    const runner = createOptionsToolTestRunner({
      streamChat,
      isExtensionUrl: () => true,
    })
    const port = createFakePort()
    runner.connect(port as unknown as chrome.runtime.Port)
    port.receive(toolCommand('r1'))
    await flush()
    port.receive({ type: 'tool.test.stop', requestId: 'stop-1', payload: {} })
    await flush()

    expect(
      port.messages.filter(
        (message) => message.requestId === 'r1' && message.type === 'test.stopped'
      )
    ).toHaveLength(1)
  })
})
