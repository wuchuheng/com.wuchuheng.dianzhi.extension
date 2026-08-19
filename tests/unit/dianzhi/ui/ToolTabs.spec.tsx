import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ToolTabs } from '@/dianzhi/ui/ToolTabs'
import type { ToolConversationRef } from '@/dianzhi/domain/protocol'
import type { ToolDefinition } from '@/dianzhi/domain/types'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

function tool(id: number, name = `tool-${id}`): ToolDefinition {
  return {
    id,
    name,
    builtin: true,
    enabled: true,
    isDefault: false,
    promptMode: 'fixed',
    customPrompt: '',
  }
}

function toolRef(id: number, conversationId: number | null): ToolConversationRef {
  return { tool: tool(id), conversationId }
}

async function renderToolTabs(
  tools: ToolConversationRef[],
  activeToolId: number,
  onSelect = vi.fn()
) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<ToolTabs tools={tools} activeToolId={activeToolId} onSelect={onSelect} />)
  })
  return host
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.clearAllMocks()
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

describe('ToolTabs session indicator', () => {
  it('renders one tab per tool with its number', async () => {
    await renderToolTabs([toolRef(1, null), toolRef(2, 10)], 1)
    const tabs = host?.querySelectorAll('.dz-tab')
    expect(tabs).toHaveLength(2)
    expect(tabs?.[0]?.textContent).toContain('1')
    expect(tabs?.[1]?.textContent).toContain('2')
  })

  it('never renders the session dot', async () => {
    await renderToolTabs([toolRef(1, 10)], 1)
    expect(host?.querySelector('.dz-tab-new')).toBeNull()
  })

  it('marks the number with has-conversation only when a session exists', async () => {
    await renderToolTabs([toolRef(1, null), toolRef(2, 10)], 1)
    const tabs = Array.from(host?.querySelectorAll('.dz-tab') ?? [])
    const indexes = tabs.map((tab) => tab.querySelector('.dz-tab-index'))
    expect(indexes[0]?.classList.contains('has-conversation')).toBe(false)
    expect(indexes[1]?.classList.contains('has-conversation')).toBe(true)
  })

  it('selects a tool on click', async () => {
    const onSelect = vi.fn()
    await renderToolTabs([toolRef(1, null), toolRef(2, null)], 1, onSelect)
    const secondTab = host?.querySelectorAll('.dz-tab')[1]
    act(() => secondTab?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onSelect).toHaveBeenCalledWith(2)
  })
})
