import { describe, expect, it } from 'vitest'
import { assembleSelectionContext } from '@/content/selection/context'

/**
 * Builds a Selection stub for a given text inside `document.body`:
 * range covers `text` inside the first text node containing it.
 */
function selectText(document: Document, text: string): Selection {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node: Node | null = walker.nextNode()
  while (node) {
    const content = node.textContent ?? ''
    const start = content.indexOf(text)
    if (start >= 0) {
      const range = document.createRange()
      range.setStart(node, start)
      range.setEnd(node, start + text.length)
      return {
        rangeCount: 1,
        isCollapsed: false,
        toString: () => text,
        getRangeAt: () => range,
      } as unknown as Selection
    }
    node = walker.nextNode()
  }
  throw new Error(`text "${text}" not found in fixture`)
}

describe('assembleSelectionContext', () => {
  it('wraps the whole context in a <context> tag for a single block', () => {
    document.body.innerHTML = '<p>hello <span>world</span>!</p>'
    const selection = selectText(document, 'world')
    const result = assembleSelectionContext(selection, {
      targetWords: 100,
      maxWords: 100,
      maxBlocks: 10,
    })
    expect(result).not.toBeNull()
    expect(result!.selectedText).toBe('world')
    expect(result!.contextText.startsWith('<context>')).toBe(true)
    expect(result!.contextText.endsWith('</context>')).toBe(true)
    expect(result!.contextText).toContain('<selected>world</selected>')
    // The selected fragment sits between the context delimiters.
    const inner = result!.contextText.slice('<context>'.length, -'</context>'.length)
    expect(inner).toContain('hello')
    expect(inner).toContain('world')
  })

  it('joins multiple blocks and keeps them inside the <context> wrapper', () => {
    document.body.innerHTML =
      '<p>first block</p><p>hello <span>world</span> tail</p><p>third block</p>'
    const selection = selectText(document, 'world')
    const result = assembleSelectionContext(selection, {
      targetWords: 1000,
      maxWords: 1000,
      maxBlocks: 10,
    })
    expect(result).not.toBeNull()
    expect(result!.contextText.startsWith('<context>')).toBe(true)
    expect(result!.contextText.endsWith('</context>')).toBe(true)
    expect(result!.contextText).toContain('<selected>world</selected>')
    expect(result!.contextText).toContain('first block')
    expect(result!.contextText).toContain('third block')
    expect(result!.blockCount).toBe(3)
  })

  it('returns null for collapsed or empty selections', () => {
    document.body.innerHTML = '<p>hello world</p>'
    const collapsed = {
      rangeCount: 1,
      isCollapsed: true,
      toString: () => '',
      getRangeAt: () => document.createRange(),
    } as unknown as Selection
    expect(
      assembleSelectionContext(collapsed, {
        targetWords: 100,
        maxWords: 100,
        maxBlocks: 10,
      })
    ).toBeNull()

    const empty = {
      rangeCount: 1,
      isCollapsed: false,
      toString: () => '   ',
      getRangeAt: () => document.createRange(),
    } as unknown as Selection
    expect(
      assembleSelectionContext(empty, {
        targetWords: 100,
        maxWords: 100,
        maxBlocks: 10,
      })
    ).toBeNull()
  })
})
