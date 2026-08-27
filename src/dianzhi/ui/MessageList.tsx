import { useEffect, useRef, useState } from 'react'
import type { MessageRecord } from '@/dianzhi/domain/protocol'
import { formatMessageTime } from './message-time'
import { markdownToPlainText } from './markdown-text'
import { Markdown } from './Markdown'
import { Reasoning } from './Reasoning'

export interface MessageListProps {
  messages: readonly MessageRecord[]
  mode: 'card' | 'chat'
  reasoningEnabled: boolean
  /** Render the time plus plain-text and Markdown copy actions on every message bubble. */
  showMeta?: boolean
  latestAssistantId?: number
  onRetryMessage?(message: MessageRecord): void
}

function RetryGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 11a8 8 0 1 0 2 5.5" />
      <path d="M20 4v7h-7" />
    </svg>
  )
}

function CopyGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  )
}

function MarkdownGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={12}
      height={12}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m7 8-4 4 4 4" />
      <path d="m17 8 4 4-4 4" />
      <path d="m14 5-4 14" />
    </svg>
  )
}

function CopyButton({
  content,
  disabled,
  format,
}: {
  content: string
  disabled: boolean
  format: 'plainText' | 'markdown'
}) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)
  const isMarkdown = format === 'markdown'
  const label = isMarkdown ? '复制 Markdown' : '复制纯文本'

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const onCopy = async () => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(isMarkdown ? content : markdownToPlainText(content))
    } catch {
      return
    }
    setCopied(true)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => setCopied(false), 1500)
  }

  return (
    <>
      <button
        type="button"
        className={`dz-message-copy${isMarkdown ? ' is-markdown' : ''}`}
        disabled={disabled || !content}
        onClick={onCopy}
        aria-label={label}
        title={label}
      >
        {isMarkdown ? <MarkdownGlyph /> : <CopyGlyph />}
      </button>
      {copied && (
        <span className="dz-copy-toast" role="status">
          已复制
        </span>
      )}
    </>
  )
}

function Message({
  message,
  reasoningEnabled,
  showMeta,
  latestAssistantId,
  onRetryMessage,
}: {
  message: MessageRecord
  reasoningEnabled: boolean
  showMeta: boolean | undefined
  latestAssistantId: number | undefined
  onRetryMessage: ((message: MessageRecord) => void) | undefined
}) {
  const status =
    message.status === 'streaming' ? '正在生成' : message.status === 'stopped' ? '已停止' : null
  const terminal = message.status !== 'streaming'
  const retryable =
    message.role === 'assistant' &&
    message.status === 'error' &&
    message.id === latestAssistantId &&
    onRetryMessage !== undefined
  const bubble = (
    <div className={`dz-message is-${message.role}`} data-status={message.status}>
      <div className="dz-message-role">{message.role === 'user' ? '你:' : '点知:'}</div>
      {message.content ? (
        <Markdown source={message.content} />
      ) : message.status === 'streaming' ? (
        <div className="dz-thinking" aria-label="正在生成">
          <span />
          <span />
          <span />
        </div>
      ) : null}
      {message.role === 'assistant' && (
        <Reasoning enabled={reasoningEnabled} content={message.reasoningContent} />
      )}
      {message.errorMessage && <p className="dz-message-error">{message.errorMessage}</p>}
    </div>
  )
  if (!showMeta) return bubble
  return (
    <article className={`dz-message-item is-${message.role}`} data-status={message.status}>
      {bubble}
      <div className="dz-message-meta">
        <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
        {terminal &&
          message.role === 'assistant' &&
          typeof message.estimatedThroughputTps === 'number' && (
            <span>{message.estimatedThroughputTps}t/s</span>
          )}
        {status && <span>{status}</span>}
        {terminal && message.content && (
          <>
            <CopyButton content={message.content} disabled={false} format="plainText" />
            <CopyButton content={message.content} disabled={false} format="markdown" />
          </>
        )}
        {retryable && (
          <button
            type="button"
            className="dz-message-copy"
            onClick={() => onRetryMessage(message)}
            aria-label="重新生成"
            title="重新生成"
          >
            <RetryGlyph />
          </button>
        )}
      </div>
    </article>
  )
}

export function MessageList({
  messages,
  mode,
  reasoningEnabled,
  showMeta,
  latestAssistantId,
  onRetryMessage,
}: MessageListProps) {
  const visible =
    mode === 'card'
      ? messages.filter((message) => message.role === 'assistant').slice(-1)
      : messages
  if (visible.length === 0) {
    return <div className="dz-empty">正在理解所选内容…</div>
  }
  const visibleLatestAssistantId = [...visible]
    .reverse()
    .find((message) => message.role === 'assistant')?.id
  const retryLatestAssistantId = latestAssistantId ?? visibleLatestAssistantId
  return (
    <div className={`dz-messages is-${mode}`} role="log" aria-live="polite">
      {visible.map((message) => {
        return (
          <Message
            key={message.id}
            message={message}
            reasoningEnabled={reasoningEnabled}
            showMeta={showMeta}
            latestAssistantId={retryLatestAssistantId}
            onRetryMessage={onRetryMessage}
          />
        )
      })}
    </div>
  )
}
