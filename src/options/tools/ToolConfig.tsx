import { Markdown } from '@/dianzhi/ui/Markdown'
import { useEffect, useRef, useState } from 'react'
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
 * The flexible configuration pane for the active tool. Name, enabled state,
 * and prompt are edited in a local draft and autosaved through `onPatch`; the
 * prompt editor opens as a preview popover; the reset button restores a
 * preset row's built-in prompt.
 */
export function ToolConfig(props: ToolConfigProps) {
  const { tool, onPatch, onRemove } = props
  const presetPrompt = tool ? builtinPromptFor(tool.id) : null
  const promptMode = tool ? toToolDefinition(tool).promptMode : null

  const [draft, setDraft] = useState(() => initialDraft(tool))
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [promptOpen, setPromptOpen] = useState(false)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const noticeTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
    }
  }, [])

  const dirty =
    tool !== null &&
    (draft.name !== tool.name || draft.prompt !== tool.prompt || draft.enabled !== tool.enabled)

  useEffect(() => {
    if (tool === null || !dirty) return
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    const patch: ToolUpdatePatch = {}
    if (draft.name !== tool.name) patch.name = draft.name
    if (draft.prompt !== tool.prompt) patch.prompt = draft.prompt
    if (draft.enabled !== tool.enabled) patch.enabled = draft.enabled
    if (Object.keys(patch).length === 0) return
    saveTimerRef.current = window.setTimeout(() => {
      onPatch(patch)
      setSaveNotice('已保存')
      if (noticeTimerRef.current !== null) window.clearTimeout(noticeTimerRef.current)
      noticeTimerRef.current = window.setTimeout(() => setSaveNotice(null), 1200)
    }, 350)
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    }
  }, [draft.name, draft.prompt, draft.enabled, tool, dirty, onPatch])

  if (tool === null) {
    return (
      <div className="tool-config-pane">
        <h2 className="pane-title">工具配置</h2>
        <p className="pane-empty">请选择一个工具。</p>
      </div>
    )
  }

  return (
    <div className="tool-config-pane">
      <div className="tool-config-header">
        <h2 className="pane-title">工具配置</h2>
        <button
          type="button"
          className="secondary tool-prompt-open"
          onClick={() => setPromptOpen(true)}
        >
          编辑提示词
        </button>
      </div>
      {saveNotice && (
        <p className="tool-save-notice" role="status" aria-live="polite">
          {saveNotice}
        </p>
      )}
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
        <button
          type="button"
          className="secondary tool-prompt-launch"
          onClick={() => setPromptOpen(true)}
        >
          在弹窗中编辑
        </button>
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
          onClick={() => setDraft({ ...draft, prompt: presetPrompt })}
        >
          重置为内置提示词
        </button>
      )}
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
                  onRemove()
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

      <div className="tool-prompt-popover" hidden={!promptOpen}>
        <button
          type="button"
          className="tool-prompt-backdrop"
          aria-label="关闭提示词编辑器"
          onClick={() => setPromptOpen(false)}
        />
        <section
          className="tool-prompt-panel"
          role="dialog"
          aria-modal="true"
          aria-label="提示词编辑器"
        >
          <div className="tool-prompt-panel-header">
            <div>
              <strong>提示词编辑器</strong>
              <p className="tool-field-hint">左侧编辑 Markdown，右侧实时预览渲染结果。</p>
            </div>
            <button type="button" className="secondary" onClick={() => setPromptOpen(false)}>
              关闭
            </button>
          </div>
          <div className="tool-prompt-grid">
            <label className="tool-prompt-source-pane">
              Markdown 源码
              <textarea
                className="tool-prompt-source"
                aria-label="提示词 Markdown 源码"
                value={draft.prompt}
                onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
              />
            </label>
            <div className="tool-prompt-preview-pane">
              <p className="tool-prompt-preview-title">渲染预览</p>
              <div className="tool-prompt-preview">
                <Markdown source={draft.prompt || ' '} />
              </div>
            </div>
          </div>
        </section>
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
