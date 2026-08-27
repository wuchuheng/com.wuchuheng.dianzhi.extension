import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationSnapshot, MessageRecord } from '@/dianzhi/domain/protocol'
import { DEFAULT_SETTINGS } from '@/dianzhi/domain/settings'

const hoisted = vi.hoisted(() => {
  const commandConsumer: {
    capture?: (value: unknown) => Promise<unknown>
  } = {}
  const updateConsumer: {
    capture?: (value: unknown) => Promise<unknown>
  } = {}
  const sidePanelCommandHandle = vi.fn(
    (_binding: unknown, callback: (value: unknown) => Promise<unknown>) => {
      commandConsumer.capture = callback
      return vi.fn()
    }
  )
  const sidePanelConversationUpdateHandle = vi.fn(
    (_binding: unknown, callback: (value: unknown) => Promise<unknown>) => {
      updateConsumer.capture = callback
      return vi.fn()
    }
  )
  return {
    conversationDispatch: vi.fn(),
    settingsDispatch: vi.fn(),
    panelToggleDispatch: vi.fn(),
    panelSurfaceStatusDispatch: vi.fn(),
    panelSelectToolShortcutDispatch: vi.fn(),
    panelCycleToolShortcutDispatch: vi.fn(),
    commandConsumer,
    updateConsumer,
    sidePanelCommandHandle,
    sidePanelConversationUpdateHandle,
  }
})

const {
  conversationDispatch,
  settingsDispatch,
  panelToggleDispatch,
  panelSurfaceStatusDispatch,
  panelSelectToolShortcutDispatch,
  panelCycleToolShortcutDispatch,
  commandConsumer,
  updateConsumer,
  sidePanelCommandHandle,
  sidePanelConversationUpdateHandle,
} = hoisted

const emitMessage = (value: unknown) => updateConsumer.capture?.(value)

vi.mock('@/events/config', () => {
  const h = hoisted
  return {
    extensionConversationCommand: { dispatch: h.conversationDispatch },
    settingsCommand: { dispatch: h.settingsDispatch },
    panelPanelToggle: { dispatch: h.panelToggleDispatch },
    panelSurfaceStatus: { dispatch: h.panelSurfaceStatusDispatch },
    panelSelectToolShortcut: { dispatch: h.panelSelectToolShortcutDispatch },
    panelCycleToolShortcut: { dispatch: h.panelCycleToolShortcutDispatch },
    sidePanelCommand: { handle: h.sidePanelCommandHandle },
    sidePanelConversationUpdate: { handle: h.sidePanelConversationUpdateHandle },
  }
})

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
    runtime: { openOptionsPage: vi.fn() },
    tabs: { query: async () => [{ id: 9, windowId: 19 }] },
  }
}

function stubMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn(
    () =>
      ({
        matches,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList
  ) as unknown as typeof window.matchMedia
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
  commandConsumer.capture = undefined
  updateConsumer.capture = undefined
  installChrome()
  settingsDispatch.mockResolvedValue(DEFAULT_SETTINGS)
  conversationDispatch.mockResolvedValue({ accepted: true, snapshot: null })
  panelToggleDispatch.mockResolvedValue({
    currentUI: 'none',
    latestUI: 'contentScript',
    action: 'none',
    snapshot: null,
  })
  panelSurfaceStatusDispatch.mockResolvedValue({
    currentUI: 'none',
    latestUI: 'contentScript',
    selectionSessionId: null,
  })
  panelSelectToolShortcutDispatch.mockResolvedValue({ handled: false, reason: 'NO_APPEARED_UI' })
  panelCycleToolShortcutDispatch.mockResolvedValue({ handled: false, reason: 'NO_APPEARED_UI' })
  stubMatchMedia(false)
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

describe('Side Panel dock shortcut', () => {
  it('dispatches the panel-toggle event when Ctrl+[ is pressed in the empty state', async () => {
    await renderApp()
    expect(sidePanelCommandHandle).toHaveBeenCalledTimes(1)
    expect(sidePanelConversationUpdateHandle).toHaveBeenCalledTimes(1)

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

    expect(panelToggleDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'shortcut.panelToggle' })
    )
  })

  it('dispatches the panel-toggle event when Ctrl+[ is pressed in a composer that stops bubbling', async () => {
    await renderApp()
    await act(async () => {
      await emitMessage({ type: 'conversation.sync', snapshot: snapshot() })
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

    expect(panelToggleDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'shortcut.panelToggle' })
    )
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
        estimatedThroughputTps: null,
        status: 'streaming',
        errorCode: null,
        errorMessage: null,
        createdAt: '2026-08-22T00:00:00.000Z',
        updatedAt: '2026-08-22T00:00:00.000Z',
      },
    ]
    await act(async () => {
      emitMessage({ type: 'conversation.sync', snapshot: streaming })
      await Promise.resolve()
    })
    const textarea = host?.querySelector<HTMLTextAreaElement>('textarea')
    expect(textarea).not.toBeNull()
    expect(textarea?.disabled).toBe(false)
  })
})

