// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../../src/dianzhi/domain/settings'
import { addCustomTool, moveTool, removeCustomTool } from '../../../src/options/settings-form'

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
})
