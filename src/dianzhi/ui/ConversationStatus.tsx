import type { MessageRecord } from '@/dianzhi/domain/protocol'

export function ConversationStatus({ message }: { message: MessageRecord | null }) {
  if (!message) return null
  // Errors are already surfaced by the inline alert (role="alert") plus the
  // retry action — a third "生成失败" line would be redundant noise.
  const label =
    message.status === 'streaming' ? '正在生成' : message.status === 'stopped' ? '已停止' : ''
  return label ? (
    <span className={`dz-status is-${message.status}`} aria-live="polite">
      {label}
    </span>
  ) : null
}
