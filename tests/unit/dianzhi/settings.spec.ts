import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  DEFAULT_TOOLS,
  effectivePrompt,
  validateSettings,
} from '@/dianzhi/domain/settings'
import { BUILTIN_PROMPTS } from '@/dianzhi/domain/presets'

describe('composed settings with the english preset', () => {
  it('builds a 5-tool default list including the english preset', () => {
    expect(DEFAULT_TOOLS).toHaveLength(5)
    const english = DEFAULT_TOOLS.find((tool) => tool.id === 5)
    expect(english?.name).toBe('英英释义')
    expect(english?.builtin).toBe(true)
    expect(english?.promptMode).toBe('preset')
    expect(DEFAULT_SETTINGS.tools).toHaveLength(5)
  })

  it('passes validation with the english preset present', () => {
    const result = validateSettings(DEFAULT_SETTINGS)
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('resolves the english preset prompt through effectivePrompt', () => {
    const tool = {
      id: 5,
      name: '英英释义',
      builtin: true,
      enabled: true,
      isDefault: false,
      promptMode: 'preset',
      customPrompt: '',
    }
    expect(effectivePrompt(tool)).toBe(BUILTIN_PROMPTS.english)
  })
})
