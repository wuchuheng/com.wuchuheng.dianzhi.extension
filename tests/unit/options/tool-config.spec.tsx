// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_SETTINGS, effectivePrompt } from '../../../src/dianzhi/domain/settings'
import type { ToolDefinition } from '../../../src/dianzhi/domain/types'
import { ToolConfig } from '../../../src/options/tools/ToolConfig'

const { tools } = DEFAULT_SETTINGS
const contextTool = tools.find((tool) => tool.id === 'context')!
const enabled = tools.filter((tool) => tool.enabled)

const CUSTOM_TOOL: ToolDefinition = {
  id: 'custom-1',
  name: '我的工具',
  builtin: false,
  enabled: true,
  promptMode: 'custom',
  customPrompt: '请解释 {{selected}}',
}

function render(
  tool: ToolDefinition | null = contextTool,
  overrides: Partial<Parameters<typeof ToolConfig>[0]> = {}
) {
  return renderToStaticMarkup(
    <ToolConfig
      tool={tool}
      defaultToolId="context"
      isDefaultTool={tool?.id === 'context'}
      defaultOptions={enabled}
      onUpdate={() => undefined}
      onSetDefault={() => undefined}
      onRemove={() => undefined}
      {...overrides}
    />
  )
}

// React SSR serializes textarea children with a leading newline and HTML-escapes
// text (`'` -> `&#x27;`, `<` -> `&lt;`), so the read-only field is verified by
// extracting its value and decoding entities back to the preset body.
function textareaValue(html: string): string {
  const match = html.match(/readOnly="">([\s\S]*?)<\/textarea>/)
  return (match?.[1] ?? '').replace(/^\n/, '')
}

// Decode the entities React SSR emits, unescaping `&amp;` first so literal
// entity text (e.g. `&lt;` typed in a prompt) round-trips correctly.
function unescapeHtml(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&#x3C;/g, '<')
    .replace(/&#x3E;/g, '>')
}

describe('ToolConfig', () => {
  it('renders the active preset tool with a read-only prompt', () => {
    const html = render(contextTool)
    expect(html).toContain('工具配置')
    expect(html).toContain('语境')
    expect(html).toContain('readOnly=""')
    expect(unescapeHtml(textareaValue(html))).toBe(effectivePrompt(contextTool))
    expect(html).toContain('默认工具')
    expect(html).toContain('同义词')
  })

  it('edits custom prompts and offers delete for non-builtin tools only', () => {
    const custom = render(CUSTOM_TOOL)
    expect(custom).not.toContain('readOnly=""')
    expect(custom).toContain('请解释 {{selected}}')
    expect(custom).toContain('删除工具')

    const builtin = render(contextTool)
    expect(builtin).not.toContain('删除工具')
  })

  it('shows a disabled hint and a default badge for the active default tool', () => {
    const disabled = render({ ...contextTool, enabled: false })
    expect(disabled).toContain('此工具已停用')
    expect(render(contextTool)).toContain('默认工具')
  })

  it('shows an empty prompt state when no tool is selected', () => {
    expect(render(null)).toContain('请选择一个工具')
  })
})
