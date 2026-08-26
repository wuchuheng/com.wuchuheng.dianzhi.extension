import type { KeyboardEvent, RefObject } from 'react'

export interface ComposerProps {
  value: string
  /** Hard-disables typing and sending for the whole composer. Independent of `streaming`. */
  disabled?: boolean
  /** True while a provider run is streaming. The textarea stays editable for a
   *  next draft, the single send button becomes a stop control, and sending is
   *  suppressed (Enter and click) until the run ends. */
  streaming?: boolean
  inputRef?: RefObject<HTMLTextAreaElement | null>
  onChange(value: string): void
  onSend(): void
  /** Fired when the merged button is clicked while streaming. */
  onStop?(): void
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}

export function Composer({
  value,
  disabled,
  streaming = false,
  onChange,
  onSend,
  onStop,
  inputRef,
}: ComposerProps) {
  const active = streaming
  const submit = () => {
    if (!disabled && !active && value.trim()) onSend()
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
        ref={inputRef}
        rows={2}
        value={value}
        disabled={disabled}
        placeholder="继续询问…"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        aria-label={active ? '停止生成' : '发送消息'}
        title={active ? '停止生成' : '发送消息'}
        data-state={active ? 'stop' : 'send'}
        disabled={!active && (disabled || !value.trim())}
        onClick={active ? onStop : submit}
      >
        {active ? <StopIcon /> : <SendIcon />}
      </button>
    </div>
  )
}
