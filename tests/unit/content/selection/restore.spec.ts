import { describe, expect, it } from 'vitest'
import {
  createSelectionBookmark,
  restoreSelectionRange,
  type SelectionBookmark,
} from '@/content/selection/restore'

function rangeFor(document: Document, text: string): Range {
  const node = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT).nextNode()
  if (!node) throw new Error('missing text node')
  const content = node.textContent ?? ''
  const start = content.indexOf(text)
  const range = document.createRange()
  range.setStart(node, start)
  range.setEnd(node, start + text.length)
  return range
}

describe('selection restore', () => {
  it('reconstructs an exact range from a bookmark', () => {
    document.body.innerHTML = 'before target after'
    const original = rangeFor(document, 'target')
    const bookmark = createSelectionBookmark(document, original)
    const restored = restoreSelectionRange(document, bookmark)
    expect(restored?.toString()).toBe('target')
  })

  it('rejects an ambiguous context match', () => {
    document.body.innerHTML = '<p>target</p><p>target</p>'
    const bookmark: SelectionBookmark = {
      startPath: [0, 0],
      startOffset: 0,
      endPath: [0, 0],
      endOffset: 6,
      selectedText: 'target',
      prefix: '',
      suffix: '',
    }
    expect(restoreSelectionRange(document, bookmark)).toBeNull()
  })

  it('finds a unique match after the original DOM path changes', () => {
    document.body.innerHTML = '<p>before target after</p>'
    const original = rangeFor(document, 'target')
    const bookmark = createSelectionBookmark(document, original)
    document.body.innerHTML = '<section><p>before target after</p></section>'
    expect(restoreSelectionRange(document, bookmark)?.toString()).toBe('target')
  })
})
