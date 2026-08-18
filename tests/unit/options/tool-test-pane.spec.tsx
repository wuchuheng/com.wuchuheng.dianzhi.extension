// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_SETTINGS } from '../../../src/dianzhi/domain/settings'
import { INITIAL_TOOL_TEST_STATE } from '../../../src/options/tools/tool-test-state'
import { ToolTestPane } from '../../../src/options/tools/ToolTestPane'
import type { UseToolTestResult } from '../../../src/options/tools/use-tool-test'

const { tools } = DEFAULT_SETTINGS
const contextTool = tools.find((tool) => tool.id === 'context')!

function testStream(overrides: Partial<UseToolTestResult['state']> = {}): UseToolTestResult {
  return {
    state: { ...INITIAL_TOOL_TEST_STATE, ...overrides },
    run: () => undefined,
    stop: () => undefined,
    reset: () => undefined,
  }
}

function render(state: Partial<UseToolTestResult['state']> = {}) {
  return renderToStaticMarkup(
    <ToolTestPane
      tool={contextTool}
      provider={DEFAULT_SETTINGS.provider}
      testStream={testStream(state)}
    />
  )
}

describe('ToolTestPane', () => {
  it('renders the sample inputs, filled prompt preview, and run controls', () => {
    const html = render()
    expect(html).toContain('实时测试')
    expect(html).toContain('选择词')
    expect(html).toContain('上下文')
    expect(html).toContain('运行测试')
    expect(html).toContain('清空')
    // Empty sample inputs mean the single-pass substitution drops both tokens.
    expect(html).not.toContain('{{selected}}')
    expect(html).not.toContain('{{context}}')
    expect(html).toContain('生成提示词')
    expect(html).toContain('就绪')
  })

  it('shows the reasoning region and streamed answer while streaming', () => {
    const html = render({
      status: 'streaming',
      reasoningContent: 'planning…',
      content: 'partial answer',
    })
    expect(html).toContain('推理过程')
    expect(html).toContain('planning…')
    expect(html).toContain('partial answer')
    expect(html).toContain('正在生成…')
  })

  it('offers a stop control while running and reports metrics on completion', () => {
    const running = render({ status: 'validating' })
    expect(running).toContain('停止')

    const done = render({
      status: 'completed',
      content: 'final',
      reasoningContent: '',
      firstTokenMs: 120,
      totalMs: 800,
    })
    expect(done).toContain('已完成')
    expect(done).toContain('首 token 120ms · 总耗时 800ms')
  })

  it('surfaces the error message on failure', () => {
    const html = render({
      status: 'error',
      error: { code: 'PROVIDER_HTTP_ERROR', message: 'HTTP 401' },
    })
    expect(html).toContain('测试失败')
    expect(html).toContain('HTTP 401')
  })
})
