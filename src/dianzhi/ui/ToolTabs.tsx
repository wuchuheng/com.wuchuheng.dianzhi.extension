import type { KeyboardEvent } from 'react'
import type { ToolConversationRef } from '@/dianzhi/domain/protocol'
import { nextToolId } from './tool-tabs-state'

export interface ToolTabsProps {
  tools: readonly ToolConversationRef[]
  activeToolId: string
  onSelect(toolId: string): void
}

export function ToolTabs({ tools, activeToolId, onSelect }: ToolTabsProps) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const direction = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : null
    if (direction === null) return
    event.preventDefault()
    const toolId = nextToolId(tools, activeToolId, direction)
    if (toolId) onSelect(toolId)
  }

  return (
    <div className="dz-tabs" role="tablist" aria-label="查询工具" onKeyDown={onKeyDown}>
      {tools.map(({ tool, conversationId }) => (
        <button
          key={tool.id}
          type="button"
          role="tab"
          aria-selected={tool.id === activeToolId}
          tabIndex={tool.id === activeToolId ? 0 : -1}
          className={`dz-tab${tool.id === activeToolId ? ' is-active' : ''}`}
          onClick={() => onSelect(tool.id)}
        >
          {tool.name}
          {conversationId === null && <span className="dz-tab-new" aria-label="尚未查询" />}
        </button>
      ))}
    </div>
  )
}