describe('Side Panel message toolbar', () => {
  const assistant = (overrides: Partial<MessageRecord> = {}): MessageRecord => ({
    id: 1,
    conversationId: 22,
    sequence: 1,
    role: 'assistant',
    content: '',
    reasoningContent: '',
    estimatedThroughputTps: null,
    status: 'streaming',
    errorCode: null,
    errorMessage: null,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
    ...overrides,
  })

  it('shows pending dots before the first assistant text arrives', async () => {
    await renderApp()
    const next = snapshot()
    next.messages = [assistant()]
    await act(async () => {
      emitMessage({ type: 'conversation.sync', snapshot: next })
      await Promise.resolve()
    })
    expect(host?.querySelector('[aria-label="正在生成"]')).not.toBeNull()
    expect(host?.querySelector('.dz-streaming-message-growth')).not.toBeNull()
    expect(host?.querySelector('.dz-message-meta')?.textContent).toContain('正在生成')
  })

  it('shows final speed and retries the latest failed message from its toolbar', async () => {
    await renderApp()
    const next = snapshot()
    next.messages = [
      assistant({
        content: 'answer',
        estimatedThroughputTps: 65,
        status: 'error',
        errorMessage: '请求失败',
      }),
    ]
    await act(async () => {
      emitMessage({ type: 'conversation.sync', snapshot: next })
      await Promise.resolve()
    })
    expect(host?.querySelector('.dz-message-meta')?.textContent).toContain('65t/s')
    expect(host?.querySelector('.dz-panel-composer .dz-secondary')).toBeNull()
    await act(async () => {
      host?.querySelector<HTMLButtonElement>('[aria-label="重新生成"]')?.click()
    })
    expect(conversationDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'conversation.retry', payload: { conversationId: 22 } })
    )
  })
})

