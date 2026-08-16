export interface AnchorRect {
  left: number
  right: number
  top: number
  bottom: number
}

export interface PanelSize {
  width: number
  height: number
}

export interface ViewportSize {
  width: number
  height: number
}

export interface Placement {
  direction: 'below' | 'above'
  x: number
  y: number
  arrowX: number
  width: number
}

const VIEWPORT_MARGIN = 8
const ARROW_GAP = 6
const ARROW_CORNER_MARGIN = 24

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
}

export function computePlacement(
  inputRect: AnchorRect,
  panel: PanelSize,
  viewport: ViewportSize
): Placement {
  const degenerate =
    inputRect.left === 0 && inputRect.right === 0 && inputRect.top === 0 && inputRect.bottom === 0
  const rect = degenerate
    ? {
        left: viewport.width / 2,
        right: viewport.width / 2,
        top: viewport.height / 2,
        bottom: viewport.height / 2,
      }
    : inputRect
  const width = Math.max(0, Math.min(panel.width, viewport.width - VIEWPORT_MARGIN * 2))
  const anchorX = (rect.left + rect.right) / 2
  const x = clamp(anchorX - width / 2, VIEWPORT_MARGIN, viewport.width - width - VIEWPORT_MARGIN)
  const belowSpace = viewport.height - VIEWPORT_MARGIN - rect.bottom - ARROW_GAP
  const aboveSpace = rect.top - VIEWPORT_MARGIN - ARROW_GAP
  const direction: Placement['direction'] =
    panel.height <= belowSpace || belowSpace >= aboveSpace ? 'below' : 'above'
  const preferredY =
    direction === 'below' ? rect.bottom + ARROW_GAP : rect.top - ARROW_GAP - panel.height
  const y = clamp(preferredY, VIEWPORT_MARGIN, viewport.height - panel.height - VIEWPORT_MARGIN)
  const cornerMargin = Math.min(ARROW_CORNER_MARGIN, width / 2)
  const arrowX = clamp(anchorX - x, cornerMargin, width - cornerMargin)
  return { direction, x, y, arrowX, width }
}
