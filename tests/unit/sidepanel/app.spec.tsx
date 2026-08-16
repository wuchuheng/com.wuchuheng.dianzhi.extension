// @vitest-environment node

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { INITIAL_PANEL_STATE } from '../../../src/sidepanel/panel-state'
import { SidePanelView } from '../../../src/sidepanel/App'

describe('SidePanelView', () => {
  it('renders a conversation-only empty state without archive or new-chat actions', () => {
    const html = renderToStaticMarkup(
      <SidePanelView
        state={INITIAL_PANEL_STATE}
        reasoningEnabled={false}
        draft=""
        onDraftChange={() => undefined}
        onToolSelect={() => undefined}
        onSend={() => undefined}
        onStop={() => undefined}
        onRetry={() => undefined}
        onClose={() => undefined}
        onOpenSettings={() => undefined}
      />
    )

    expect(html).toContain('选择英文文本后')
    expect(html).not.toContain('新建对话')
    expect(html).not.toContain('历史记录')
  })
})
