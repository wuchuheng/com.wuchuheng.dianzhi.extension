import type { ConversationSnapshot, ParseResult } from './protocol'
import type { AnchorRect } from '@/content/popover/placement'
import type { SelectionBookmark } from '@/content/selection/restore'

export type UiSurface = 'contentScript' | 'sidePanel'

export type SurfaceStatusRequest = {
  requestId: string
  type: 'ui.surfaceStatus'
  payload: {
    status: 'appeared' | 'destroyed'
    selectionSessionId: number | null
  }
}

export type SurfaceStatusResponse = {
  currentUI: UiSurface | 'none'
  latestUI: UiSurface
  selectionSessionId: number | null
}

export type SelectionRouteRequest = {
  requestId: string
  type: 'selection.route'
  payload: {
    selectedText: string
    contextText: string
    bookmark?: SelectionBookmark
    anchorRect?: AnchorRect
  }
}

export type SelectionRouteResult =
  | { target: 'contentScript'; display: true; snapshot: ConversationSnapshot }
  | { target: 'sidePanel'; display: false; snapshot: null }

export type PanelToggleRequest = {
  requestId: string
  type: 'shortcut.panelToggle'
  payload: Record<string, never>
}

export type PanelToggleResult = {
  currentUI: UiSurface | 'none'
  latestUI: UiSurface
  action: 'destroy' | 'restore' | 'none'
  snapshot: ConversationSnapshot | null
  contentRestore?: ContentRestore
}

export type ContentRestore = {
  selectionSessionId: number
  bookmark: SelectionBookmark
  anchorRect: AnchorRect
}

export type SelectToolShortcutRequest = {
  requestId: string
  type: 'shortcut.selectTool'
  payload: { index: number }
}

export type CycleToolShortcutRequest = {
  requestId: string
  type: 'shortcut.cycleTool'
  payload: { direction: 'left' | 'right' }
}

export type ToolShortcutResult =
  | { handled: false; reason: 'NO_APPEARED_UI' | 'TOOL_UNAVAILABLE' }
  | { handled: true; target: UiSurface; snapshot: ConversationSnapshot | null }

export type ContentUiCommand = { type: 'destroy' }

