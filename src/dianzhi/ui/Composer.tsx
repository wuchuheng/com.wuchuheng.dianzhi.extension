import type { KeyboardEvent } from 'react'

export interface ComposerProps {
  value: string
  disabled?: boolean
  onChange(value: string): void
  onSend(): void
}

export function Composer({ value, disabled, onChange, onSend }: ComposerProps) {
  const submit = () => {
    if (!disabled && value.trim()) onSend()
  }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  }
  return (
    <div className="dz-composer">
      <textarea
        aria-label="继续对话"
        rows={2}
        value={value}
        disabled={disabled}
        placeholder="继续询问…"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        aria-label="发送消息"
        disabled={disabled || !value.trim()}
        onClick={submit}
      >
        ↑
      </button>
    </div>
  )
}
