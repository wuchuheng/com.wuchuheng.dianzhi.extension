import { useEffect, useState } from 'react'
import type { ToolRecord } from '@/offscreen/database/config-store'
import { orderedIdsOnDrop } from './tool-workspace-state'

export interface ToolListProps {
  tools: readonly ToolRecord[]
  removed: readonly ToolRecord[]
  selectedId: number | null
  onSelect(id: number): void
  onToggleEnabled(id: number, enabled: boolean): void
  onSetDefault(id: number): void
  onReorder(orderedIds: number[]): void
  onAdd(): void
  onRestore(id: number): void
  onDelete(id: number): void
}

interface DragOverState {
  id: number
  before: boolean
}

function GripIcon() {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
      <circle cx="2.5" cy="3" r="1.5" />
      <circle cx="7.5" cy="3" r="1.5" />
      <circle cx="2.5" cy="8" r="1.5" />
      <circle cx="7.5" cy="8" r="1.5" />
      <circle cx="2.5" cy="13" r="1.5" />
      <circle cx="7.5" cy="13" r="1.5" />
    </svg>
  )
}

function ChevronIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {direction === 'up' ? <path d="M6 15l6-6 6 6" /> : <path d="M6 9l6 6 6-6" />}
    </svg>
  )
}

function StarIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1-5.4-2.9-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

/**
 * The fixed-width tool pane: draggable rows with default/preset badges, a
 * compact create row, and a recoverable "removed" section. Drops resolve to
 * the full ordered id list, which the workspace persists through
 * `toolsApi.reorder`.
 */
