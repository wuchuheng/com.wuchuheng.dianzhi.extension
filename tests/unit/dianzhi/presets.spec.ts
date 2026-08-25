import { describe, expect, it } from 'vitest'
import {
  BUILTIN_PROMPTS,
  BUILTIN_TOOL_IDS,
  BUILTIN_TOOL_NAMES,
  CUSTOM_TOOL_ID_START,
  PRESET_ID_RESERVED_MAX,
  PRESET_TOOL_IDS,
} from '@/dianzhi/domain/presets'

describe('preset tool registry', () => {
  it('registers the english (英英释义) preset at id 5', () => {
    expect(BUILTIN_TOOL_IDS).toContain('english')
    expect(PRESET_TOOL_IDS.english).toBe(5)
    expect(BUILTIN_TOOL_NAMES.english).toBe('英英释义')
  })

  it('exposes the pure-English prompt with the context template and one Chinese line', () => {
    const prompt = BUILTIN_PROMPTS.english
    expect(prompt).toContain('# Language Policy')
    expect(prompt).toContain('{{context}}')
    expect(prompt).toContain('> Translation: 中文释义')
    expect(prompt).toContain('> Translation: 中文翻译')
  })

  it('keeps every preset id inside the reserved 1..1024 range', () => {
    for (const id of BUILTIN_TOOL_IDS) {
      expect(PRESET_TOOL_IDS[id]).toBeGreaterThanOrEqual(1)
      expect(PRESET_TOOL_IDS[id]).toBeLessThanOrEqual(PRESET_ID_RESERVED_MAX)
    }
    expect(CUSTOM_TOOL_ID_START).toBe(1025)
  })
})
