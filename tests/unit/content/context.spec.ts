// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { assembleSelectionContext } from '../../../src/content/selection/context'

function select(start: Node, startOffset: number, end: Node, endOffset: number): Selection {
  const range = document.createRange()
  range.setStart(start, startOffset)
  range.setEnd(end, endOffset)
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
  return selection
}

describe('selection context assembly', () => {
  it('resolves nested text offsets and never mutates page DOM', () => {
    document.body.innerHTML = `
      <p>Previous paragraph gives useful context.</p>
      <p id="target">Deep <em>learning</em> changes software.</p>
      <p>Next paragraph adds another clue.</p>`
    const target = document.querySelector('#target')!
    const before = document.body.innerHTML
    const start = target.firstChild!
    const end = target.querySelector('em')!.firstChild!

    const result = assembleSelectionContext(select(start, 2, end, 8), {
      targetWords: 30,
      maxWords: 50,
      maxBlocks: 3,
    })

    expect(result?.selectedText).toBe('ep learning')
    expect(result?.contextText).toContain('<selected>ep learning</selected>')
    expect(result?.contextText).toContain('Previous paragraph')
    expect(result?.contextText).toContain('Next paragraph')
    expect(document.body.innerHTML).toBe(before)
  })

  it('alternates neighboring blocks and enforces word and block caps', () => {
    document.body.innerHTML = Array.from(
      { length: 7 },
      (_, index) => `<p id="p${index}">block${index} one two three four five</p>`
    ).join('')
    const node = document.querySelector('#p3')!.firstChild!

    const result = assembleSelectionContext(select(node, 0, node, 6), {
      targetWords: 100,
      maxWords: 18,
      maxBlocks: 3,
    })!

    expect(result.blockCount).toBe(3)
    expect(result.contextText).toContain('block2')
    expect(result.contextText).toContain('block4')
    expect(result.contextText).not.toContain('block1')
    expect(
      result.contextText
        .replace(/<\/?selected>/g, '')
        .split(/\s+/)
        .filter(Boolean).length
    ).toBeLessThanOrEqual(18)
  })
})
