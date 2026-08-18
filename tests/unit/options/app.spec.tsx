// @vitest-environment node

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/dianzhi/domain/settings'
import { OptionsView } from '../../../src/options/App'

const renderSection = (section: 'provider' | 'tools' | 'interaction') =>
  renderToStaticMarkup(
    <OptionsView
      section={section}
      settings={DEFAULT_SETTINGS}
      status=""
      errors={[]}
      revealKey={false}
      onSectionChange={() => undefined}
      onSettingsChange={() => undefined}
      onRevealKey={() => undefined}
      onSave={() => undefined}
      onTest={() => undefined}
    />
  )

describe('OptionsView', () => {
  it('renders the three Dianzhi settings sections and protects the API key', () => {
    const html = renderSection('provider')
    expect(html).toContain('AI 服务')
    expect(html).toContain('查询工具')
    expect(html).toContain('交互与快捷键')
    expect(html).toContain('type="password"')
    expect(html).not.toContain('WareFlow')
  })

  it('renders the three-pane tools workspace in the tools section', () => {
    // The tools workspace lazily opens a Chrome port only when a test runs; a
    // minimal runtime stub makes the default connected hook safe to mount.
    ;(globalThis as { chrome?: unknown }).chrome = {
      runtime: { connect: () => undefined as never },
    }
    const html = renderSection('tools')
    expect(html).toContain('查询工具')
    expect(html).toContain('共 3 个工具')
    expect(html).toContain('工具配置')
    expect(html).toContain('实时测试')
    expect(html).toContain('运行测试')
    expect(html).toContain('语境')
  })
})
