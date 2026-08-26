import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationSnapshot } from '@/dianzhi/domain/protocol'
import { DEFAULT_SETTINGS } from '@/dianzhi/domain/settings'

const { conversationDispatch, settingsDispatch, port } = vi.hoisted(() => {
  let messageListener: ((value: unknown) => void) | undefined
  return {
    conversationDispatch: vi.fn(),
    settingsDispatch: vi.fn(),
    port: {
      onMessage: { addListener: vi.fn((listener) => (messageListener = listener)) },
      onDisconnect: { addListener: vi.fn() },
      postMessage: vi.fn(),
      disconnect: vi.fn(),
      emitMessage: (value: unknown) => messageListener?.(value),
    },
  }
})

vi.mock('@/events/config', () => ({
  extensionConversationCommand: { dispatch: conversationDispatch },
  settingsCommand: { dispatch: settingsDispatch },
}))

import App from '@/sidepanel/App'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

function snapshot(): ConversationSnapshot {
  return {
    conversation: {
      id: 22,
      selectionKey: 1,
      tabId: 9,
      toolId: 1,
      toolName: '词典',
      title: 'run',
      selectedText: 'run',
      contextText: 'run fast',
      promptSnapshot: 'Explain run',
      createdAt: '2026-08-22T00:00:00.000Z',
      updatedAt: '2026-08-22T00:00:00.000Z',
    },
    messages: [],
    tools: [],
    activeToolId: 1,
  }
}

function installChrome() {
  ;(globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
    runtime: { connect: () => port, openOptionsPage: vi.fn() },
    tabs: { query: async () => [{ id: 9, windowId: 19 }] },
  }
}

async function renderApp() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(<App />)
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  installChrome()
  settingsDispatch.mockResolvedValue(DEFAULT_SETTINGS)
  conversationDispatch.mockResolvedValue({ accepted: true, snapshot: null })
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

describe('Side Panel dock shortcut', () => {
  it('requests panel closure when Ctrl+[ is pressed in the empty state', async () => {
    await renderApp()
    expect(port.postMessage).toHaveBeenCalledWith({ type: 'ready', tabId: 9, windowId: 19 })
    port.postMessage.mockClear()

    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: '[',
          code: 'BracketLeft',
        })
      )
      await Promise.resolve()
    })

    expect(port.postMessage).toHaveBeenCalledWith({ type: 'close' })
  })

  it('closes the panel when Ctrl+[ is pressed in a composer that stops bubbling', async () => {
    await renderApp()
    await act(async () => {
      port.emitMessage({ type: 'conversation.sync', snapshot: snapshot() })
      await Promise.resolve()
    })
    const input = host?.querySelector<HTMLTextAreaElement>('textarea')
    expect(input).not.toBeNull()
    input?.addEventListener('keydown', (event) => event.stopPropagation())

    await act(async () => {
      input?.dispatchEvent(
        new KeyboardEvent('keydown', {
          bubbles: true,
          cancelable: true,
          ctrlKey: true,
          key: '[',
          code: 'BracketLeft',
        })
      )
      await Promise.resolve()
    })

    expect(port.postMessage).toHaveBeenCalledWith({ type: 'close' })
  })
})

describe('Side Panel composer while streaming', () => {
  it('keeps the chat input editable while a reply is streaming', async () => {
    await renderApp()
    const streaming = snapshot()
    streaming.messages = [
      {
        id: 1,
        conversationId: 22,
        sequence: 1,
        role: 'assistant',
        content: 'working…',
        reasoningContent: '',
        status: 'streaming',
        errorCode: null,
        errorMessage: null,
        createdAt: '2026-08-22T00:00:00.000Z',
        updatedAt: '2026-08-22T00:00:00.000Z',
      },
    ]
    await act(async () => {
      port.emitMessage({ type: 'conversation.sync', snapshot: streaming })
      await Promise.resolve()
    })
    const textarea = host?.querySelector<HTMLTextAreaElement>('textarea')
    expect(textarea).not.toBeNull()
    expect(textarea?.disabled).toBe(false)
  })
})
