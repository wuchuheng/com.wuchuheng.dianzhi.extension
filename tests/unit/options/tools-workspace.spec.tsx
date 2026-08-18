// @vitest-environment node

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/dianzhi/domain/settings'
import { INITIAL_TOOL_TEST_STATE } from '../../../src/options/tools/tool-test-state'
import { ToolsWorkspace } from '../../../src/options/tools/ToolsWorkspace'
import { repairActiveTool } from '../../../src/options/tools/tool-workspace-state'
import type { UseToolTestResult } from '../../../src/options/tools/use-tool-test'

const testStream: UseToolTestResult = {
  state: INITIAL_TOOL_TEST_STATE,
  run: () => undefined,
  stop: () => undefined,
  reset: () => undefined,
}

describe('repairActiveTool', () => {
  const { tools } = DEFAULT_SETTINGS

  it('keeps an existing active tool', () => {
    expect(repairActiveTool(tools, 'synonyms', 'context')).toBe('synonyms')
  })

  it('falls back to the default tool when the active tool disappears', () => {
    expect(repairActiveTool(tools, 'removed', 'translate')).toBe('translate')
  })

  it('falls back to the first tool when the default is gone too', () => {
    expect(repairActiveTool(tools, 'removed', 'gone')).toBe('context')
  })

  it('returns null when no tool exists', () => {
    expect(repairActiveTool([], 'x', 'y')).toBeNull()
  })
})

describe('ToolsWorkspace', () => {
  it('renders the list, configuration, and live-test panes with an injected stream', () => {
    const html = renderToStaticMarkup(
      <ToolsWorkspace
        settings={DEFAULT_SETTINGS}
        onSettingsChange={() => undefined}
        testStream={testStream}
      />
    )
    expect(html).toContain('共 3 个工具')
    expect(html).toContain('工具配置')
    expect(html).toContain('实时测试')
    expect(html).toContain('语境')
    expect(html).toContain('默认工具')
    expect(html).toContain('运行测试')
  })
})