export function ToolList(props: ToolListProps) {
  const { tools } = props
  const [dragOver, setDragOver] = useState<DragOverState | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<ToolRecord | null>(null)

  useEffect(() => {
    if (confirmingDelete === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setConfirmingDelete(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmingDelete])

  const handleDragStart = (event: React.DragEvent, id: number) => {
    event.dataTransfer.setData('text/plain', String(id))
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (event: React.DragEvent, id: number) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const bounds = event.currentTarget.getBoundingClientRect()
    const before = bounds.height === 0 || event.clientY < bounds.top + bounds.height / 2
    setDragOver({ id, before })
  }

  const dropBefore = (event: React.DragEvent): boolean => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return bounds.height === 0 || event.clientY < bounds.top + bounds.height / 2
  }

  const handleDrop = (event: React.DragEvent, id: number) => {
    event.preventDefault()
    setDragOver(null)
    const draggedId = Number(event.dataTransfer.getData('text/plain'))
    const next = orderedIdsOnDrop(
      tools.map((tool) => tool.id),
      draggedId,
      id,
      dropBefore(event)
    )
    if (next) props.onReorder(next)
  }

  return (
    <div className="tool-list-pane">
      <div className="pane-title-row">
        <span className="tool-list-count">共 {tools.length} 个工具</span>
      </div>
      <ul className="tool-list">
        {tools.map((tool, index) => {
          const selected = tool.id === props.selectedId
          const rowClasses = [
            'tool-row',
            selected ? 'selected' : '',
            dragOver?.id === tool.id ? (dragOver.before ? 'drag-before' : 'drag-after') : '',
          ]
            .filter(Boolean)
            .join(' ')
          return (
            <li
              key={tool.id}
              className={rowClasses}
              draggable
              onClick={() => props.onSelect(tool.id)}
              onDragStart={(event) => handleDragStart(event, tool.id)}
              onDragOver={(event) => handleDragOver(event, tool.id)}
              onDrop={(event) => handleDrop(event, tool.id)}
              onDragEnd={() => setDragOver(null)}
            >
              <span className="drop-line drop-before" aria-hidden="true" />
              <span className="tool-row-grip" aria-hidden="true">
                <GripIcon />
              </span>
              <button
                type="button"
                className={`tool-row-name${tool.isDefault ? ' tool-row-default' : ''}`}
                aria-label={`选择工具 ${tool.name}`}
                aria-current={selected ? 'true' : undefined}
                title={tool.name}
                onClick={(event) => {
                  event.stopPropagation()
                  props.onSelect(tool.id)
                }}
              >
                {tool.name}
              </button>
              <button
                type="button"
                className={`tool-row-default-toggle${tool.isDefault ? ' is-default' : ''}`}
                aria-label={
                  tool.isDefault ? `${tool.name} 是默认工具` : `设为默认工具：${tool.name}`
                }
                aria-pressed={tool.isDefault}
                title={tool.isDefault ? '默认工具' : '设为默认工具'}
                onClick={(event) => {
                  event.stopPropagation()
                  if (!tool.isDefault) props.onSetDefault(tool.id)
                }}
              >
                <StarIcon filled={tool.isDefault} />
              </button>
              <input
                className="tool-row-toggle"
                aria-label={tool.enabled ? `停用 ${tool.name}` : `启用 ${tool.name}`}
                type="checkbox"
                checked={tool.enabled}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => props.onToggleEnabled(tool.id, event.target.checked)}
              />
              <span className="tool-row-actions">
                <button
                  type="button"
                  aria-label={`上移 ${tool.name}`}
                  disabled={index === 0}
                  onClick={(event) => {
                    event.stopPropagation()
                    const next = orderedIdsOnDrop(
                      tools.map((item) => item.id),
                      tool.id,
                      tools[index - 1]!.id,
                      false
                    )
                    if (next) props.onReorder(next)
                  }}
                >
                  <ChevronIcon direction="up" />
                </button>
                <button
                  type="button"
                  aria-label={`下移 ${tool.name}`}
                  disabled={index === tools.length - 1}
                  onClick={(event) => {
                    event.stopPropagation()
                    const next = orderedIdsOnDrop(
                      tools.map((item) => item.id),
                      tool.id,
                      tools[index + 1]!.id,
                      true
                    )
                    if (next) props.onReorder(next)
                  }}
                >
                  <ChevronIcon direction="down" />
                </button>
              </span>
              <span className="drop-line drop-after" aria-hidden="true" />
            </li>
          )
        })}
        <li className="tool-add-row">
          <button type="button" className="tool-add-button" onClick={props.onAdd}>
            <PlusIcon />
            新建工具
          </button>
        </li>
      </ul>
      {tools.length === 0 && <p className="tool-empty">还没有工具，点击上方「新建工具」添加。</p>}
      {props.removed.length > 0 && (
        <section className="removed-tools" aria-label="已删除工具">
          <h3 className="removed-tools-title">已删除（{props.removed.length}）</h3>
          <ul className="removed-tools-list">
            {props.removed.map((tool) => (
              <li key={tool.id} className="removed-tool-row">
                <span className="removed-tool-name" title={tool.name}>
                  {tool.name}
                </span>
                <button
                  type="button"
                  className="removed-tool-restore"
                  aria-label={`恢复工具 ${tool.name}`}
                  onClick={() => props.onRestore(tool.id)}
                >
                  恢复
                </button>
                <button
                  type="button"
                  className="removed-tool-delete"
                  aria-label={`永久删除工具 ${tool.name}`}
                  onClick={() => setConfirmingDelete(tool)}
                >
                  永久删除
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {confirmingDelete !== null && (
        <div className="tool-delete-dialog-layer">
          <button
            type="button"
            className="tool-delete-dialog-backdrop"
            aria-label="取消永久删除"
            onClick={() => setConfirmingDelete(null)}
          />
          <section
            className="tool-delete-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-label="永久删除工具"
          >
            <h3 className="tool-delete-dialog-title">永久删除工具</h3>
            <p className="tool-delete-dialog-message">
              此操作将永久删除工具“{confirmingDelete.name}”，且不可恢复。是否继续？
            </p>
            <div className="tool-delete-dialog-actions">
              <button type="button" className="secondary" onClick={() => setConfirmingDelete(null)}>
                取消
              </button>
              <button
                type="button"
                className="danger"
                onClick={() => {
                  props.onDelete(confirmingDelete.id)
                  setConfirmingDelete(null)
                }}
              >
                确认删除
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
