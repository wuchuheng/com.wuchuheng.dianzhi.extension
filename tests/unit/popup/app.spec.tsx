// @vitest-environment node

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PopupView } from '../../../src/popup/App'

describe('PopupView', () => {
  it('reports configuration state and offers settings without demo branding', () => {
    const html = renderToStaticMarkup(
      <PopupView configured={false} onOpenSettings={() => undefined} />
    )
    expect(html).toContain('尚未配置 AI 服务')
    expect(html).toContain('打开设置')
    expect(html).not.toContain('Vite')
  })
})
