// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { isEnglishSelection } from '../../../src/content/selection/english'

describe('English selection gate', () => {
  it.each(['learning', "don't stop", 'Version 2.0 works!', 'café déjà vu'])(
    'accepts Latin text: %s',
    (text) => expect(isEnglishSelection(text)).toBe(true)
  )

  it.each(['', '   ', '...', '你好世界', 'hello 世界', 'a'])(
    'rejects empty, punctuation-only, non-English, mixed, or trivial text: %s',
    (text) => expect(isEnglishSelection(text)).toBe(false)
  )

  it('rejects selections longer than 300 characters', () => {
    expect(isEnglishSelection('a'.repeat(301))).toBe(false)
  })
})
