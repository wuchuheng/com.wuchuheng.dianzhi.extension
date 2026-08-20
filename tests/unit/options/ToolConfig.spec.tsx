import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolConfig } from '@/options/tools/ToolConfig'
import type { ToolRecord } from '@/offscreen/database/config-store'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

const tool: ToolRecord = {
  id: 77,
  name: '查询工具',
  prompt: '# 标题\n\n**粗体**',
  enabled: true,
  isDefault: false,
  isPreset: false,
  deletedAt: null,
  sortOrder: 1,
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
}

function setInputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value')
  descriptor?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

async function renderToolConfig(onPatch = vi.fn(), onRemove = vi.fn()) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<ToolConfig tool={tool} onPatch={onPatch} onRemove={onRemove} />)
  })
  return host
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  vi.useRealTimers()
})

describe('ToolConfig prompt editor', () => {
  it('does not render a save button and opens a markdown preview popover', async () => {
    const container = await renderToolConfig()
    expect(container.querySelector('button.primary')).toBeNull()

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.tool-prompt-open')?.click()
    })

    expect(container.querySelector('.tool-prompt-popover')).not.toBeNull()
    expect(container.querySelector('.tool-prompt-panel')).not.toBeNull()
    expect(container.querySelector('.tool-prompt-source')).not.toBeNull()
    expect(container.querySelector('.tool-prompt-preview')).not.toBeNull()
    expect(container.querySelector('.tool-prompt-preview strong')?.textContent).toBe('粗体')
  })

  it('autosaves prompt edits from the popover', async () => {
    const onPatch = vi.fn()
    const container = await renderToolConfig(onPatch)

    await act(async () => {
      container.querySelector<HTMLButtonElement>('.tool-prompt-open')?.click()
    })

    const textarea = container.querySelector<HTMLTextAreaElement>('.tool-prompt-source')
    expect(textarea).not.toBeNull()

    await act(async () => {
      setInputValue(textarea!, '# 新标题\n\n内容')
      await Promise.resolve()
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })

    expect(onPatch).toHaveBeenCalledWith(expect.objectContaining({ prompt: '# 新标题\n\n内容' }))
  })
})
