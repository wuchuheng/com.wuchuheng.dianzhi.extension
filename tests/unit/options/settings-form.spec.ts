// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/dianzhi/domain/settings'
import {
  addCustomTool,
  moveTool,
  reorderToolsByTarget,
  removeCustomTool,
  setToolEnabled,
} from '../../../src/options/settings-form'

describe('options settings helpers', () => {
  it('adds, reorders, and removes custom tools without mutating built-ins', () => {
    const added = addCustomTool(DEFAULT_SETTINGS)
    const custom = added.tools.find((tool) => !tool.builtin)
    expect(custom?.id).toMatch(/^custom-/)
    expect(DEFAULT_SETTINGS.tools).toHaveLength(3)

    const moved = moveTool(added, custom!.id, -1)
    expect(moved.tools.findIndex((tool) => tool.id === custom!.id)).toBe(2)
    expect(removeCustomTool(moved, 'context')).toBe(moved)
    expect(removeCustomTool(moved, custom!.id).tools).toHaveLength(3)
  })

  describe('reorderToolsByTarget', () => {
    const ids = (settings: typeof DEFAULT_SETTINGS & { tools: Array<{ id: string }> }) =>
      settings.tools.map((tool) => tool.id)

    it('moves the first tool after the third without mutating the input', () => {
      const result = reorderToolsByTarget(DEFAULT_SETTINGS, 'context', 'translate', false)
      expect(ids(result)).toEqual(['synonyms', 'translate', 'context'])
      expect(ids(DEFAULT_SETTINGS)).toEqual(['context', 'synonyms', 'translate'])
    })

    it('moves the third tool before the first', () => {
      const result = reorderToolsByTarget(DEFAULT_SETTINGS, 'translate', 'context', true)
      expect(ids(result)).toEqual(['translate', 'context', 'synonyms'])
    })

    it('returns the same reference for a no-op drop', () => {
      expect(reorderToolsByTarget(DEFAULT_SETTINGS, 'context', 'context', false)).toBe(
        DEFAULT_SETTINGS
      )
      // Dropping just before the next sibling is also a no-op.
      expect(reorderToolsByTarget(DEFAULT_SETTINGS, 'context', 'synonyms', true)).toBe(
        DEFAULT_SETTINGS
      )
    })

    it('returns the same reference for unknown tool ids', () => {
      expect(reorderToolsByTarget(DEFAULT_SETTINGS, 'nope', 'context', false)).toBe(
        DEFAULT_SETTINGS
      )
      expect(reorderToolsByTarget(DEFAULT_SETTINGS, 'context', 'nope', false)).toBe(
        DEFAULT_SETTINGS
      )
    })
  })

  describe('setToolEnabled', () => {
    it('patches only the target tool', () => {
      const result = setToolEnabled(DEFAULT_SETTINGS, 'synonyms', false)
      expect(result.tools.find((tool) => tool.id === 'synonyms')?.enabled).toBe(false)
      expect(result.tools.find((tool) => tool.id === 'context')?.enabled).toBe(true)
    })

    it('repairs the default tool when disabling it', () => {
      const result = setToolEnabled(DEFAULT_SETTINGS, 'context', false)
      expect(result.ui.defaultToolId).toBe('synonyms')
    })

    it('leaves the default untouched when disabling a non-default tool', () => {
      const result = setToolEnabled(DEFAULT_SETTINGS, 'translate', false)
      expect(result.ui.defaultToolId).toBe('context')
    })

    it('returns the same reference when the enabled state is unchanged', () => {
      expect(setToolEnabled(DEFAULT_SETTINGS, 'context', true)).toBe(DEFAULT_SETTINGS)
    })
  })
})
