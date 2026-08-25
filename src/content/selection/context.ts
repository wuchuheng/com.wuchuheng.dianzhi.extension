export interface SelectionContextLimits {
  targetWords: number
  maxWords: number
  maxBlocks: number
}

export interface SelectionContext {
  selectedText: string
  contextText: string
  blockCount: number
}

/**
 * Block-level computed `display` values. An element is treated as a context
 * unit when it lays its text out as a block, regardless of its tag name — so
 * selections inside `figcaption`, `caption`, `summary`, `dt`/`dd`, or any
 * framework component resolve correctly without a hardcoded tag list.
 */
const BLOCK_DISPLAYS = new Set([
  'block',
  'flow-root',
  'list-item',
  'table',
  'table-row',
  'table-cell',
  'table-caption',
  'flex',
  'grid',
])

/** Returns true when `element` lays out its text as a block-level unit. */
function isBlockElement(element: Element): boolean {
  return BLOCK_DISPLAYS.has(getComputedStyle(element).display)
}

/**
 * Nearest block-level ancestor of `node`. Inline wrappers (`span`, `code`,
 * `a`, …) are skipped so a selection inside them resolves to the surrounding
 * paragraph/block rather than a bare inline fragment.
 */
function nearestBlock(node: Node): Element | null {
  const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
  if (!element) return null
  let current: Element | null = element
  while (current) {
    if (isBlockElement(current)) return current
    current = current.parentElement
  }
  return null
}

function meaningfulBlocks(document: Document): Element[] {
  return [...document.querySelectorAll('*')].filter((element) => {
    if (!isBlockElement(element)) return false
    if (!element.textContent?.trim()) return false
    const childBlocks = [...element.children].some(
      (child) => isBlockElement(child) && Boolean(child.textContent?.trim())
    )
    return !childBlocks
  })
}

/**
 * Removes literal HTML tag-like fragments (e.g. `<div>` or `</span>`) from
 * displayed text. `Range.toString()` only ever contains text nodes, so a
 * `<div>` the user sees came from the page itself (code samples, pasted
 * markup). Only patterns shaped like a tag are removed — plain `< b` or
 * `a < b` stays untouched.
 */
const LITERAL_HTML_TAG = /<\/?[a-zA-Z][a-zA-Z0-9]*[^>]*>/g

export function stripLiteralTags(value: string): string {
  return value.replace(LITERAL_HTML_TAG, '')
}

function textBefore(range: Range, block: Element): string {
  const before = range.cloneRange()
  before.selectNodeContents(block)
  before.setEnd(range.startContainer, range.startOffset)
  return before.toString()
}

function textAfter(range: Range, block: Element): string {
  const after = range.cloneRange()
  after.selectNodeContents(block)
  after.setStart(range.endContainer, range.endOffset)
  return after.toString()
}

function words(value: string): string[] {
  return value.trim().match(/\S+/g) ?? []
}

function trimAroundSelection(context: string, maxWords: number): string {
  const match = context.match(/^([\s\S]*?)<selected>([\s\S]*?)<\/selected>([\s\S]*)$/)
  if (!match) return context
  const before = words(match[1] ?? '')
  const selected = words(match[2] ?? '')
  const after = words(match[3] ?? '')
  const remaining = Math.max(0, maxWords - selected.length)
  let beforeLimit = Math.min(before.length, Math.floor(remaining / 2))
  let afterLimit = Math.min(after.length, remaining - beforeLimit)
  const unused = remaining - beforeLimit - afterLimit
  if (unused > 0) {
    const extraBefore = Math.min(unused, before.length - beforeLimit)
    beforeLimit += extraBefore
    afterLimit += Math.min(unused - extraBefore, after.length - afterLimit)
  }
  return [
    before.slice(-beforeLimit).join(' '),
    `<selected>${selected.join(' ')}</selected>`,
    after.slice(0, afterLimit).join(' '),
  ]
    .filter(Boolean)
    .join(' ')
}

export function assembleSelectionContext(
  selection: Selection,
  limits: SelectionContextLimits
): SelectionContext | null {
  if (selection.rangeCount !== 1 || selection.isCollapsed) return null
  const range = selection.getRangeAt(0)
  const selectedText = stripLiteralTags(selection.toString()).trim()
  if (!selectedText) return null
  const startBlock = nearestBlock(range.startContainer)
  const endBlock = nearestBlock(range.endContainer)
  if (!startBlock || !endBlock) return null
  const document = startBlock.ownerDocument
  const blocks = meaningfulBlocks(document)
  const startIndex = blocks.indexOf(startBlock)
  const endIndex = blocks.indexOf(endBlock)
  if (startIndex < 0 || endIndex < startIndex) return null

  const central = `${stripLiteralTags(textBefore(range, startBlock))}<selected>${selectedText}</selected>${stripLiteralTags(
    textAfter(range, endBlock)
  )}`
  const parts = new Map<number, string>([[startIndex, central]])
  let blockCount = endIndex - startIndex + 1
  let previous = startIndex - 1
  let next = endIndex + 1
  let choosePrevious = true

  while (
    blockCount < Math.max(1, limits.maxBlocks) &&
    words([...parts.values()].join(' ')).length < limits.targetWords &&
    (previous >= 0 || next < blocks.length)
  ) {
    if ((choosePrevious && previous >= 0) || next >= blocks.length) {
      parts.set(previous, stripLiteralTags(blocks[previous]?.textContent ?? '').trim())
      previous -= 1
    } else if (next < blocks.length) {
      parts.set(next, stripLiteralTags(blocks[next]?.textContent ?? '').trim())
      next += 1
    }
    blockCount += 1
    choosePrevious = !choosePrevious
  }

  const context = [...parts.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, value]) => value)
    .join('\n\n')
  return {
    selectedText,
    // Wrap the assembled context in a <context> tag so models can tell the
    // selection boundary from its surroundings at a glance. The delimiters
    // are applied after word trimming, so neither tag counts as content.
    contextText: `<context>${trimAroundSelection(context, Math.max(1, limits.maxWords))}</context>`,
    blockCount,
  }
}
