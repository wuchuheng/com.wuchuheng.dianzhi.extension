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
  /** Render the created time and a copy button on every chat bubble (Side Panel). */
  showMeta?: boolean
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

function CopyButton({ content, disabled }: { content: string; disabled: boolean }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
  }, [])

  const onCopy = async () => {
    if (!content) return
    try {
      await navigator.clipboard.writeText(markdownToPlainText(content))
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
        className="dz-message-copy"
        disabled={disabled || !content}
        onClick={onCopy}
        aria-label="复制回复"
        title="复制回复"
      >
        <CopyGlyph />
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
}: {
  message: MessageRecord
  reasoningEnabled: boolean
  showMeta: boolean | undefined
}) {
  return (
    <article className={`dz-message is-${message.role}`} data-status={message.status}>
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
      {showMeta && (
        <div className="dz-message-meta">
          <time dateTime={message.createdAt}>{formatMessageTime(message.createdAt)}</time>
          <CopyButton content={message.content} disabled={message.status === 'streaming'} />
        </div>
      )}
    </article>
  )
}

export function MessageList({ messages, mode, reasoningEnabled, showMeta }: MessageListProps) {
  const visible =
    mode === 'card'
      ? messages.filter((message) => message.role === 'assistant').slice(-1)
      : messages
  if (visible.length === 0) {
    return <div className="dz-empty">正在理解所选内容…</div>
  }
  return (
    <div className={`dz-messages is-${mode}`} role="log" aria-live="polite">
      {visible.map((message) => (
        <Message
          key={message.id}
          message={message}
          reasoningEnabled={reasoningEnabled}
          showMeta={showMeta}
        />
      ))}
    </div>
  )
}
