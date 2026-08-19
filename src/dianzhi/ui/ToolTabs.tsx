import type { KeyboardEvent } from 'react'
import type { ToolConversationRef } from '@/dianzhi/domain/protocol'
import { formatShortcut } from '@/dianzhi/domain/shortcuts'
import { nextToolId } from './tool-tabs-state'

export interface ToolTabsProps {
  tools: readonly ToolConversationRef[]
  activeToolId: number
  onSelect(toolId: number): void
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
      {tools.map(({ tool, conversationId }, index) => (
        <button
          key={tool.id}
          type="button"
          role="tab"
          aria-selected={tool.id === activeToolId}
          tabIndex={tool.id === activeToolId ? 0 : -1}
          className={`dz-tab${tool.id === activeToolId ? ' is-active' : ''}`}
          title={`${tool.name}${conversationId !== null ? '（已有会话）' : ''} (${formatShortcut(`Control+Shift+${index + 1}`)})`}
          onClick={() => onSelect(tool.id)}
        >
          {tool.name}
          <span
            className={`dz-tab-index${conversationId !== null ? ' has-conversation' : ''}`}
            aria-hidden="true"
          >
            {index + 1}
          </span>
        </button>
      ))}
    </div>
  )
}
