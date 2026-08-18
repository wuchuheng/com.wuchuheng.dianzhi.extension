import { useState } from 'react'
import type { ToolDefinition } from '@/dianzhi/domain/types'

export interface ToolListProps {
  tools: readonly ToolDefinition[]
  selectedId: string | null
  onSelect(id: string): void
  onToggleEnabled(id: string, enabled: boolean): void
  onMove(id: string, direction: -1 | 1): void
  onReorder(draggedId: string, targetId: string, before: boolean): void
  onAdd(): void
}

interface DragOverState {
  id: string
  before: boolean
}

/**
 * The fixed-width tool pane: draggable rows, keyboard Move actions, and a
 * compact add button. Selection is announced with `aria-current`.
 */
export function ToolList(props: ToolListProps) {
  const { tools } = props
  const [dragOver, setDragOver] = useState<DragOverState | null>(null)

  const handleDragStart = (event: React.DragEvent, id: string) => {
    event.dataTransfer.setData('text/plain', id)
    event.dataTransfer.effectAllowed = 'move'
  }

  const handleDragOver = (event: React.DragEvent, tool: ToolDefinition) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const bounds = event.currentTarget.getBoundingClientRect()
    const before = bounds.height === 0 || event.clientY < bounds.top + bounds.height / 2
    setDragOver({ id: tool.id, before })
  }

  const dropBefore = (event: React.DragEvent): boolean => {
    const bounds = event.currentTarget.getBoundingClientRect()
    return bounds.height === 0 || event.clientY < bounds.top + bounds.height / 2
  }

  const handleDrop = (event: React.DragEvent, tool: ToolDefinition) => {
    event.preventDefault()
    setDragOver(null)
    const draggedId = event.dataTransfer.getData('text/plain')
    const fromIndex = tools.findIndex((item) => item.id === draggedId)
    const targetIndex = tools.findIndex((item) => item.id === tool.id)
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) return
    props.onReorder(draggedId, tool.id, dropBefore(event))
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
              onDragOver={(event) => handleDragOver(event, tool)}
              onDrop={(event) => handleDrop(event, tool)}
              onDragEnd={() => setDragOver(null)}
            >
              <span className="drop-line drop-before" aria-hidden="true" />
              <span className="tool-row-grip" aria-hidden="true">
                ⠿
              </span>
              <button
                type="button"
                className="tool-row-name"
                aria-label={`选择工具 ${tool.name}`}
                aria-current={selected ? 'true' : undefined}
                onClick={(event) => {
                  event.stopPropagation()
                  props.onSelect(tool.id)
                }}
              >
                {tool.name}
              </button>
              <span className={`tool-badge ${tool.promptMode === 'preset' ? 'preset' : 'custom'}`}>
                {tool.promptMode === 'preset' ? '内置' : '自定义'}
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
                    props.onMove(tool.id, -1)
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
                    props.onMove(tool.id, 1)
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