export type SidePanelCommand =
  | { type: 'render'; snapshot: ConversationSnapshot }
  | { type: 'clear' }
  | { type: 'selectTool'; snapshot: ConversationSnapshot }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isRequestId(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function invalid(message: string): ParseResult<never> {
  return { ok: false, error: { code: 'INVALID_EVENT', message } }
}

function hasCallerBrowserIdentity(value: Record<string, unknown>): boolean {
  return Object.keys(value).some((key) => {
    const normalized = key.toLowerCase()
    return normalized === 'tabid' || normalized === 'windowid' || normalized.includes('url')
  })
}

function parseEnvelope(
  value: unknown,
  type: string
): ParseResult<{ requestId: string; payload: Record<string, unknown> }> {
  if (
    !isRecord(value) ||
    !isRequestId(value.requestId) ||
    value.type !== type ||
    !isRecord(value.payload) ||
    hasCallerBrowserIdentity(value) ||
    hasCallerBrowserIdentity(value.payload)
  ) {
    return invalid('UI session request is invalid.')
  }

  return { ok: true, value: { requestId: value.requestId, payload: value.payload } }
}

export function parseSurfaceStatus(value: unknown): ParseResult<SurfaceStatusRequest> {
  const parsed = parseEnvelope(value, 'ui.surfaceStatus')
  if (!parsed.ok) return parsed
  const { payload } = parsed.value
  if (
    (payload.status !== 'appeared' && payload.status !== 'destroyed') ||
    (payload.selectionSessionId !== null && !isPositiveInteger(payload.selectionSessionId))
  ) {
    return invalid('UI surface status payload is invalid.')
  }

  return {
    ok: true,
    value: {
      requestId: parsed.value.requestId,
      type: 'ui.surfaceStatus',
      payload: { status: payload.status, selectionSessionId: payload.selectionSessionId },
    },
  }
}

export function parseSelectionRoute(value: unknown): ParseResult<SelectionRouteRequest> {
  const parsed = parseEnvelope(value, 'selection.route')
  if (!parsed.ok) return parsed
  const { payload } = parsed.value
  if (
    typeof payload.selectedText !== 'string' ||
    !payload.selectedText.trim() ||
    typeof payload.contextText !== 'string' ||
    !payload.contextText.trim()
  ) {
    return invalid('Selection route payload is invalid.')
  }
  if (payload.bookmark !== undefined && !isSelectionBookmarkPayload(payload.bookmark)) {
    return invalid('Selection bookmark payload is invalid.')
  }
  if (payload.anchorRect !== undefined && !isAnchorRectPayload(payload.anchorRect)) {
    return invalid('Selection anchor payload is invalid.')
  }

  return {
    ok: true,
    value: {
      requestId: parsed.value.requestId,
      type: 'selection.route',
      payload: {
        selectedText: payload.selectedText,
        contextText: payload.contextText,
        ...(payload.bookmark !== undefined
          ? { bookmark: payload.bookmark as SelectionBookmark }
          : {}),
        ...(payload.anchorRect !== undefined
          ? { anchorRect: payload.anchorRect as AnchorRect }
          : {}),
      },
    },
  }
}

function isSelectionBookmarkPayload(value: unknown): value is SelectionBookmark {
  if (!isRecord(value)) return false
  const paths = [value.startPath, value.endPath]
  return (
    paths.every(
      (path) => Array.isArray(path) && path.every((item) => Number.isInteger(item) && item >= 0)
    ) &&
    typeof value.startOffset === 'number' &&
    Number.isInteger(value.startOffset) &&
    value.startOffset >= 0 &&
    typeof value.endOffset === 'number' &&
    Number.isInteger(value.endOffset) &&
    value.endOffset >= 0 &&
    typeof value.selectedText === 'string' &&
    value.selectedText.length > 0 &&
    typeof value.prefix === 'string' &&
    typeof value.suffix === 'string'
  )
}

function isAnchorRectPayload(value: unknown): value is AnchorRect {
  if (!isRecord(value)) return false
  return ['left', 'right', 'top', 'bottom'].every(
    (key) => typeof value[key] === 'number' && Number.isFinite(value[key])
  )
}

export function parsePanelToggle(value: unknown): ParseResult<PanelToggleRequest> {
  const parsed = parseEnvelope(value, 'shortcut.panelToggle')
  if (!parsed.ok) return parsed
  if (Object.keys(parsed.value.payload).length > 0) {
    return invalid('Panel toggle payload must be empty.')
  }

  return {
    ok: true,
    value: { requestId: parsed.value.requestId, type: 'shortcut.panelToggle', payload: {} },
  }
}

export function parseToolShortcut(
  value: unknown
): ParseResult<SelectToolShortcutRequest | CycleToolShortcutRequest> {
  if (
    !isRecord(value) ||
    (value.type !== 'shortcut.selectTool' && value.type !== 'shortcut.cycleTool')
  ) {
    return invalid('Tool shortcut request is invalid.')
  }

  const parsed = parseEnvelope(value, value.type)
  if (!parsed.ok) return parsed
  const { payload } = parsed.value
  if (value.type === 'shortcut.selectTool') {
    if (!isPositiveInteger(payload.index)) return invalid('Tool shortcut index is invalid.')
    return {
      ok: true,
      value: {
        requestId: parsed.value.requestId,
        type: 'shortcut.selectTool',
        payload: { index: payload.index },
      },
    }
  }

  if (payload.direction !== 'left' && payload.direction !== 'right') {
    return invalid('Tool shortcut direction is invalid.')
  }
  return {
    ok: true,
    value: {
      requestId: parsed.value.requestId,
      type: 'shortcut.cycleTool',
      payload: { direction: payload.direction },
    },
  }
}
