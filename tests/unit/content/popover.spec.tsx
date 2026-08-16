// @vitest-environment node

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ConversationViewState } from '../../../src/dianzhi/conversation/reducer'
import { ContentApp } from '../../../src/content/views/App'

const state: ConversationViewState = {
  visible: true,
  panelOpen: false,
  mode: 'card',
  expanded: false,
  snapshot: null,
  error: null,
}

describe('content popover view', () => {
  it('renders loading card controls and expanded state without an injected sidebar', () => {
    const html = renderToStaticMarkup(
      <ContentApp
        state={{ ...state, expanded: true }}
        placement={{ direction: 'below', x: 20, y: 30, arrowX: 100, width: 680 }}
        reasoningEnabled={false}
        onToolSelect={vi.fn()}
        onModeChange={vi.fn()}
        onExpand={vi.fn()}
        onClose={vi.fn()}
        onDock={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onRetry={vi.fn()}
        onOpenSettings={vi.fn()}
      />
    )

    expect(html).toContain('data-dianzhi-popover="true"')
    expect(html).toContain('正在理解所选内容')
    expect(html).toContain('aria-label="收起宽屏"')
    expect(html).not.toContain('sidebar')
  })
})
