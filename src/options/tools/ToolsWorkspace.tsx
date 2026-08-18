import { useState } from 'react'
import type { DianzhiSettings, ToolDefinition } from '@/dianzhi/domain/types'
import {
  addCustomTool,
  moveTool,
  removeCustomTool,
  reorderToolsByTarget,
  setToolEnabled,
} from '@/options/settings-form'
import { ToolConfig } from './ToolConfig'
import { ToolList } from './ToolList'
import { ToolTestPane } from './ToolTestPane'
import { repairActiveTool } from './tool-workspace-state'
import { useToolTest, type UseToolTestResult } from './use-tool-test'
import './tool-workspace.css'

export interface ToolsWorkspaceProps {
  settings: DianzhiSettings
  onSettingsChange(settings: DianzhiSettings): void
  /** Injected only for deterministic tests; production uses the port hook. */
  testStream?: UseToolTestResult
}

export type DetailTab = 'config' | 'test'

/**
 * The tools workspace: a draggable tool list driving a configuration pane and
 * a live-test playground, all editing the shared settings draft.
 */
export function ToolsWorkspace(props: ToolsWorkspaceProps) {
  return props.testStream ? (
    <ToolsWorkspaceView {...props} testStream={props.testStream} />
  ) : (
    <ToolsWorkspaceConnected {...props} />
  )
}

function ToolsWorkspaceConnected(props: Omit<ToolsWorkspaceProps, 'testStream'>) {
  const testStream = useToolTest()
  return <ToolsWorkspaceView {...props} testStream={testStream} />
}

function ToolsWorkspaceView(props: ToolsWorkspaceProps & { testStream: UseToolTestResult }) {
  const { settings, onSettingsChange, testStream } = props
  const [pickedToolId, setPickedToolId] = useState<string | null>(() =>
    repairActiveTool(settings.tools, null, settings.ui.defaultToolId)
  )
  const [detailTab, setDetailTab] = useState<DetailTab>('config')

  // Resolve the selection during render so a removed tool falls back to the
  // default/first tool without any effect-driven corrective state update.
  const activeToolId = repairActiveTool(settings.tools, pickedToolId, settings.ui.defaultToolId)
  const activeTool = settings.tools.find((tool) => tool.id === activeToolId) ?? null
  const enabledTools = settings.tools.filter((tool) => tool.enabled)

  const updateTool = (id: string, patch: Partial<ToolDefinition>) =>
    onSettingsChange({
      ...settings,
      tools: settings.tools.map((tool) => (tool.id === id ? { ...tool, ...patch } : tool)),
    })

  const handleToggleEnabled = (id: string, enabled: boolean) =>
    onSettingsChange(setToolEnabled(settings, id, enabled))

  const handleMove = (id: string, direction: -1 | 1) =>
    onSettingsChange(moveTool(settings, id, direction))

  const handleReorder = (draggedId: string, targetId: string, before: boolean) =>
    onSettingsChange(reorderToolsByTarget(settings, draggedId, targetId, before))

  const handleAdd = () => {
    const previousIds = new Set(settings.tools.map((tool) => tool.id))
    const next = addCustomTool(settings)
    onSettingsChange(next)
    const added = next.tools.find((tool) => !previousIds.has(tool.id))
    if (added) setPickedToolId(added.id)
  }

  const handleRemove = (id: string) => onSettingsChange(removeCustomTool(settings, id))

  const handleSetDefault = (id: string) =>
    onSettingsChange({ ...settings, ui: { ...settings.ui, defaultToolId: id } })

  return (
    <div className="tool-workspace">
      <ToolList
        tools={settings.tools}
        selectedId={activeToolId}
        onSelect={setPickedToolId}
        onToggleEnabled={handleToggleEnabled}
        onMove={handleMove}
        onReorder={handleReorder}
        onAdd={handleAdd}
      />
      <div className="detail-tabs" role="tablist" aria-label="工具详情">
        <button
          type="button"
          role="tab"
          aria-selected={detailTab === 'config'}
          onClick={() => setDetailTab('config')}
        >
          配置
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={detailTab === 'test'}
          onClick={() => setDetailTab('test')}
        >
          测试
        </button>
      </div>
      <div className="tool-workspace-detail" hidden={detailTab !== 'config'}>
        <ToolConfig
          tool={activeTool}
          defaultToolId={settings.ui.defaultToolId}
          isDefaultTool={activeTool?.id === settings.ui.defaultToolId}
          defaultOptions={enabledTools}
          onUpdate={(patch) => {
            if (activeTool) updateTool(activeTool.id, patch)
          }}
          onSetDefault={handleSetDefault}
          onRemove={() => {
            if (activeTool && !activeTool.builtin) handleRemove(activeTool.id)
          }}
        />
      </div>
      <div className="tool-workspace-detail" hidden={detailTab !== 'test'}>
        {activeTool ? (
          <ToolTestPane tool={activeTool} provider={settings.provider} testStream={testStream} />
        ) : (
          <p className="pane-empty">请先在左侧选择一个工具。</p>
        )}
      </div>
    </div>
  )
}
