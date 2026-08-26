import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ToolList } from '@/options/tools/ToolList'
import type { ToolRecord } from '@/offscreen/database/config-store'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

const removedTool: ToolRecord = {
  id: 77,
  name: '旧工具',
  prompt: '# x',
  enabled: false,
  isDefault: false,
  isPreset: false,
  deletedAt: '2026-08-20T00:00:00.000Z',
  sortOrder: 1,
  createdAt: '2026-08-20T00:00:00.000Z',
  updatedAt: '2026-08-20T00:00:00.000Z',
}

function renderToolList() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  const handlers = {
    onSelect: vi.fn(),
    onToggleEnabled: vi.fn(),
    onSetDefault: vi.fn(),
    onReorder: vi.fn(),
    onAdd: vi.fn(),
    onRestore: vi.fn(),
    onDelete: vi.fn(),
  }
  act(() => {
    root?.render(
      <ToolList
        tools={[]}
        removed={[removedTool]}
        selectedId={null}
        onSelect={handlers.onSelect}
        onToggleEnabled={handlers.onToggleEnabled}
        onSetDefault={handlers.onSetDefault}
        onReorder={handlers.onReorder}
        onAdd={handlers.onAdd}
        onRestore={handlers.onRestore}
        onDelete={handlers.onDelete}
      />
    )
  })
  return { host, handlers }
}

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

describe('ToolList removed tools', () => {
  it('renders a permanent-delete button next to restore', () => {
    renderToolList()
    expect(host?.querySelector('.removed-tool-restore')).not.toBeNull()
    expect(host?.querySelector('.removed-tool-delete')).not.toBeNull()
  })

  it('opens the confirm dialog with the tool name and cancels without deleting', () => {
    const { host, handlers } = renderToolList()
    act(() => host?.querySelector<HTMLButtonElement>('.removed-tool-delete')?.click())
    const dialog = host?.querySelector('.tool-delete-dialog')
    expect(dialog).not.toBeNull()
    expect(dialog?.textContent).toContain('旧工具')
    act(() => host?.querySelector<HTMLButtonElement>('.tool-delete-dialog .secondary')?.click())
    expect(host?.querySelector('.tool-delete-dialog')).toBeNull()
    expect(handlers.onDelete).not.toHaveBeenCalled()
  })

  it('calls onDelete once with the tool id on confirm', () => {
    const { host, handlers } = renderToolList()
    act(() => host?.querySelector<HTMLButtonElement>('.removed-tool-delete')?.click())
    act(() =>
      host?.querySelector<HTMLButtonElement>('.tool-delete-dialog-actions .danger')?.click()
    )
    expect(handlers.onDelete).toHaveBeenCalledTimes(1)
    expect(handlers.onDelete).toHaveBeenCalledWith(77)
    expect(host?.querySelector('.tool-delete-dialog')).toBeNull()
  })

  it('closes the dialog on backdrop click without deleting', () => {
    const { host, handlers } = renderToolList()
    act(() => host?.querySelector<HTMLButtonElement>('.removed-tool-delete')?.click())
    act(() => host?.querySelector<HTMLButtonElement>('.tool-delete-dialog-backdrop')?.click())
    expect(host?.querySelector('.tool-delete-dialog')).toBeNull()
    expect(handlers.onDelete).not.toHaveBeenCalled()
  })

  it('closes the dialog on Escape without deleting', () => {
    const { host, handlers } = renderToolList()
    act(() => host?.querySelector<HTMLButtonElement>('.removed-tool-delete')?.click())
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(host?.querySelector('.tool-delete-dialog')).toBeNull()
    expect(handlers.onDelete).not.toHaveBeenCalled()
  })
})
