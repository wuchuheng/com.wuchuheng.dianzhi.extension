import type { MessageRecord } from '@/dianzhi/domain/protocol'
import { Markdown } from './Markdown'
import { Reasoning } from './Reasoning'

export interface MessageListProps {
  messages: readonly MessageRecord[]
  mode: 'card' | 'chat'
  reasoningEnabled: boolean
}

function Message({
  message,
  reasoningEnabled,
}: {
  message: MessageRecord
  reasoningEnabled: boolean
}) {
  return (
    <article className={`dz-message is-${message.role}`} data-status={message.status}>
      <div className="dz-message-role">{message.role === 'user' ? '你' : '点知'}</div>
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
    </article>
  )
}

export function MessageList({ messages, mode, reasoningEnabled }: MessageListProps) {
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
        <Message key={message.id} message={message} reasoningEnabled={reasoningEnabled} />
      ))}
    </div>
  )
}