describe('Side Panel smooth chat scroll', () => {
  let frameCallback: ((now: number) => void) | null
  let nextFrameId: number

  const message = (sequence: number, content: string): MessageRecord => ({
    id: sequence,
    conversationId: 22,
    sequence,
    role: 'assistant',
    content,
    reasoningContent: '',
    estimatedThroughputTps: null,
    status: 'streaming',
    errorCode: null,
    errorMessage: null,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
  })

  const history = () => {
    const element = host?.querySelector<HTMLDivElement>('.dz-panel-history')
    if (!element) throw new Error('.dz-panel-history not found')
    return element
  }

  const defineMetrics = () => {
    const element = history()
    Object.defineProperty(element, 'clientHeight', { value: 300, configurable: true })
    Object.defineProperty(element, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(element, 'scrollTop', { value: 0, writable: true, configurable: true })
    return element
  }

  const grow = (scrollHeight: number) => {
    const element = history()
    Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, configurable: true })
    return element
  }

  const userScroll = (scrollTop: number) => {
    const element = history()
    element.scrollTop = scrollTop
    element.dispatchEvent(new Event('scroll'))
  }

  const syncMessages = async (messages: MessageRecord[]) => {
    const next = snapshot()
    next.messages = messages
    await act(async () => {
      emitMessage({ type: 'conversation.sync', snapshot: next })
      await Promise.resolve()
    })
  }

  const driveFrames = (count = 300) => {
    let now = 1_000
    for (let i = 0; i < count && frameCallback !== null; i++) {
      const cb = frameCallback
      frameCallback = null
      cb(now)
      now += 33
    }
  }

  const openEmptyHistory = async () => {
    await renderApp()
    await act(async () => {
      emitMessage({ type: 'conversation.sync', snapshot: snapshot() })
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    frameCallback = null
    nextFrameId = 0
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      frameCallback = cb
      return ++nextFrameId
    })
    vi.stubGlobal('cancelAnimationFrame', () => {
      frameCallback = null
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('synchronizes to the newest bottom without a competing scroll animation', async () => {
    await openEmptyHistory()
    defineMetrics()

    await syncMessages([message(1, 'first line')])
    expect(frameCallback).toBeNull()
    expect(history().scrollTop).toBe(700)

    grow(1300)
    await syncMessages([message(1, 'first line\nsecond line'), message(2, 'third line')])
    expect(frameCallback).toBeNull()
    expect(history().scrollTop).toBe(1000)
  })

  it('keeps following when the user is within 150px of the bottom', async () => {
    await openEmptyHistory()
    defineMetrics()
    await syncMessages([message(1, 'first line')])

    // 120px from the bottom: inside the new 150px guard, outside the old 80px.
    userScroll(700 - 120)
    grow(1200)
    await syncMessages([message(1, 'first line'), message(2, 'grown')])
    expect(frameCallback).toBeNull()
    expect(history().scrollTop).toBe(900)
  })

  it('pauses following beyond the guard and resumes within it', async () => {
    await openEmptyHistory()
    defineMetrics()
    await syncMessages([message(1, 'first line')])

    // 600px above the bottom: far outside the guard, following pauses.
    userScroll(1000 - 300 - 600)
    grow(1200)
    await syncMessages([message(1, 'first line'), message(2, 'grown')])
    expect(frameCallback).toBeNull()
    expect(history().scrollTop).toBe(1000 - 300 - 600)

    // Back inside the guard: following resumes on the next update.
    userScroll(1200 - 300 - 50)
    grow(1400)
    await syncMessages([message(1, 'first line'), message(2, 'grown again')])
    expect(frameCallback).toBeNull()
    expect(history().scrollTop).toBe(1100)
  })

  it('jumps straight to the bottom under reduced motion', async () => {
    stubMatchMedia(true)
    await openEmptyHistory()
    defineMetrics()

    await syncMessages([message(1, 'first line')])
    expect(frameCallback).toBeNull()
    expect(history().scrollTop).toBe(700)
  })

  it('anchors instantly when the conversation switches', async () => {
    await openEmptyHistory()
    defineMetrics()
    history().scrollTop = 123
    await syncMessages([message(1, 'first line')])
    driveFrames()
    expect(history().scrollTop).toBe(700)

    const other = snapshot()
    other.conversation.id = 23
    other.messages = [message(1, 'other context')]
    await act(async () => {
      emitMessage({ type: 'conversation.sync', snapshot: other })
      await Promise.resolve()
    })
    expect(history().scrollTop).toBe(700)
  })
})

describe('Side Panel provider setup panel', () => {
  const unconfigured = (content: string) => {
    const next = snapshot()
    next.messages = [
      {
        id: 1,
        conversationId: 22,
        sequence: 1,
        role: 'assistant',
        content,
        reasoningContent: '',
        estimatedThroughputTps: null,
        status: 'error',
        errorCode: 'PROVIDER_NOT_CONFIGURED',
        errorMessage: content,
        createdAt: '2026-08-22T00:00:00.000Z',
        updatedAt: '2026-08-22T00:00:00.000Z',
      },
    ]
    return next
  }

  it('renders the inline setup panel instead of the banner when unconfigured', async () => {
    await renderApp()
    await act(async () => {
      emitMessage({ type: 'conversation.sync', snapshot: unconfigured('need setup') })
      await Promise.resolve()
    })
    expect(host?.querySelector('.dz-provider-setup')).not.toBeNull()
    expect(host?.querySelector('.dz-error')).toBeNull()
  })

  it('dismisses the panel after a successful save', async () => {
    await renderApp()
    await act(async () => {
      emitMessage({ type: 'conversation.sync', snapshot: unconfigured('need setup') })
      await Promise.resolve()
    })
    expect(host?.querySelector('.dz-provider-setup')).not.toBeNull()
    await act(async () => {
      host
        ?.querySelector<HTMLFormElement>('.dz-provider-setup')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(settingsDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'settings.save' })
    )
    expect(host?.querySelector('.dz-provider-setup')).toBeNull()
  })

  it('drives the setup panel height to the content height with no cap', async () => {
    let frameCallback: ((now: number) => void) | null = null
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      frameCallback = cb
      return 1
    })
    vi.stubGlobal('cancelAnimationFrame', () => {
      frameCallback = null
    })

    await renderApp()
    await act(async () => {
      emitMessage({ type: 'conversation.sync', snapshot: unconfigured('need setup') })
      await Promise.resolve()
    })
    const panel = host?.querySelector<HTMLDivElement>('.dz-provider-setup-host')
    expect(panel).not.toBeNull()
    Object.defineProperty(panel as HTMLDivElement, 'offsetHeight', {
      value: 900,
      configurable: true,
    })

    await act(async () => {
      emitMessage({ type: 'conversation.sync', snapshot: unconfigured('need setup again') })
      await Promise.resolve()
    })
    expect(frameCallback).not.toBeNull()

    act(() => {
      let now = 1_000
      for (let i = 0; i < 1_000 && frameCallback !== null; i++) {
        const cb = frameCallback
        frameCallback = null
        cb(now)
        now += 33
      }
    })
    expect(panel?.style.height).toBe('900px')
  })
})
