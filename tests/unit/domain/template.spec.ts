import { describe, expect, it } from 'vitest'
import { fillTemplate } from '@/dianzhi/domain/template'

describe('fillTemplate', () => {
  it('substitutes every supported variable', () => {
    expect(
      fillTemplate('{{selected}} appears in {{context}} and {{selected}} again', {
        selected: 'learning',
        context: '<selected>learning</selected> matters',
      })
    ).toBe('learning appears in <selected>learning</selected> matters and learning again')
  })

  it('does not recursively substitute template-looking values', () => {
    expect(
      fillTemplate('{{selected}} / {{context}}', {
        selected: '{{context}}',
        context: '<selected>word</selected>',
      })
    ).toBe('{{context}} / <selected>word</selected>')
  })

  it('uses an empty string for a missing value and preserves unknown tokens', () => {
    expect(fillTemplate('{{selected}} {{unknown}} {{context}}', { selected: 'word' })).toBe(
      'word {{unknown}} '
    )
  })
})
