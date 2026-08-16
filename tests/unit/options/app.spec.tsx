// @vitest-environment node

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/dianzhi/domain/settings'
import { OptionsView } from '../../../src/options/App'

describe('OptionsView', () => {
  it('renders the three Dianzhi settings sections and protects the API key', () => {
    const html = renderToStaticMarkup(
      <OptionsView
        section="provider"
        settings={{
          ...DEFAULT_SETTINGS,
          provider: { ...DEFAULT_SETTINGS.provider, apiKey: 'secret-key' },
        }}
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
    expect(html).toContain('AI 服务')
    expect(html).toContain('查询工具')
    expect(html).toContain('交互与快捷键')
    expect(html).toContain('type="password"')
    expect(html).not.toContain('WareFlow')
  })
})
