import type { MessageRecord } from '@/dianzhi/domain/protocol'

export function ConversationStatus({ message }: { message: MessageRecord | null }) {
  if (!message) return null
  const label =
    message.status === 'streaming'
      ? '正在生成'
      : message.status === 'error'
        ? '生成失败'
        : message.status === 'stopped'
          ? '已停止'
          : ''
  return label ? (
    <span className={`dz-status is-${message.status}`} aria-live="polite">
      {label}
    </span>
  ) : null
}
