import type { ConversationSnapshot, ParseResult } from './protocol'
import type { AnchorRect } from '@/content/popover/placement'
import type { SelectionBookmark } from '@/content/selection/restore'

export type UiSurface = 'contentScript' | 'sidePanel'
export type PanelOrigin = UiSurface

export type SurfaceStatusRequest = {
  requestId: string
  type: 'ui.surfaceStatus'
  payload:
    | {
        origin: 'contentScript'
        status: 'appeared' | 'destroyed'
        selectionSessionId: number | null
      }
    | {
        origin: 'sidePanel'
        status: 'appeared' | 'destroyed'
        selectionSessionId: number | null
        panelInstanceId: string
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
  payload:
    | { origin: 'contentScript'; contentUIAppeared: boolean }
    | { origin: 'sidePanel'; panelInstanceId: string }
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

export type ToolShortcutRequest = {
  requestId: string
  type: 'shortcut.tool'
  payload:
    | { origin: 'contentScript'; action: 'select'; value: number }
    | { origin: 'contentScript'; action: 'cycle'; value: 'left' | 'right' }
    | { origin: 'sidePanel'; panelInstanceId: string; action: 'select'; value: number }
    | { origin: 'sidePanel'; panelInstanceId: string; action: 'cycle'; value: 'left' | 'right' }
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
  const validStatus = payload.status === 'appeared' || payload.status === 'destroyed'
  const validSelectionSession =
    payload.selectionSessionId === null || isPositiveInteger(payload.selectionSessionId)
  if (!validStatus || !validSelectionSession) {
    return invalid('UI surface status payload is invalid.')
  }
  const status = payload.status as 'appeared' | 'destroyed'
  const selectionSessionId = payload.selectionSessionId as number | null

  if (
    payload.origin === 'contentScript' &&
    Object.keys(payload).every((key) =>
      ['origin', 'status', 'selectionSessionId'].includes(key)
    )
  ) {
    return {
      ok: true,
      value: {
        requestId: parsed.value.requestId,
        type: 'ui.surfaceStatus',
        payload: {
          origin: 'contentScript',
          status,
          selectionSessionId,
        },
      },
    }
  }

  if (
    payload.origin === 'sidePanel' &&
    typeof payload.panelInstanceId === 'string' &&
    payload.panelInstanceId.trim().length > 0 &&
    Object.keys(payload).every((key) =>
      ['origin', 'status', 'selectionSessionId', 'panelInstanceId'].includes(key)
    )
  ) {
    return {
      ok: true,
      value: {
        requestId: parsed.value.requestId,
        type: 'ui.surfaceStatus',
        payload: {
          origin: 'sidePanel',
          status,
          selectionSessionId,
          panelInstanceId: payload.panelInstanceId,
        },
      },
    }
  }

  return invalid('UI surface status payload is invalid.')
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
  const { payload } = parsed.value
  if (
    payload.origin === 'contentScript' &&
    typeof payload.contentUIAppeared === 'boolean' &&
    Object.keys(payload).every((key) => ['origin', 'contentUIAppeared'].includes(key))
  ) {
    return {
      ok: true,
      value: {
        requestId: parsed.value.requestId,
        type: 'shortcut.panelToggle',
        payload: { origin: 'contentScript', contentUIAppeared: payload.contentUIAppeared },
      },
    }
  }
  if (
    payload.origin === 'sidePanel' &&
    typeof payload.panelInstanceId === 'string' &&
    payload.panelInstanceId.trim().length > 0 &&
    Object.keys(payload).every((key) => ['origin', 'panelInstanceId'].includes(key))
  ) {
    return {
      ok: true,
      value: {
        requestId: parsed.value.requestId,
        type: 'shortcut.panelToggle',
        payload: { origin: 'sidePanel', panelInstanceId: payload.panelInstanceId },
      },
    }
  }
  return invalid('Panel toggle payload is invalid.')
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

export function parseToolShortcutRequest(value: unknown): ParseResult<ToolShortcutRequest> {
  const parsed = parseEnvelope(value, 'shortcut.tool')
  if (!parsed.ok) return parsed
  const { payload } = parsed.value
  const origin = payload.origin
  const action = payload.action
  const validOrigin = origin === 'contentScript' || origin === 'sidePanel'
  const validAction = action === 'select' || action === 'cycle'
  if (!validOrigin || !validAction) return invalid('Tool shortcut request is invalid.')
  const expected = origin === 'sidePanel' ? ['origin', 'panelInstanceId', 'action', 'value'] : ['origin', 'action', 'value']
  if (!Object.keys(payload).every((key) => expected.includes(key))) return invalid('Tool shortcut request is invalid.')
  if (origin === 'sidePanel' && (typeof payload.panelInstanceId !== 'string' || !payload.panelInstanceId.trim())) return invalid('Tool shortcut request is invalid.')
  if (action === 'select' && !isPositiveInteger(payload.value)) return invalid('Tool shortcut index is invalid.')
  if (action === 'cycle' && payload.value !== 'left' && payload.value !== 'right') return invalid('Tool shortcut direction is invalid.')
  const caller = origin === 'sidePanel' ? { origin, panelInstanceId: payload.panelInstanceId as string } : { origin }
  return { ok: true, value: { requestId: parsed.value.requestId, type: 'shortcut.tool', payload: action === 'select' ? { ...caller, action, value: payload.value as number } : { ...caller, action, value: payload.value as 'left' | 'right' } } as ToolShortcutRequest }
}
