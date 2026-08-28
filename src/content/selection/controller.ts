import type { TriggerMode } from '@/dianzhi/domain/types'
import {
  assembleSelectionContext,
  type SelectionContext,
  type SelectionContextLimits,
} from './context'
import { isEnglishSelection } from './english'
import { expandRangeToWords } from './words'
import type { AnchorRect } from '../popover/placement'
import { createSelectionBookmark, restoreSelectionRange, type SelectionBookmark } from './restore'

export interface CapturedSelection {
  context: SelectionContext
  rect: AnchorRect
  bookmark: SelectionBookmark
}

export interface SelectionControllerOptions {
  document: Document
  extensionHost: Element
  triggerMode: TriggerMode
  limits: SelectionContextLimits
  onSelection(value: CapturedSelection): void
  onAnchorChange(rect: AnchorRect): void
}

function anchorRect(range: Range): AnchorRect {
  const rect = range.getBoundingClientRect()
  return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }
}

export function createSelectionController(options: SelectionControllerOptions) {
  let currentRange: Range | null = null
  let keepAlive = false

  // Keeps the highlighted word visible while the popover or its focus steals
  // the document selection (e.g. clicking the composer field). Only restores
  // when the selection is completely gone, never while the user selects
  // something else.
  const restoreRange = () => {
    if (!keepAlive || !currentRange) return
    const selection = options.document.getSelection()
    if (!selection || selection.rangeCount !== 0) return
    selection.removeAllRanges()
    selection.addRange(currentRange)
  }

  const capture = (event: MouseEvent) => {
    if (options.triggerMode === 'alt-mouseup' && !event.altKey) return
    if (event.composedPath().includes(options.extensionHost)) return
    const selection = options.document.getSelection()
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return
    let range = selection.getRangeAt(0)
    if (
      options.extensionHost.contains(range.commonAncestorContainer) ||
      options.extensionHost.contains(range.startContainer) ||
      options.extensionHost.contains(range.endContainer)
    ) {
      return
    }
    if (!isEnglishSelection(selection.toString())) return
    // Whole-word expansion by default; holding Ctrl keeps the exact range.
    // The live selection is replaced so the page highlight covers the word.
    if (!event.ctrlKey) {
      const expanded = expandRangeToWords(range)
      selection.removeAllRanges()
      selection.addRange(expanded)
      range = expanded
    }
    const context = assembleSelectionContext(selection, options.limits)
    if (!context) return
    currentRange = range
    options.onSelection({
      context,
      rect: anchorRect(range),
      bookmark: createSelectionBookmark(options.document, range),
    })
  }

  const reposition = () => {
    if (currentRange) options.onAnchorChange(anchorRect(currentRange))
  }

  return {
    start() {
      options.document.addEventListener('mouseup', capture)
      options.document.addEventListener('selectionchange', restoreRange)
      options.document.defaultView?.addEventListener('scroll', reposition, true)
      options.document.defaultView?.addEventListener('resize', reposition)
    },
    stop() {
      options.document.removeEventListener('mouseup', capture)
      options.document.removeEventListener('selectionchange', restoreRange)
      options.document.defaultView?.removeEventListener('scroll', reposition, true)
      options.document.defaultView?.removeEventListener('resize', reposition)
      currentRange = null
      keepAlive = false
    },
    // While the popover is open, keep re-applying the captured word to the
    // page selection so the highlight survives focus moves inside the popover.
    keepAlive(value: boolean) {
      keepAlive = value
      if (value) restoreRange()
    },
    bookmark() {
      return currentRange ? createSelectionBookmark(options.document, currentRange) : null
    },
    restore(bookmark: SelectionBookmark) {
      const range = restoreSelectionRange(options.document, bookmark)
      if (!range) return null
      currentRange = range
      const selection = options.document.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      return anchorRect(range)
    },
  }
}
