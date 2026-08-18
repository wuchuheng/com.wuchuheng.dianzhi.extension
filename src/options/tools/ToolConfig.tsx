import { useState } from 'react'
import { BUILTIN_PROMPTS, PRESET_TOOL_IDS } from '@/dianzhi/domain/presets'
import { toToolDefinition } from '@/dianzhi/domain/settings'
import type { ToolUpdatePatch } from '@/dianzhi/domain/protocol'
import type { ToolRecord } from '@/offscreen/database/config-store'

export interface ToolConfigProps {
  tool: ToolRecord | null
  onPatch(patch: ToolUpdatePatch): void
  onRemove(): void
}

/**
 * The flexible configuration pane for the active tool. Name and prompt are
 * edited in a local draft and committed through one `onPatch` call; the reset
 * button restores a preset row's built-in prompt; the default select flips
 * `isDefault` on another tool (the server clears the previous default).
 */
export function ToolConfig(props: ToolConfigProps) {
  const { tool } = props
  const presetPrompt = tool ? builtinPromptFor(tool.id) : null
  const promptMode = tool ? toToolDefinition(tool).promptMode : null

  const [draft, setDraft] = useState(() => initialDraft(tool))
  const [confirmingRemove, setConfirmingRemove] = useState(false)

  if (tool === null) {
    return (
      <div className="tool-config-pane">
        <h2 className="pane-title">工具配置</h2>
        <p className="pane-empty">请选择一个工具。</p>
      </div>
    )
  }

  const dirty =
    draft.name !== tool.name || draft.prompt !== tool.prompt || draft.enabled !== tool.enabled

  const commit = () => {
    const patch: ToolUpdatePatch = {}
    if (draft.name !== tool.name) patch.name = draft.name
    if (draft.prompt !== tool.prompt) patch.prompt = draft.prompt
    if (draft.enabled !== tool.enabled) patch.enabled = draft.enabled
    if (Object.keys(patch).length > 0) props.onPatch(patch)
  }

  return (
    <div className="tool-config-pane">
      <h2 className="pane-title">工具配置</h2>
      {!tool.enabled && (
        <p className="tool-field-hint" role="status">
          此工具已停用，配置仍可编辑。
        </p>
      )}
      <label>
        名称
        <input
          aria-label="工具名称"
          value={draft.name}
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
        />
      </label>
      <label className="switch-row">
        <input
          aria-label="启用工具"
          type="checkbox"
          checked={draft.enabled}
          onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
        />
        启用工具
      </label>
      <label>
        提示词模式
        <select aria-label="提示词模式" value={promptMode ?? 'custom'} disabled>
          <option value="preset">内置</option>
          <option value="custom">自定义</option>
        </select>
      </label>
      <label>
        提示词
        <textarea
          aria-label="提示词"
          value={draft.prompt}
          onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
        />
      </label>
      {tool.isPreset && (
        <p className="tool-field-hint">
          内置工具的提示词可以按需修改；改动后可随时「重置为内置提示词」恢复原样。
        </p>
      )}
      {tool.isPreset && presetPrompt !== null && draft.prompt !== presetPrompt && (
        <button
          type="button"
          className="secondary"
          onClick={() => props.onPatch({ prompt: presetPrompt })}
        >
          重置为内置提示词
        </button>
      )}
      <div className="tool-config-actions">
        <button type="button" className="primary" disabled={!dirty} onClick={commit}>
          保存修改
        </button>
        {!tool.isPreset &&
          (confirmingRemove ? (
            <div className="tool-delete-confirm-group">
              <p className="tool-delete-confirm">
                删除后工具不再出现在列表中，可在左侧「已删除」中恢复。
              </p>
              <div className="tool-delete-actions">
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    setConfirmingRemove(false)
                    props.onRemove()
                  }}
                >
                  确认删除
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setConfirmingRemove(false)}
                >
                  取消
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="danger"
              aria-label={`删除工具 ${tool.name}`}
              onClick={() => setConfirmingRemove(true)}
            >
              删除工具
            </button>
          ))}
      </div>
    </div>
  )
}

function initialDraft(tool: ToolRecord | null) {
  return {
    name: tool?.name ?? '',
    prompt: tool?.prompt ?? '',
    enabled: tool?.enabled ?? true,
  }
}

function builtinPromptFor(id: number): string | null {
  for (const [builtinId, presetId] of Object.entries(PRESET_TOOL_IDS)) {
    if (presetId === id) return BUILTIN_PROMPTS[builtinId as keyof typeof BUILTIN_PROMPTS]
  }
  return null
}
