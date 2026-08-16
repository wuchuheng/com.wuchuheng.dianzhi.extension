import type { TriggerMode } from '@/dianzhi/domain/types'
import {
  assembleSelectionContext,
  type SelectionContext,
  type SelectionContextLimits,
} from './context'
import { isEnglishSelection } from './english'
import type { AnchorRect } from '../popover/placement'

export interface CapturedSelection {
  context: SelectionContext
  rect: AnchorRect
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

  const capture = (event: MouseEvent) => {
    if (options.triggerMode === 'alt-mouseup' && !event.altKey) return
    if (event.composedPath().includes(options.extensionHost)) return
    const selection = options.document.getSelection()
    if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return
    const range = selection.getRangeAt(0)
    if (
      options.extensionHost.contains(range.commonAncestorContainer) ||
      options.extensionHost.contains(range.startContainer) ||
      options.extensionHost.contains(range.endContainer)
    ) {
      return
    }
    if (!isEnglishSelection(selection.toString())) return
    const context = assembleSelectionContext(selection, options.limits)
    if (!context) return
    currentRange = range
    options.onSelection({ context, rect: anchorRect(range) })
  }

  const reposition = () => {
    if (currentRange) options.onAnchorChange(anchorRect(currentRange))
  }

  return {
    start() {
      options.document.addEventListener('mouseup', capture)
      options.document.defaultView?.addEventListener('scroll', reposition, true)
      options.document.defaultView?.addEventListener('resize', reposition)
    },
    stop() {
      options.document.removeEventListener('mouseup', capture)
      options.document.defaultView?.removeEventListener('scroll', reposition, true)
      options.document.defaultView?.removeEventListener('resize', reposition)
      currentRange = null
    },
  }
}
