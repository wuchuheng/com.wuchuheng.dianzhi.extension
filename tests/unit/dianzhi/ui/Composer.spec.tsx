import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Composer } from '@/dianzhi/ui/Composer'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

interface RenderProps {
  value?: string
  disabled?: boolean
  streaming?: boolean
}

async function renderComposer(props: RenderProps = {}) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const onChange = vi.fn()
  const onSend = vi.fn()
  const onStop = vi.fn()
  await act(async () => {
    root?.render(
      <Composer
        value={props.value ?? ''}
        disabled={props.disabled}
        streaming={props.streaming}
        onChange={onChange}
        onSend={onSend}
        onStop={onStop}
      />
    )
  })
  const textarea = host?.querySelector<HTMLTextAreaElement>('textarea')
  const button = host?.querySelector<HTMLButtonElement>('button')
  return { textarea, button, onChange, onSend, onStop }
}

function pressEnter(textarea?: HTMLTextAreaElement | null) {
  act(() => {
    textarea?.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' })
    )
  })
}

function clickButton(button?: HTMLButtonElement | null) {
  act(() => {
    button?.click()
  })
}

afterEach(() => {
  vi.clearAllMocks()
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

describe('Composer while streaming', () => {
  it('keeps the textarea editable', async () => {
    const { textarea } = await renderComposer({ streaming: true, value: 'draft' })
    expect(textarea?.disabled).toBe(false)
  })

  it('accepts typed input', async () => {
    const { textarea, onChange } = await renderComposer({ streaming: true, value: '' })
    expect(textarea).not.toBeNull()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        'value'
      )!.set!
      setter.call(textarea, 'next')
      textarea?.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onChange).toHaveBeenCalledWith('next')
  })

  it('does not send on Enter and stops on button click', async () => {
    const { textarea, button, onSend, onStop } = await renderComposer({
      streaming: true,
      value: 'draft',
    })
    pressEnter(textarea)
    expect(onSend).not.toHaveBeenCalled()
    clickButton(button)
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(onSend).not.toHaveBeenCalled()
  })
})

describe('Composer while idle', () => {
  it('sends on Enter and on button click when a draft is present', async () => {
    const { textarea, button, onSend } = await renderComposer({ value: 'hello' })
    pressEnter(textarea)
    expect(onSend).toHaveBeenCalledTimes(1)
    clickButton(button)
    expect(onSend).toHaveBeenCalledTimes(2)
  })
})

describe('Composer hard-locked', () => {
  it('disables typing and send when disabled', async () => {
    const { textarea, button, onSend } = await renderComposer({ disabled: true, value: 'x' })
    expect(textarea?.disabled).toBe(true)
    expect(button?.disabled).toBe(true)
    pressEnter(textarea)
    expect(onSend).not.toHaveBeenCalled()
  })
})
