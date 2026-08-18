import { effectivePrompt } from '@/dianzhi/domain/settings'
import type { ToolDefinition } from '@/dianzhi/domain/types'

export interface ToolConfigProps {
  tool: ToolDefinition | null
  defaultToolId: string
  isDefaultTool: boolean
  defaultOptions: readonly ToolDefinition[]
  onUpdate(patch: Partial<ToolDefinition>): void
  onSetDefault(id: string): void
  onRemove(): void
}

/**
 * The flexible configuration pane for the active tool. Changes flow straight
 * into the shared settings draft and persist through the global save bar.
 */
export function ToolConfig(props: ToolConfigProps) {
  const { tool } = props
  const preset = tool?.promptMode === 'preset'
  const promptValue = tool ? (preset ? effectivePrompt(tool) : tool.customPrompt) : ''

  return (
    <div className="tool-config-pane">
      <h2 className="pane-title">工具配置</h2>
      {tool === null && <p className="pane-empty">请选择一个工具。</p>}
      {tool !== null && (
        <>
          {!tool.enabled && (
            <p className="tool-field-hint" role="status">
              此工具已停用，配置仍可编辑。
            </p>
          )}
          <label>
            名称
            <input
              aria-label="工具名称"
              value={tool.name}
              onChange={(event) => props.onUpdate({ name: event.target.value })}
            />
          </label>
          <label className="switch-row">
            <input
              aria-label="启用工具"
              type="checkbox"
              checked={tool.enabled}
              onChange={(event) => props.onUpdate({ enabled: event.target.checked })}
            />
            启用工具
          </label>
          <label>
            提示词模式
            <select
              aria-label="提示词模式"
              value={tool.promptMode}
              onChange={(event) =>
                props.onUpdate({ promptMode: event.target.value as 'preset' | 'custom' })
              }
            >
              <option value="preset" disabled={!tool.builtin}>
                内置
              </option>
              <option value="custom">自定义</option>
            </select>
          </label>
          <label>
            提示词
            <textarea
              aria-label="提示词"
              readOnly={preset}
              value={promptValue}
              onChange={(event) => props.onUpdate({ customPrompt: event.target.value })}
            />
          </label>
          <label>
            默认工具
            <select
              aria-label="默认工具"
              value={props.defaultToolId}
              onChange={(event) => props.onSetDefault(event.target.value)}
            >
              {props.defaultOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </label>
          {props.isDefaultTool && (
            <p className="tool-default-badge" role="status">
              当前活跃编辑的工具是默认工具
            </p>
          )}
          {!tool.builtin && (
            <button type="button" className="danger" onClick={props.onRemove}>
              删除工具
            </button>
          )}
        </>
      )}
    </div>
  )
}
