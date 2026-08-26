import { useEffect, useState } from 'react'
import { toToolDefinition } from '@/dianzhi/domain/settings'
import type { ProviderSettings } from '@/dianzhi/domain/types'
import type { ToolUpdatePatch } from '@/dianzhi/domain/protocol'
import type { ToolRecord } from '@/offscreen/database/config-store'
import { ToolConfig } from './ToolConfig'
import { ToolList } from './ToolList'
import { ToolTestPane } from './ToolTestPane'
import { repairActiveTool } from './tool-workspace-state'
import { useToolTest, type UseToolTestResult } from './use-tool-test'
import { useToolsApi, type ToolsApi } from './use-tools-api'
import './tool-workspace.css'

export interface ToolsWorkspaceProps {
  provider: ProviderSettings
  /** Injected for deterministic tests; production uses useToolsApi(). */
  toolsApi?: ToolsApi
  /** Injected only for deterministic tests; production uses the port hook. */
  testStream?: UseToolTestResult
}

export type DetailTab = 'config' | 'test'

const CUSTOM_TOOL_DEFAULT_PROMPT = '请根据 {{context}} 解释 {{selected}}。'

/**
 * The tools workspace: a draggable tool list driving a configuration pane and
 * a live-test playground, backed by the SQLite tools API. Every mutation
 * round-trips through the background and re-renders from the refreshed list.
 */
export function ToolsWorkspace(props: ToolsWorkspaceProps) {
  // Hooks run unconditionally; injected test doubles simply shadow the
  // defaults. useToolTest reads chrome.runtime at render, so specs pass a
  // minimal chrome stub.
  const fallbackToolsApi = useToolsApi()
  const fallbackTestStream = useToolTest()
  const { toolsApi, testStream } = props
  return (
    <ToolsWorkspaceView
      {...props}
      toolsApi={toolsApi ?? fallbackToolsApi}
      testStream={testStream ?? fallbackTestStream}
    />
  )
}

function ToolsWorkspaceView(
  props: ToolsWorkspaceProps & Required<Pick<ToolsWorkspaceProps, 'toolsApi' | 'testStream'>>
) {
  const { provider, toolsApi, testStream } = props
  const [records, setRecords] = useState<ToolRecord[] | null>(null)
  const [pickedToolId, setPickedToolId] = useState<number | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('config')
  const [error, setError] = useState<string | null>(null)

  const apply = (next: ToolRecord[]) => {
    setRecords(next)
    // Keep the current selection when the refreshed list still contains it;
    // only fall back to the default tool when it was removed.
    setPickedToolId((picked) =>
      picked !== null && next.some((tool) => tool.id === picked) ? picked : null
    )
    setError(null)
  }

  useEffect(() => {
    let disposed = false
    toolsApi
      .list(true)
      .then((list) => {
        if (!disposed) apply(list)
      })
      .catch(() => {
        if (!disposed) setError('工具列表加载失败')
      })
    return () => {
      disposed = true
    }
  }, [toolsApi])

  if (records === null) {
    return (
      <div className="tool-workspace">
        <p className="pane-empty">正在加载工具…</p>
        {error !== null && (
          <p className="tool-field-hint" role="status">
            {error}
          </p>
        )}
      </div>
    )
  }

  const active = records.filter((record) => record.deletedAt === null)
  const removed = records.filter((record) => record.deletedAt !== null)
  const tools = active.map(toToolDefinition)
  const defaultToolId = tools.find((tool) => tool.isDefault)?.id ?? tools[0]?.id ?? 1
  const activeToolId = repairActiveTool(tools, pickedToolId, defaultToolId)
  const activeRecord = active.find((record) => record.id === activeToolId) ?? null

  const updateTool = (id: number, patch: ToolUpdatePatch) => {
    void toolsApi
      .update(id, patch)
      .then(apply)
      .catch((reason: unknown) => setError(message(reason)))
  }

  const handleToggleEnabled = (id: number, enabled: boolean) => updateTool(id, { enabled })

  const handleReorder = (orderedIds: number[]) => {
    void toolsApi
      .reorder(orderedIds)
      .then(apply)
      .catch((reason: unknown) => setError(message(reason)))
  }

  const handleAdd = () => {
    void toolsApi
      .create('自定义工具', CUSTOM_TOOL_DEFAULT_PROMPT)
      .then((list) => {
        apply(list)
        const added = list.reduce((max, record) => Math.max(max, record.id), 0)
        setPickedToolId(added || null)
      })
      .catch((reason: unknown) => setError(message(reason)))
  }

  const handleRemove = (id: number) => {
    void toolsApi
      .softRemove(id)
      .then(apply)
      .catch((reason: unknown) => setError(message(reason)))
  }

  const handleRestore = (id: number) => {
    void toolsApi
      .restore(id)
      .then(apply)
      .catch((reason: unknown) => setError(message(reason)))
  }

  const handleDelete = (id: number) => {
    void toolsApi
      .delete(id)
      .then(apply)
      .catch((reason: unknown) => setError(message(reason)))
  }

  const handleSetDefault = (id: number) => updateTool(id, { isDefault: true })

  return (
    <div className="tool-workspace">
      <ToolList
        tools={active}
        removed={removed}
        selectedId={activeToolId}
        onSelect={setPickedToolId}
        onToggleEnabled={handleToggleEnabled}
        onSetDefault={handleSetDefault}
        onReorder={handleReorder}
        onAdd={handleAdd}
        onRestore={handleRestore}
        onDelete={handleDelete}
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
          key={activeRecord?.id ?? 'none'}
          tool={activeRecord}
          onPatch={(patch) => {
            if (activeRecord) updateTool(activeRecord.id, patch)
          }}
          onRemove={() => {
            if (activeRecord && !activeRecord.isPreset) handleRemove(activeRecord.id)
          }}
        />
      </div>
      <div className="tool-workspace-detail" hidden={detailTab !== 'test'}>
        {activeRecord ? (
          <ToolTestPane
            tool={toToolDefinition(activeRecord)}
            provider={provider}
            testStream={testStream}
          />
        ) : (
          <p className="pane-empty">请先在左侧选择一个工具。</p>
        )}
      </div>
      {error !== null && (
        <p className="tool-field-hint" role="status">
          {error}
        </p>
      )}
    </div>
  )
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : '操作失败'
}
