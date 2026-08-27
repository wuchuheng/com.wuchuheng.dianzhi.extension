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
    estimatedThroughputTps: null,
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
  latestAssistantId?: number,
  onRetryMessage?: (message: MessageRecord) => void
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
        latestAssistantId={latestAssistantId}
        onRetryMessage={onRetryMessage}
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
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

describe('MessageList meta', () => {
  it('smoothly grows only the latest assistant message', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    const older = assistantMessage({ id: 1, sequence: 1, content: 'older' })
    const latest = assistantMessage({ id: 2, sequence: 2, content: 'latest', status: 'streaming' })

    await act(async () => {
      root?.render(
        <MessageList
          messages={[older, latest]}
          mode="chat"
          reasoningEnabled={false}
          showMeta
          smoothStreamingGrowth
          reducedMotion={false}
        />
      )
    })

    const growth = host?.querySelector('.dz-streaming-message-growth')
    expect(host?.querySelectorAll('.dz-streaming-message-growth')).toHaveLength(1)
    expect(growth?.textContent).toContain('latest')
    expect(growth?.textContent).not.toContain('older')
  })

  it('renders the created time and both copy actions on messages when enabled', async () => {
    await renderMessageList(true, assistantMessage())
    const meta = host?.querySelector('.dz-message-meta')
    expect(meta).not.toBeNull()
    const time = meta?.querySelector('time[datetime]')
    expect(time?.textContent).toBe(formatMessageTime(assistantMessage().createdAt))
    expect(meta?.querySelector('[aria-label="复制纯文本"]')).not.toBeNull()
    expect(meta?.querySelector('[aria-label="复制 Markdown"]')).not.toBeNull()
    expect(host?.querySelector('.dz-message-item')?.lastElementChild).toBe(meta)
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

  it('hides copy actions while the message is still streaming', async () => {
    await renderMessageList(true, assistantMessage({ status: 'streaming' }))
    const plainButton = host?.querySelector<HTMLButtonElement>('[aria-label="复制纯文本"]')
    const markdownButton = host?.querySelector<HTMLButtonElement>('[aria-label="复制 Markdown"]')
    expect(plainButton).toBeNull()
    expect(markdownButton).toBeNull()
  })

  it('shows pending status without copy actions before the first response text', async () => {
    await renderMessageList(true, assistantMessage({ content: '', status: 'streaming' }))
    expect(host?.querySelector('[aria-label="正在生成"]')).not.toBeNull()
    expect(host?.querySelector('.dz-message-meta')?.textContent).toContain('正在生成')
    expect(host?.querySelector('.dz-message-copy')).toBeNull()
  })

  it('shows final throughput after an assistant response completes', async () => {
    await renderMessageList(
      true,
      assistantMessage({ status: 'completed', estimatedThroughputTps: 65 })
    )
    expect(host?.querySelector('.dz-message-meta')?.textContent).toContain('65t/s')
    expect(host?.querySelector('.dz-message-meta')?.textContent).not.toContain('正在生成')
  })

  it('offers retry only for the latest failed assistant message', async () => {
    const onRetryMessage = vi.fn()
    const failed = assistantMessage({ status: 'error', errorMessage: '网络错误' })
    await renderMessageList(true, failed, failed.id, onRetryMessage)
    await act(async () => {
      host?.querySelector<HTMLButtonElement>('[aria-label="重新生成"]')?.click()
    })
    expect(onRetryMessage).toHaveBeenCalledWith(failed)
  })

  it('does not offer retry for an older failed assistant message', async () => {
    const failed = assistantMessage({ status: 'error', errorMessage: '网络错误' })
    await renderMessageList(true, failed, failed.id + 1, vi.fn())
    expect(host?.querySelector('[aria-label="重新生成"]')).toBeNull()
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
