import { useState } from 'react'
import { effectivePrompt } from '@/dianzhi/domain/settings'
import { fillTemplate } from '@/dianzhi/domain/template'
import type { ProviderSettings, ToolDefinition } from '@/dianzhi/domain/types'
import type { UseToolTestResult } from './use-tool-test'
import type { ToolTestStatus } from './tool-test-state'

export interface ToolTestPaneProps {
  tool: ToolDefinition
  provider: ProviderSettings
  testStream: UseToolTestResult
}

const STATUS_LABEL: Readonly<Record<ToolTestStatus, string>> = {
  idle: '就绪',
  validating: '正在校验服务…',
  streaming: '正在生成…',
  completed: '已完成',
  stopped: '已停止',
  error: '测试失败',
}

/**
 * The live-test playground: sample selection/context inputs, a filled-prompt
 * preview, and a streaming reasoning + answer region backed by the non-persistent
 * tool-test port.
 */
export function ToolTestPane(props: ToolTestPaneProps) {
  const { tool, provider, testStream } = props
  const [selectedText, setSelectedText] = useState('')
  const [contextText, setContextText] = useState('')
  const preview = fillTemplate(effectivePrompt(tool), {
    selected: selectedText.trim() || null,
    context: contextText.trim() || null,
  })
  const running =
    testStream.state.status === 'validating' || testStream.state.status === 'streaming'

  return (
    <div className="tool-test-pane">
      <h2 className="pane-title">实时测试</h2>
      <label>
        选择词
        <input
          aria-label="选择词"
          value={selectedText}
          onChange={(event) => setSelectedText(event.target.value)}
          placeholder="例如：serendipity"
        />
      </label>
      <label>
        上下文
        <textarea
          aria-label="上下文"
          value={contextText}
          onChange={(event) => setContextText(event.target.value)}
          placeholder="粘贴包含选择词的句子…"
        />
      </label>
      <p className="prompt-preview-label">生成提示词</p>
      <pre className="prompt-preview" aria-live="polite">
        {preview}
      </pre>
      <div className="tool-test-actions">
        <button
          type="button"
          className="primary"
          disabled={running || !preview.trim()}
          onClick={() => testStream.run({ prompt: preview, provider })}
        >
          运行测试
        </button>
        {running && (
          <button type="button" onClick={testStream.stop}>
            停止
          </button>
        )}
        <button
          type="button"
          className="secondary"
          disabled={testStream.state.status === 'idle'}
          onClick={testStream.reset}
        >
          清空
        </button>
      </div>
      <p className="tool-test-status" role="status">
        {STATUS_LABEL[testStream.state.status]}
        {testStream.state.status === 'error' && testStream.state.error
          ? `：${testStream.state.error.message}`
          : ''}
      </p>
      {testStream.state.reasoningContent && (
        <details className="reasoning-region" open>
          <summary>推理过程</summary>
          <pre>{testStream.state.reasoningContent}</pre>
        </details>
      )}
      <pre className="answer-region" aria-live="polite">
        {testStream.state.content}
      </pre>
      {testStream.state.firstTokenMs !== null && testStream.state.totalMs !== null && (
        <p className="tool-test-metrics">
          首 token {testStream.state.firstTokenMs}ms · 总耗时 {testStream.state.totalMs}ms
        </p>
      )}
    </div>
  )
}
