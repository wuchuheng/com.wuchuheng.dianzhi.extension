// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DEFAULT_SETTINGS } from '../../../src/dianzhi/domain/settings'
import type { ToolDefinition } from '../../../src/dianzhi/domain/types'
import { ToolList } from '../../../src/options/tools/ToolList'

const { tools } = DEFAULT_SETTINGS

function render(selectedId: string | null = 'context') {
  return renderToStaticMarkup(
    <ToolList
      tools={tools}
      selectedId={selectedId}
      onSelect={() => undefined}
      onToggleEnabled={() => undefined}
      onMove={() => undefined}
      onReorder={() => undefined}
      onAdd={() => undefined}
    />
  )
}

describe('ToolList', () => {
  it('renders every tool with preset/custom badges and the selected aria-current', () => {
    const html = render('context')
    expect(html).toContain('共 3 个工具')
    expect(html).toContain('语境')
    expect(html).toContain('同义词')
    expect(html).toContain('翻译')
    expect(html).toContain('内置')
    expect(html).toContain('aria-current="true"')
    expect(html).toContain('draggable="true"')
  })

  it('marks custom tools with the custom badge', () => {
    const custom = tools.map((tool, index) =>
      index === 1 ? ({ ...tool, id: 'custom-1', promptMode: 'custom' } as ToolDefinition) : tool
    )
    const html = renderToStaticMarkup(
      <ToolList
        tools={custom}
        selectedId="custom-1"
        onSelect={() => undefined}
        onToggleEnabled={() => undefined}
        onMove={() => undefined}
        onReorder={() => undefined}
        onAdd={() => undefined}
      />
    )
    expect(html).toContain('自定义')
    expect(html).toContain('aria-current="true"')
  })

  it('offers an add-custom-tool action', () => {
    expect(render()).toContain('添加自定义工具')
  })

  it('shows an empty state when there are no tools', () => {
    const html = renderToStaticMarkup(
      <ToolList
        tools={[]}
        selectedId={null}
        onSelect={() => undefined}
        onToggleEnabled={() => undefined}
        onMove={() => undefined}
        onReorder={() => undefined}
        onAdd={() => undefined}
      />
    )
    expect(html).toContain('还没有工具')
  })
})
