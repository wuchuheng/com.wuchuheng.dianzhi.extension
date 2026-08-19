/**
 * Whole-word expansion for text selections in the content script.
 *
 * Selections are expanded to full word boundaries by default so the popover
 * asks about a complete word instead of a fragment (e.g. `w[orl]d` becomes
 * `world`). Holding Ctrl while selecting keeps the exact range untouched.
 *
 * Word characters are letters, numbers, apostrophes and hyphens, so words
 * like `don't` and `state-of-the-art` stay intact. Expansion stays within a
 * single text node — a word split across inline elements degrades to the
 * nearest word edge inside that node.
 */

const WORD_CHAR = /[\p{L}\p{N}'-]/u
const WHITESPACE = /\s/

interface TextPoint {
  node: Text
  offset: number
}

/** Resolves a (container, offset) range boundary to an exact text position. */
function resolveTextPoint(node: Node, offset: number, document: Document): TextPoint | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node as Text
    return { node: text, offset: Math.max(0, Math.min(offset, text.length)) }
  }
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT)
  let remaining = offset
  let last: Text | null = null
  while (walker.nextNode()) {
    const text = walker.currentNode as Text
    last = text
    if (remaining <= text.length) {
      return { node: text, offset: Math.max(0, Math.min(remaining, text.length)) }
    }
    remaining -= text.length
  }
  return last ? { node: last, offset: last.length } : null
}

function wordStartOffset(text: Text, offset: number): number {
  const data = text.data
  let index = offset
  // The boundary sits on the selection's leading whitespace: skip it instead
  // of walking across into the previous word. Only its own word remains
  // expandable and the whitespace is trimmed from the final range.
  while (index < data.length && WHITESPACE.test(data.charAt(index))) index += 1
  while (index > 0 && WORD_CHAR.test(data.charAt(index - 1))) index -= 1
  return index
}

function wordEndOffset(text: Text, offset: number): number {
  const data = text.data
  let index = offset
  // The boundary sits after the selection's trailing whitespace: skip back
  // over it instead of walking forward into the next word. Only its own
  // word remains expandable and the whitespace is trimmed from the range.
  while (index > 0 && WHITESPACE.test(data.charAt(index - 1))) index -= 1
  while (index < data.length && WORD_CHAR.test(data.charAt(index))) index += 1
  return index
}

/**
 * Expands a selection range so both boundaries sit on whole-word edges and
 * any whitespace at the selection edges is trimmed off. Movement is allowed
 * in both directions: the start may move forward (leading whitespace) and the
 * end may move back (trailing whitespace). Returns the input range unchanged
 * when no expansion or trim is possible.
 */
export function expandRangeToWords(range: Range): Range {
  const document = range.startContainer.ownerDocument
  const expanded = range.cloneRange()
  if (!document) return expanded
  const start = resolveTextPoint(range.startContainer, range.startOffset, document)
  const end = resolveTextPoint(range.endContainer, range.endOffset, document)
  if (!start || !end) return expanded
  const from = wordStartOffset(start.node, start.offset)
  const to = wordEndOffset(end.node, end.offset)
  if (start.node === end.node) {
    if (from >= to) return expanded
    expanded.setStart(start.node, from)
    expanded.setEnd(end.node, to)
    return expanded
  }
  if (from !== start.offset) expanded.setStart(start.node, from)
  if (to !== end.offset) expanded.setEnd(end.node, to)
  return expanded
}
