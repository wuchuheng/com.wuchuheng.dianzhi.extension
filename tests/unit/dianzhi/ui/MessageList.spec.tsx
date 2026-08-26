import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageList } from '@/dianzhi/ui/MessageList'
import { formatMessageTime } from '@/dianzhi/ui/message-time'
import type { MessageRecord } from '@/dianzhi/domain/protocol'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined
let resizeCallback: ResizeObserverCallback | undefined
let frameCallback: FrameRequestCallback | undefined

function assistantMessage(overrides: Partial<MessageRecord> = {}): MessageRecord {
  const at = new Date(2026, 2, 5, 14, 7).toISOString()
  return {
    id: 1,
    conversationId: 1,
    sequence: 1,
    role: 'assistant',
    content: '**hello** world',
    reasoningContent: '',
    status: 'completed',
    errorCode: null,
    errorMessage: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  }
}

async function renderMessageList(
  showMeta: boolean,
  message: MessageRecord,
  smoothStreamingGrowth = false,
  reducedMotion = false,
  onStreamingHeightDelta?: (delta: number) => void
) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      <MessageList
        messages={[message]}
        mode="chat"
        reasoningEnabled={false}
        showMeta={showMeta}
        smoothStreamingGrowth={smoothStreamingGrowth}
        reducedMotion={reducedMotion}
        onStreamingHeightDelta={onStreamingHeightDelta}
      />
    )
  })
  return host
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback
      }
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  )
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frameCallback = callback
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    frameCallback = undefined
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  resizeCallback = undefined
  frameCallback = undefined
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

