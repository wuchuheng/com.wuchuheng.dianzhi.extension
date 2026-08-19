import { describe, expect, it } from 'vitest'
import { expandRangeToWords } from '@/content/selection/words'

/**
 * Expands a single-text-node selection and returns the resulting text.
 * `start`/`end` are character offsets into the created text node.
 */
function expandText(value: string, start: number, end: number): string {
  const container = document.createElement('div')
  container.textContent = value
  document.body.appendChild(container)
  const text = container.firstChild as Text
  const range = document.createRange()
  range.setStart(text, start)
  range.setEnd(text, end)
  const result = expandRangeToWords(range).toString()
  document.body.removeChild(container)
  return result
}

describe('expandRangeToWords', () => {
  const SENTENCE = "Rust won't let us annotate a type with"
  // annotate = [18..26), space = 26, "a" = 27

  it('expands a mid-word fragment to the whole word', () => {
    expect(expandText(SENTENCE, 23, 26)).toBe('annotate')
  })

  it('ignores a trailing space: partial word + space does not pull in the next word', () => {
    expect(expandText(SENTENCE, 23, 27)).toBe('annotate')
  })

  it('ignores a leading space: space + word does not pull in the previous word', () => {
    expect(expandText(SENTENCE, 17, 26)).toBe('annotate')
  })

  it('ignores whitespace on both edges', () => {
    expect(expandText(SENTENCE, 17, 27)).toBe('annotate')
  })

  it('trims whitespace when the whole word is selected with surrounding spaces', () => {
    // " annotate " -> "annotate" (both edges shrink)
    expect(expandText(SENTENCE, 17, 27)).toBe('annotate')
  })

  it('keeps both words when the selection spans two words without edge whitespace', () => {
    // "annotate a" -> unchanged selection, both words intact
    expect(expandText(SENTENCE, 18, 28)).toBe('annotate a')
  })

  it('keeps apostrophes and hyphens as part of a word', () => {
    expect(expandText("don't", 1, 3)).toBe("don't") // "on'" mid-word
    expect(expandText('state-of-the-art', 7, 12)).toBe('state-of-the-art') // "f-the"
  })

  it('leaves a pure-whitespace selection unchanged', () => {
    expect(expandText(SENTENCE, 26, 27)).toBe(' ')
  })

  it('degrades to the nearest word edge inside the node when a word is split across inline elements', () => {
    const container = document.createElement('div')
    container.innerHTML = 'annot<em>ate</em> a type'
    document.body.appendChild(container)
    const em = container.querySelector('em') as Element
    const ate = em.firstChild as Text
    const rest = em.nextSibling as Text // " a type"
    const range = document.createRange()
    range.setStart(ate, 0)
    range.setEnd(rest, 1) // includes the space after "ate"
    expect(expandRangeToWords(range).toString()).toBe('ate')
    document.body.removeChild(container)
  })
})
