import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  effectivePrompt,
  mergeSettings,
  validateSettings,
} from '@/dianzhi/domain/settings'
import { BUILTIN_PROMPTS } from '@/dianzhi/domain/presets'
import type { DianzhiSettings, ToolDefinition } from '@/dianzhi/domain/types'

const validSettings = (): DianzhiSettings =>
  mergeSettings({
    provider: {
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'secret',
      model: 'example-model',
    },
  })

describe('Dianzhi settings defaults and merge', () => {
  it('defines the three enabled built-in tools and page shortcuts', () => {
    expect(
      DEFAULT_SETTINGS.tools.map(({ id, enabled, builtin }) => ({ id, enabled, builtin }))
    ).toEqual([
      { id: 'context', enabled: true, builtin: true },
      { id: 'synonyms', enabled: true, builtin: true },
      { id: 'translate', enabled: true, builtin: true },
    ])
    expect(DEFAULT_SETTINGS.shortcuts).toMatchObject({
      tabLeft: 'Control+ArrowLeft',
      tabRight: 'Control+ArrowRight',
      toggleChat: 'Control+Enter',
      dock: 'Control+bracketleft',
    })
  })

  it('deep-merges objects without mutating defaults and replaces arrays wholesale', () => {
    const customTool: ToolDefinition = {
      id: 'grammar',
      name: '语法',
      builtin: false,
      enabled: true,
      promptMode: 'custom',
      customPrompt: 'Explain {{selected}} in {{context}}',
    }
    const merged = mergeSettings({
      provider: { model: 'qwen-plus' },
      tools: [customTool],
    })

    expect(merged.provider.baseUrl).toBe(DEFAULT_SETTINGS.provider.baseUrl)
    expect(merged.provider.model).toBe('qwen-plus')
    expect(merged.tools).toEqual([customTool])
    expect(DEFAULT_SETTINGS.provider.model).toBe('deepseek-chat')
    expect(DEFAULT_SETTINGS.tools).toHaveLength(3)
  })

  it('falls back to the first enabled tool when the stored default is unavailable', () => {
    const merged = mergeSettings({
      ui: { defaultToolId: 'missing' },
      tools: DEFAULT_SETTINGS.tools.map((tool) => ({
        ...tool,
        enabled: tool.id === 'synonyms',
      })),
    })

    expect(merged.ui.defaultToolId).toBe('synonyms')
  })

  it('ignores structurally invalid persisted values instead of throwing', () => {
    const merged = mergeSettings({
      provider: null,
      ui: 'invalid',
      shortcuts: [],
      tools: [null],
    })

    expect(merged).toEqual(DEFAULT_SETTINGS)
  })
})

describe('validateSettings', () => {
  it('accepts a valid complete configuration', () => {
    expect(validateSettings(validSettings())).toEqual({ ok: true, errors: [], warnings: [] })
  })

  it('warns instead of failing when the API key is empty', () => {
    const settings = validSettings()
    settings.provider.apiKey = ''

    const result = validateSettings(settings)
    expect(result.ok).toBe(true)
    expect(result.warnings).toContainEqual(expect.objectContaining({ path: 'provider.apiKey' }))
  })

  it.each([
    ['provider.baseUrl', (settings: DianzhiSettings) => (settings.provider.baseUrl = 'ftp://bad')],
    ['provider.model', (settings: DianzhiSettings) => (settings.provider.model = '   ')],
    ['provider.temperature', (settings: DianzhiSettings) => (settings.provider.temperature = 2.1)],
    ['provider.extraBody', (settings: DianzhiSettings) => (settings.provider.extraBody = '{bad')],
    [
      'provider.thinkingParam',
      (settings: DianzhiSettings) => {
        settings.provider.thinkingParam = 'bad' as DianzhiSettings['provider']['thinkingParam']
      },
    ],
    ['shortcuts.tabLeft', (settings: DianzhiSettings) => (settings.shortcuts.tabLeft = 'Control+')],
  ])('rejects invalid %s', (path, mutate) => {
    const settings = validSettings()
    mutate(settings)

    const result = validateSettings(settings)
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual(expect.objectContaining({ path }))
  })

  it('rejects duplicate tool IDs, missing built-ins, empty names, and empty custom prompts', () => {
    const settings = validSettings()
    settings.tools = [
      { ...DEFAULT_SETTINGS.tools[0], name: '' },
      { ...DEFAULT_SETTINGS.tools[0] },
      { ...DEFAULT_SETTINGS.tools[1] },
      {
        id: 'custom',
        name: 'Custom',
        builtin: false,
        enabled: true,
        promptMode: 'custom',
        customPrompt: ' ',
      },
    ]

    const paths = validateSettings(settings).errors.map((error) => error.path)
    expect(paths).toContain('tools.context.name')
    expect(paths).toContain('tools.context.id')
    expect(paths).toContain('tools.translate')
    expect(paths).toContain('tools.custom.customPrompt')
  })

  it('requires at least one enabled tool', () => {
    const settings = validSettings()
    settings.tools = settings.tools.map((tool) => ({ ...tool, enabled: false }))

    expect(validateSettings(settings).errors).toContainEqual(
      expect.objectContaining({ path: 'tools' })
    )
  })
})

describe('effectivePrompt', () => {
  it('uses the immutable preset unless a non-empty custom prompt is selected', () => {
    const context = DEFAULT_SETTINGS.tools[0]
    expect(effectivePrompt(context)).toBe(BUILTIN_PROMPTS.context)
    expect(effectivePrompt({ ...context, customPrompt: 'ignored' })).toBe(BUILTIN_PROMPTS.context)
    expect(
      effectivePrompt({ ...context, promptMode: 'custom', customPrompt: 'My {{selected}} prompt' })
    ).toBe('My {{selected}} prompt')
  })

  it('uses a custom tool prompt', () => {
    expect(
      effectivePrompt({
        id: 'grammar',
        name: 'Grammar',
        builtin: false,
        enabled: true,
        promptMode: 'custom',
        customPrompt: 'Inspect {{selected}} in {{context}}',
      })
    ).toBe('Inspect {{selected}} in {{context}}')
  })
})
