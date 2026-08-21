import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MessageList } from '@/dianzhi/ui/MessageList'
import { formatMessageTime } from '@/dianzhi/ui/message-time'
import type { MessageRecord } from '@/dianzhi/domain/protocol'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

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

async function renderMessageList(showMeta: boolean, message: MessageRecord) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      <MessageList messages={[message]} mode="chat" reasoningEnabled={false} showMeta={showMeta} />
    )
  })
  return host
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
})

afterEach(() => {
  vi.clearAllMocks()
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
