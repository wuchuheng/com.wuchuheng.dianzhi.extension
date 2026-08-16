// @vitest-environment node

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ToolTabs } from '../../../src/dianzhi/ui/ToolTabs'
import { nextToolId } from '../../../src/dianzhi/ui/tool-tabs-state'

const tools = [
  {
    tool: {
      id: 'context',
      name: '语境',
      builtin: true,
      enabled: true,
      promptMode: 'preset' as const,
      customPrompt: '',
    },
    conversationId: 1,
  },
  {
    tool: {
      id: 'translate',
      name: '翻译',
      builtin: true,
      enabled: true,
      promptMode: 'preset' as const,
      customPrompt: '',
    },
    conversationId: null,
  },
]

describe('ToolTabs', () => {
  it('marks the current tool as the active accessible tab', () => {
    const html = renderToStaticMarkup(
      <ToolTabs tools={tools} activeToolId="translate" onSelect={() => undefined} />
    )

    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toMatch(/aria-selected="true"[^>]*>翻译/)
  })

  it('cycles left and right with wraparound', () => {
    expect(nextToolId(tools, 'context', 1)).toBe('translate')
    expect(nextToolId(tools, 'context', -1)).toBe('translate')
  })
})
