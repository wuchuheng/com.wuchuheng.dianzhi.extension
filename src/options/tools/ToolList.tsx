import { useState } from 'react'
import { toToolDefinition } from '@/dianzhi/domain/settings'
import type { ToolRecord } from '@/offscreen/database/config-store'
import { orderedIdsOnDrop } from './tool-workspace-state'

export interface ToolListProps {
  tools: readonly ToolRecord[]
  selectedId: number | null
  onSelect(id: number): void
  onToggleEnabled(id: number, enabled: boolean): void
  onReorder(orderedIds: number[]): void
  onAdd(): void
}

interface DragOverState {
  id: number
  before: boolean
}

/**
 * The fixed-width tool pane: draggable rows with default/preset badges, and a
 * compact create button. Drops resolve to the full ordered id list, which the
 * workspace persists through `toolsApi.reorder`.
 */
export function ToolList(props: ToolListProps) {
  const { tools } = props
  const [dragOver, setDragOver] = useState<DragOverState | null>(null)

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
        <button type="button" className="secondary" onClick={props.onAdd}>
          + 添加自定义工具
        </button>
      </div>
      <ul className="tool-list">
        {tools.map((tool, index) => {
          const selected = tool.id === props.selectedId
          const definition = toToolDefinition(tool)
          const modeLabel = definition.promptMode === 'preset' ? '内置' : '自定义'
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
                ⠿
              </span>
              <button
                type="button"
                className={`tool-row-name${tool.isDefault ? ' tool-row-default' : ''}`}
                aria-label={`选择工具 ${tool.name}`}
                aria-current={selected ? 'true' : undefined}
                onClick={(event) => {
                  event.stopPropagation()
                  props.onSelect(tool.id)
                }}
              >
                {tool.name}
              </button>
              {tool.isDefault && (
                <span className="tool-badge default" aria-label="默认工具">
                  默认
                </span>
              )}
              <span
                className={`tool-badge ${definition.promptMode === 'preset' ? 'preset' : 'custom'}`}
              >
                {modeLabel}
              </span>
              <input
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
                  ↑
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
                  ↓
                </button>
              </span>
              <span className="drop-line drop-after" aria-hidden="true" />
            </li>
          )
        })}
      </ul>
      {tools.length === 0 && <p className="tool-empty">还没有工具，添加一个试试。</p>}
    </div>
  )
}