describe('MessageList meta', () => {
  it('renders the created time and both copy actions on messages when enabled', async () => {
    await renderMessageList(true, assistantMessage())
    const meta = host?.querySelector('.dz-message-meta')
    expect(meta).not.toBeNull()
    const time = meta?.querySelector('time[datetime]')
    expect(time?.textContent).toBe(formatMessageTime(assistantMessage().createdAt))
    expect(meta?.querySelector('[aria-label="复制纯文本"]')).not.toBeNull()
    expect(meta?.querySelector('[aria-label="复制 Markdown"]')).not.toBeNull()
    // Meta sits below the bubble content, right-aligned (last child).
    expect(host?.querySelector('.dz-message')?.lastElementChild).toBe(meta)
  })

  it('copies the reply as plain text when the copy button is clicked', async () => {
    await renderMessageList(true, assistantMessage())
    const button = host?.querySelector<HTMLButtonElement>('[aria-label="复制纯文本"]')
    await act(async () => {
      button?.click()
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello world')
  })

  it('copies the original Markdown when the Markdown copy button is clicked', async () => {
    await renderMessageList(true, assistantMessage())
    const button = host?.querySelector<HTMLButtonElement>('[aria-label="复制 Markdown"]')
    await act(async () => {
      button?.click()
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('**hello** world')
  })

  it('shows a 已复制 confirmation without shifting layout', async () => {
    await renderMessageList(true, assistantMessage())
    const button = host?.querySelector<HTMLButtonElement>('[aria-label="复制纯文本"]')
    expect(host?.querySelector('.dz-copy-toast')).toBeNull()
    await act(async () => {
      button?.click()
    })
    const toast = host?.querySelector('.dz-copy-toast')
    expect(toast?.textContent).toBe('已复制')
    expect(toast?.getAttribute('role')).toBe('status')
  })

  it('disables the copy button while the message is still streaming', async () => {
    await renderMessageList(true, assistantMessage({ status: 'streaming' }))
    const plainButton = host?.querySelector<HTMLButtonElement>('[aria-label="复制纯文本"]')
    const markdownButton = host?.querySelector<HTMLButtonElement>('[aria-label="复制 Markdown"]')
    expect(plainButton?.disabled).toBe(true)
    expect(markdownButton?.disabled).toBe(true)
  })

  it('does not render meta when the prop is off (popover surfaces)', async () => {
    await renderMessageList(false, assistantMessage())
    expect(host?.querySelector('.dz-message-meta')).toBeNull()
    expect(host?.querySelector('[aria-label="复制纯文本"]')).toBeNull()
    expect(host?.querySelector('[aria-label="复制 Markdown"]')).toBeNull()
  })

  it('renders meta on user messages too, copying the user text', async () => {
    const userMessage = assistantMessage({ role: 'user', content: '你好' })
    await renderMessageList(true, userMessage)
    const meta = host?.querySelector('.dz-message-meta')
    expect(meta).not.toBeNull()
    expect(meta?.querySelector('time[datetime]')).not.toBeNull()
    await act(async () => {
      meta?.querySelector<HTMLButtonElement>('[aria-label="复制纯文本"]')?.click()
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('你好')
  })
})

describe('MessageList streaming growth', () => {
  it('keeps the latest assistant message in one growth host across completion', async () => {
    await renderMessageList(true, assistantMessage({ status: 'streaming' }), true)
    expect(
      host?.querySelector('.dz-streaming-message-growth .dz-message.is-assistant')
    ).not.toBeNull()

    await act(async () => {
      root?.render(
        <MessageList
          messages={[assistantMessage({ status: 'completed' })]}
          mode="chat"
          reasoningEnabled={false}
          showMeta
          smoothStreamingGrowth
        />
      )
    })
    expect(
      host?.querySelector('.dz-streaming-message-growth .dz-message.is-assistant')
    ).not.toBeNull()
    const completedHost = host?.querySelector<HTMLDivElement>('.dz-streaming-message-growth')
    const completedMessage = completedHost?.querySelector<HTMLElement>('.dz-message')
    act(() => {
      resizeCallback?.(
        [{ target: completedMessage!, contentRect: { height: 100 } } as ResizeObserverEntry],
        {} as ResizeObserver
      )
    })
    expect(completedHost?.style.height).toBe('')
  })

  it('does not add the growth host to user messages', async () => {
    await renderMessageList(true, assistantMessage({ role: 'user', status: 'streaming' }), true)
    expect(host?.querySelector('.dz-streaming-message-growth')).toBeNull()
    await act(async () => {
      root?.render(
        <MessageList
          messages={[assistantMessage({ role: 'user', status: 'streaming' })]}
          mode="chat"
          reasoningEnabled={false}
          showMeta
          smoothStreamingGrowth
        />
      )
    })
    expect(host?.querySelector('.dz-streaming-message-growth')).toBeNull()
  })

  it('reveals a newly measured rendered row over animation frames', async () => {
    const onStreamingHeightDelta = vi.fn()
    await renderMessageList(
      true,
      assistantMessage({ status: 'streaming' }),
      true,
      false,
      onStreamingHeightDelta
    )
    const growthHost = host?.querySelector<HTMLDivElement>('.dz-streaming-message-growth')
    const message = growthHost?.querySelector<HTMLElement>('.dz-message')
    expect(growthHost).not.toBeNull()
    expect(message).not.toBeNull()

    act(() => {
      resizeCallback?.(
        [{ target: message!, contentRect: { height: 100 } } as ResizeObserverEntry],
        {} as ResizeObserver
      )
    })
    expect(growthHost?.style.height).toBe('100px')

    act(() => {
      resizeCallback?.(
        [{ target: message!, contentRect: { height: 140 } } as ResizeObserverEntry],
        {} as ResizeObserver
      )
    })
    expect(frameCallback).toBeDefined()
    act(() => frameCallback?.(0))
    act(() => frameCallback?.(100))
    const animatedHeight = Number.parseFloat(growthHost?.style.height ?? '0')
    expect(animatedHeight).toBeGreaterThan(100)
    expect(Number.parseFloat(growthHost?.style.height ?? '0')).toBeLessThan(140)
    expect(onStreamingHeightDelta).toHaveBeenCalledWith(animatedHeight - 100)
  })

  it('reveals a newly measured row immediately under reduced motion', async () => {
    await renderMessageList(true, assistantMessage({ status: 'streaming' }), true, true)
    const growthHost = host?.querySelector<HTMLDivElement>('.dz-streaming-message-growth')
    const message = growthHost?.querySelector<HTMLElement>('.dz-message')
    act(() => {
      resizeCallback?.(
        [{ target: message!, contentRect: { height: 100 } } as ResizeObserverEntry],
        {} as ResizeObserver
      )
      resizeCallback?.(
        [{ target: message!, contentRect: { height: 140 } } as ResizeObserverEntry],
        {} as ResizeObserver
      )
    })
    expect(growthHost?.style.height).toBe('140px')
    expect(frameCallback).toBeUndefined()
  })
})
