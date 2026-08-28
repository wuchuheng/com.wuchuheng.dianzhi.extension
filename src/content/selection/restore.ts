export type SelectionBookmark = {
  startPath: number[]
  startOffset: number
  endPath: number[]
  endOffset: number
  selectedText: string
  prefix: string
  suffix: string
}

function pathFor(document: Document, node: Node): number[] {
  const path: number[] = []
  let current: Node | null = node
  while (current && current !== document) {
    const parent: Node | null = current.parentNode
    if (!parent) return []
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, current))
    current = parent
  }
  return current === document ? path : []
}

function nodeAt(document: Document, path: number[]): Node | null {
  let current: Node = document
  for (const index of path) {
    const next = current.childNodes[index]
    if (!next) return null
    current = next
  }
  return current
}

function contextFor(range: Range): { prefix: string; suffix: string } {
  const block = range.commonAncestorContainer.parentElement
  const text = block?.textContent ?? ''
  const selected = range.toString()
  if (!block) return { prefix: '', suffix: '' }
  let index = text.indexOf(selected)
  try {
    const before = range.cloneRange()
    before.selectNodeContents(block)
    before.setEnd(range.startContainer, range.startOffset)
    index = before.toString().length
  } catch {
    if (index < 0) return { prefix: '', suffix: '' }
  }
  return {
    prefix: text.slice(Math.max(0, index - 32), index),
    suffix: text.slice(index + selected.length, index + selected.length + 32),
  }
}

export function createSelectionBookmark(document: Document, range: Range): SelectionBookmark {
  const { prefix, suffix } = contextFor(range)
  return {
    startPath: pathFor(document, range.startContainer),
    startOffset: range.startOffset,
    endPath: pathFor(document, range.endContainer),
    endOffset: range.endOffset,
    selectedText: range.toString(),
    prefix,
    suffix,
  }
}

export function isSelectionBookmark(value: unknown): value is SelectionBookmark {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  return (
    Array.isArray(item.startPath) &&
    item.startPath.every(Number.isInteger) &&
    Array.isArray(item.endPath) &&
    item.endPath.every(Number.isInteger) &&
    Number.isInteger(item.startOffset) &&
    Number.isInteger(item.endOffset) &&
    typeof item.selectedText === 'string' &&
    item.selectedText.length > 0 &&
    typeof item.prefix === 'string' &&
    typeof item.suffix === 'string'
  )
}

export function restoreSelectionRange(
  document: Document,
  bookmark: SelectionBookmark
): Range | null {
  const start = nodeAt(document, bookmark.startPath)
  const end = nodeAt(document, bookmark.endPath)
  const matches = (range: Range): boolean => {
    if (range.toString() !== bookmark.selectedText) return false
    const { prefix, suffix } = contextFor(range)
    return (
      (bookmark.prefix.endsWith(prefix) || prefix.endsWith(bookmark.prefix)) &&
      (bookmark.suffix.startsWith(suffix) || suffix.startsWith(bookmark.suffix))
    )
  }
  if (start && end) {
    try {
      const range = document.createRange()
      range.setStart(start, bookmark.startOffset)
      range.setEnd(end, bookmark.endOffset)
      if (matches(range)) return range
    } catch {
      // Fall through to the context-guarded text search.
    }
  }

  const candidates: Range[] = []
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  let node: Node | null = walker.nextNode()
  while (node) {
    const text = node.textContent ?? ''
    let offset = text.indexOf(bookmark.selectedText)
    while (offset >= 0) {
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + bookmark.selectedText.length)
      if (matches(range)) candidates.push(range)
      offset = text.indexOf(bookmark.selectedText, offset + 1)
    }
    node = walker.nextNode()
  }
  return candidates.length === 1 ? candidates[0] : null
}
