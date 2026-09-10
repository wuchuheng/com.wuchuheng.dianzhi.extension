import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import {
  INITIAL_CONVERSATION_VIEW,
  reduceConversationView,
  type ConversationViewState,
} from '@/dianzhi/conversation/reducer'
import { DianzhiError, type DianzhiErrorShape } from '@/dianzhi/domain/errors'
import { DEFAULT_SETTINGS } from '@/dianzhi/domain/settings'
import type { DianzhiSettings, ProviderSettings, ShortcutSettings } from '@/dianzhi/domain/types'
import type { ConversationCommand, ConversationUpdate } from '@/dianzhi/domain/protocol'
import { Composer } from '@/dianzhi/ui/Composer'
import { ConversationStatus } from '@/dianzhi/ui/ConversationStatus'
import { MessageList } from '@/dianzhi/ui/MessageList'
import { ToolTabs } from '@/dianzhi/ui/ToolTabs'
import { ProviderSetup } from '@/dianzhi/ui/ProviderSetup'
import { useStreamingHeight } from '@/dianzhi/ui/use-streaming-height'
import { markdownToPlainText } from '@/dianzhi/ui/markdown-text'
import {
  contentConversationCommand,
  contentToolShortcut,
  contentPanelToggle,
  contentSettingsCommand,
  contentSurfaceStatus,
  contentUiCommand,
  conversationUpdateToContent,
  selectionRoute,
} from '@/events/config'
import type { ToolShortcutRequest, ToolShortcutResult } from '@/dianzhi/domain/ui-session-protocol'

import { createSelectionController } from '../selection/controller'
import { computePlacement, type AnchorRect, type Placement } from '../popover/placement'
import {
  computePopoverMotionStyle,
  usePopoverMotion,
  type PopoverMotionPhase,
  type PopoverMotionStyle,
} from '../popover/motion'
import { formatShortcut, matchesShortcut, toolShortcutNumber } from './shortcuts'
import { log, logError, Scope } from '@/events/logger'
import { openOptionsPageFromContent } from './open-options-page'
import { useScrollGuard } from './scroll-guard'

/* Header action glyphs — inline SVG (no emoji/text-as-icon), one stroke
 * family matching Phosphor's 24-box outline style. */
function actionSvgProps() {
  return {
    viewBox: '0 0 24 24',
    width: 16,
    height: 16,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  } as const
}

function IconExpand() {
  return (
    <svg {...actionSvgProps()}>
      <path d="M9 6V3H3v6M15 6V3h6v6M9 18v3H3v-6M21 15v6h-6" />
    </svg>
  )
}

function IconCollapse() {
  return (
    <svg {...actionSvgProps()}>
      <path d="M6 3v3H3M18 3v3h3M6 21v-3H3M18 21v-3h3" />
    </svg>
  )
}

function IconCardGrid() {
  return (
    <svg {...actionSvgProps()}>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </svg>
  )
}

function IconChatBubble() {
  return (
    <svg {...actionSvgProps()}>
      <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v8a2.5 2.5 0 0 1-2.5 2.5H9.5L5 20.5v-3.9A2.5 2.5 0 0 1 4 14z" />
      <path d="M8 10h.01M12 10h.01M16 10h.01" strokeWidth={2.6} />
    </svg>
  )
}

function IconPanelRight() {
  return (
    <svg {...actionSvgProps()}>
      <rect x="4" y="4" width="16" height="16" rx="2.5" />
      <path d="M14 4v16" />
    </svg>
  )
}

function IconClose() {
  return (
    <svg {...actionSvgProps()}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

function IconCopy() {
  return (
    <svg {...actionSvgProps()}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </svg>
  )
}

export interface ContentAppProps {
  state: ConversationViewState
  placement: Placement
  panelHeight?: number
  bodyScrollable?: boolean
  reasoningEnabled: boolean
  composerValue?: string
  shortcuts: ShortcutSettings
  composerRef?: React.RefObject<HTMLTextAreaElement | null>
  bodyRef?: React.RefObject<HTMLDivElement | null>
  onBodyScroll?(): void
  onComposerChange?(value: string): void
  onToolSelect(toolId: number): void
  onModeChange(mode: 'card' | 'chat'): void
  onExpand(): void
  onClose(): void
  onDock(): void
  onSend(): void
  onStop(): void
  onRetry(): void
  onOpenSettings(): void
  providerSettings: ProviderSettings
  onSaveProvider(provider: ProviderSettings): Promise<void>
  panelRef?: React.RefObject<HTMLDivElement | null>
  motionPhase?: PopoverMotionPhase
  motionStyle?: PopoverMotionStyle
}

export function ContentApp({
  state,
  placement,
  panelHeight = 280,
  bodyScrollable = false,
  reasoningEnabled,
  composerValue = '',
  shortcuts,
  composerRef,
  bodyRef,
  onBodyScroll = () => undefined,
  onComposerChange = () => undefined,
  onToolSelect,
  onModeChange,
  onExpand,
  onClose,
  onDock,
  onSend,
  onStop,
  onRetry,
  onOpenSettings,
  providerSettings,
  onSaveProvider,
  panelRef,
  motionPhase = state.visible ? 'open' : 'hidden',
  motionStyle,
}: ContentAppProps) {
  const snapshot = state.snapshot
  const latestAssistant =
    [...(snapshot?.messages ?? [])].reverse().find((message) => message.role === 'assistant') ??
    null
  const needsSettings =
    state.error?.code === 'PROVIDER_NOT_CONFIGURED' ||
    latestAssistant?.errorCode === 'PROVIDER_NOT_CONFIGURED'
  const [setupDismissed, setSetupDismissed] = useState(false)
  const [previousNeedsSettings, setPreviousNeedsSettings] = useState(needsSettings)
  if (previousNeedsSettings !== needsSettings) {
    setPreviousNeedsSettings(needsSettings)
    if (!needsSettings) setSetupDismissed(false)
  }
  const showSetup = needsSettings && !setupDismissed
  if (motionPhase === 'hidden') return null
  const streaming = latestAssistant?.status === 'streaming'
  const canRetry = latestAssistant?.status === 'error' || latestAssistant?.status === 'stopped'
  const arrowTop = placement.direction === 'below' ? placement.y - 6 : placement.y + panelHeight - 6
  const shortcutTip = (shortcut: string) => ` (${formatShortcut(shortcut)})`
  const expandLabel = state.expanded ? '收起宽屏' : '展开宽屏'
  const onCopyLatestReply = async () => {
    if (!latestAssistant?.content || streaming) return
    try {
      await navigator.clipboard.writeText(markdownToPlainText(latestAssistant.content))
    } catch {
      return
    }
  }
  return (
    <div className="dz-layer" data-dianzhi-popover="true" data-motion-phase={motionPhase}>
      <div
        className={`dz-arrow is-${placement.direction}`}
        style={{ left: placement.x + placement.arrowX - 6, top: arrowTop, ...motionStyle }}
      />
      <div
        ref={panelRef}
        className={`dz-popover is-${placement.direction}${state.expanded ? ' is-expanded' : ''}`}
        style={{
          left: placement.x,
          top: placement.y,
          width: placement.width,
          height: panelHeight,
          ...motionStyle,
        }}
        role="dialog"
        aria-label="点知查询"
      >
        <header className="dz-header">
          <div className="dz-brand" aria-label="点知">
            <span>点</span>
          </div>
          {snapshot?.tools.length ? (
            <div className="dz-header-main">
              <ToolTabs
                tools={snapshot.tools}
                activeToolId={snapshot.activeToolId}
                onSelect={onToolSelect}
              />
            </div>
          ) : (
            /* Brand identity is carried by the logo block alone; the duplicated
             * text fallback is intentional redundancy removal. */
            <div className="dz-header-main" />
          )}
          <div className="dz-actions">
            <button
              type="button"
              aria-label="复制纯文本"
              title="复制纯文本"
              disabled={streaming || !latestAssistant?.content}
              onClick={() => void onCopyLatestReply()}
            >
              <IconCopy />
            </button>
            <button
              type="button"
              aria-label={state.mode === 'card' ? '展开对话' : '显示卡片'}
              title={`${state.mode === 'card' ? '展开对话' : '显示卡片'}${shortcutTip(shortcuts.toggleChat)}`}
              onClick={() => onModeChange(state.mode === 'card' ? 'chat' : 'card')}
            >
              {state.mode === 'card' ? <IconChatBubble /> : <IconCardGrid />}
            </button>
            <button
              type="button"
              aria-label={expandLabel}
              title={`${expandLabel}${shortcutTip(shortcuts.expand)}`}
              onClick={onExpand}
            >
              {state.expanded ? <IconCollapse /> : <IconExpand />}
            </button>
            <button
              type="button"
              aria-label="切换侧边面板"
              title={`切换侧边面板${shortcutTip(shortcuts.dock)}`}
              onClick={onDock}
            >
              <IconPanelRight />
            </button>
            <span className="dz-actions-divider" aria-hidden="true" />
            <button
              type="button"
              aria-label="关闭"
              title={`关闭${shortcutTip(shortcuts.close)}`}
              onClick={onClose}
            >
              <IconClose />
            </button>
          </div>
        </header>

        <main
          ref={bodyRef}
          className={`dz-body${bodyScrollable ? ' is-scrollable' : ''}`}
          onScroll={onBodyScroll}
        >
          <MessageList
            messages={snapshot?.messages ?? []}
            mode={state.mode}
            reasoningEnabled={reasoningEnabled}
            showEmptyState={!state.error && !latestAssistant?.errorMessage}
          />
          {showSetup ? (
            <ProviderSetup
              provider={providerSettings}
              onSave={(provider) => onSaveProvider(provider).then(() => setSetupDismissed(true))}
              onOpenSettings={onOpenSettings}
            />
          ) : state.error || latestAssistant?.errorMessage ? (
            <div className="dz-error" role="alert">
              <span>{state.error?.message ?? latestAssistant?.errorMessage}</span>
            </div>
          ) : null}
        </main>

        {state.mode === 'chat' && (
          <footer className="dz-footer">
            <ConversationStatus message={latestAssistant} />
            {canRetry && (
              <div className="dz-footer-actions">
                <button type="button" className="dz-secondary" onClick={onRetry}>
                  重试
                </button>
              </div>
            )}
            <Composer
              value={composerValue}
              streaming={streaming}
              onChange={onComposerChange}
              onSend={onSend}
              onStop={onStop}
              inputRef={composerRef}
            />
          </footer>
        )}
      </div>
    </div>
  )
}

function errorShape(error: unknown): DianzhiErrorShape {
  if (error instanceof DianzhiError) return error.toJSON()
  return {
    code: 'INVALID_EVENT',
    message: error instanceof Error ? error.message : '点知请求失败。',
  }
}

/** Deterministic viewport-centered anchor used when a restored session has no
 * surviving DOM anchor after a same-page reload; geometry is never persisted. */
function fallbackAnchor(): AnchorRect {
  return {
    left: window.innerWidth / 2,
    right: window.innerWidth / 2,
    top: 96,
    bottom: 96,
  }
}

type PopoverRelocation = {
  x: number
  y: number
  durationMs: number
  sequence: number
}

export default function App({ extensionHost }: { extensionHost: HTMLElement }) {
  const [state, dispatch] = useReducer(reduceConversationView, INITIAL_CONVERSATION_VIEW)
  const [settings, setSettings] = useState<DianzhiSettings>(DEFAULT_SETTINGS)
  const [anchor, setAnchor] = useState<AnchorRect | null>(null)
  const [placement, setPlacement] = useState<Placement>({
    direction: 'below',
    x: 8,
    y: 8,
    arrowX: 24,
    width: 380,
  })
  const [panelHeight, setPanelHeight] = useState(280)
  const [relocation, setRelocation] = useState<PopoverRelocation | null>(null)
  const [composer, setComposer] = useState('')
  const panelRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const selectionControllerRef = useRef<ReturnType<typeof createSelectionController> | null>(null)
  const placementRef = useRef(placement)
  const relocationSequenceRef = useRef(0)
  const requestNumber = useRef(0)
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const {
    phase: popoverMotionPhase,
    open: openPopoverMotion,
    close: closePopoverMotion,
    relocate: relocatePopoverMotion,
  } = usePopoverMotion(reducedMotion)

  const commitPlacement = useCallback((next: Placement) => {
    placementRef.current = next
    setPlacement((current) =>
      current.direction === next.direction &&
      current.x === next.x &&
      current.y === next.y &&
      current.arrowX === next.arrowX &&
      current.width === next.width
        ? current
        : next
    )
  }, [])

  const beginRelocation = useCallback(
    (next: Placement) => {
      const current = placementRef.current
      if (reducedMotion) {
        setRelocation(null)
        commitPlacement(next)
        relocatePopoverMotion(0)
        return
      }
      const rendered = panelRef.current?.getBoundingClientRect()
      const x = (rendered?.left ?? current.x) - next.x
      const y = (rendered?.top ?? current.y) - next.y
      const distance = Math.hypot(x, y)
      const durationMs = Math.round(Math.min(300, Math.max(220, 180 + distance * 0.18)))
      const sequence = ++relocationSequenceRef.current
      commitPlacement(next)
      setRelocation({ x, y, durationMs, sequence })
      relocatePopoverMotion(durationMs)
    },
    [commitPlacement, reducedMotion, relocatePopoverMotion]
  )

  const requestId = useCallback(
    (prefix: string) => `${prefix}-${Date.now()}-${++requestNumber.current}`,
    []
  )
  const sendCommand = useCallback(async (command: ConversationCommand) => {
    const result = await contentConversationCommand.dispatch(command)
    if (result.snapshot) dispatch({ type: 'conversation.sync', snapshot: result.snapshot })
    return result
  }, [])

  /** Applies a tool-shortcut response only when Background routed it to Content. */
  const applyToolResult = useCallback((result: ToolShortcutResult) => {
    if (result.handled && result.target === 'contentScript' && result.snapshot) {
      dispatch({ type: 'conversation.toolChanged', snapshot: result.snapshot })
    }
  }, [])

  const dispatchToolShortcut = useCallback(
    async (request: ToolShortcutRequest) => {
      try {
        const result = await contentToolShortcut.dispatch(request)
        applyToolResult(result)
      } catch (error: unknown) {
        dispatch({ type: 'view.error', error: errorShape(error) })
      }
    },
    [applyToolResult]
  )

  const selectTool = useCallback(
    (index: number) => {
      void dispatchToolShortcut({
        type: 'shortcut.tool',
        requestId: requestId('tool'),
        payload: { origin: 'contentScript', action: 'select', value: index },
      })
    },
    [dispatchToolShortcut, requestId]
  )

  const cycleTool = useCallback(
    (direction: 'left' | 'right') => {
      void dispatchToolShortcut({
        type: 'shortcut.tool',
        requestId: requestId('cycle'),
        payload: { origin: 'contentScript', action: 'cycle', value: direction },
      })
    },
    [dispatchToolShortcut, requestId]
  )

  const withConversation = useCallback(
    (build: (conversationId: number) => ConversationCommand) => {
      const conversationId = state.snapshot?.conversation.id
      if (!conversationId) return
      void sendCommand(build(conversationId)).catch((error: unknown) =>
        dispatch({ type: 'view.error', error: errorShape(error) })
      )
    },
    [sendCommand, state.snapshot?.conversation.id]
  )
  const saveProvider = useCallback(
    async (provider: ProviderSettings) => {
      const saved = await contentSettingsCommand.dispatch({
        type: 'settings.save',
        requestId: requestId('settings'),
        settings: { ...settings, provider },
      })
      setSettings(saved)
    },
    [requestId, settings]
  )
  const togglePanel = useCallback(() => {
    log(Scope.CONTENT_SCRIPT, 'Page requested Side Panel toggle.')
    void contentPanelToggle
      .dispatch({
        type: 'shortcut.panelToggle',
        requestId: requestId('panel'),
        payload: { origin: 'contentScript', contentUIAppeared: state.visible },
      })
      .then((result) => {
        if (
          result.action === 'restore' &&
          result.currentUI === 'contentScript' &&
          result.snapshot
        ) {
          const restoredAnchor = result.contentRestore
            ? selectionControllerRef.current?.restore(result.contentRestore.bookmark)
            : null
          setAnchor(restoredAnchor ?? fallbackAnchor())
          dispatch({ type: 'view.restored', snapshot: result.snapshot })
          openPopoverMotion()
          void contentSurfaceStatus.dispatch({
            type: 'ui.surfaceStatus',
            requestId: requestId('surface'),
            payload: {
              origin: 'contentScript',
              status: 'appeared',
              selectionSessionId: result.snapshot.selectionSession.id,
            },
          })
        }
        log(Scope.CONTENT_SCRIPT, 'Side Panel toggle completed.', {
          currentUI: result.currentUI,
          action: result.action,
        })
      })
      .catch((error: unknown) => logError(Scope.CONTENT_SCRIPT, 'Side Panel toggle failed.', error))
  }, [openPopoverMotion, requestId, state.visible])

  /** Reports surface appearance/destruction to the Background coordinator. */
  const reportSurface = useCallback(
    (status: 'appeared' | 'destroyed', selectionSessionId: number | null) => {
      void contentSurfaceStatus
        .dispatch({
          type: 'ui.surfaceStatus',
          requestId: requestId('surface'),
          payload: { origin: 'contentScript', status, selectionSessionId },
        })
        .catch((error: unknown) =>
          logError(Scope.CONTENT_SCRIPT, 'Surface status report failed.', error)
        )
    },
    [requestId]
  )

  const requestClose = useCallback(
    (event: 'view.closed' | 'view.destroyed') => {
      if (
        document.activeElement instanceof HTMLElement &&
        extensionHost.contains(document.activeElement)
      ) {
        document.activeElement.blur()
      }
      const selectionSessionId = state.snapshot?.selectionSession.id ?? null
      closePopoverMotion(() => {
        dispatch({ type: event })
        reportSurface('destroyed', selectionSessionId)
      })
    },
    [closePopoverMotion, extensionHost, reportSurface, state.snapshot?.selectionSession.id]
  )

  useEffect(() => {
    void contentSettingsCommand
      .dispatch({ type: 'settings.get', requestId: requestId('settings') })
      .then(setSettings)
      .catch((error: unknown) => dispatch({ type: 'view.error', error: errorShape(error) }))
  }, [requestId])

  useEffect(() => {
    dispatch({ type: 'view.destroyed' })
    reportSurface('destroyed', null)
  }, [reportSurface])

  useEffect(
    () =>
      conversationUpdateToContent.handle(async (update: ConversationUpdate) => {
        dispatch(update)
      }),
    []
  )

  useEffect(
    () =>
      contentUiCommand.handle(async (command) => {
        if (command.type !== 'destroy') return
        requestClose('view.destroyed')
      }),
    [requestClose]
  )

  useEffect(() => {
    const controller = createSelectionController({
      document,
      extensionHost,
      triggerMode: settings.shortcuts.triggerMode,
      limits: {
        targetWords: settings.ui.contextTargetWords,
        maxWords: settings.ui.contextMaxWords,
        maxBlocks: settings.ui.contextMaxBlocks,
      },
      onSelection: ({ context, rect, bookmark }) => {
        setAnchor(rect)
        void selectionRoute
          .dispatch({
            type: 'selection.route',
            requestId: requestId('selection'),
            payload: {
              selectedText: context.selectedText,
              contextText: context.contextText,
              bookmark,
              anchorRect: rect,
            },
          })
          .then((result) => {
            if (result.target === 'contentScript' && result.display && result.snapshot) {
              dispatch({ type: 'view.restored', snapshot: result.snapshot })
              openPopoverMotion()
              reportSurface('appeared', result.snapshot.selectionSession.id)
            }
          })
          .catch((error: unknown) => {
            console.error('[dianzhi] selection.route failed:', error)
            dispatch({ type: 'view.error', error: errorShape(error) })
            openPopoverMotion()
          })
      },
      onAnchorChange: setAnchor,
    })
    selectionControllerRef.current = controller
    controller.start()
    return () => {
      selectionControllerRef.current = null
      controller.stop()
    }
  }, [extensionHost, openPopoverMotion, requestId, reportSurface, settings])

  useEffect(() => {
    // While the popover is open, keep the captured word highlighted on the
    // page even when focus moves inside the popover (composer field etc.).
    selectionControllerRef.current?.keepAlive(state.visible)
  }, [state.visible])

  const latestAssistant =
    [...(state.snapshot?.messages ?? [])]
      .reverse()
      .find((message) => message.role === 'assistant') ?? null
  const streaming = latestAssistant?.status === 'streaming'

  // Closing the popover returns focus to the page instead of leaving it
  // stuck on a removed node (WCAG focus management).
  const closePopover = useCallback(() => {
    requestClose('view.closed')
  }, [requestClose])

  const dockPopover = useCallback(() => {
    if (state.visible) closePopover()
    togglePanel()
  }, [closePopover, state.visible, togglePanel])

  // Re-focus the textarea on `streaming` flips so that after send the input is
  // focused again and the user can type the next draft while the reply streams.
  // Scrolling is handled by `useScrollGuard`: pinned views follow new content
  // (instantly while streaming, smoothly on discrete updates), scrolled-away
  // views keep their position with no auto-scroll.
  useLayoutEffect(() => {
    if (!state.visible || state.mode !== 'chat') return
    composerRef.current?.focus()
  }, [state.visible, state.mode, streaming])

  const onBodyScroll = useScrollGuard(bodyRef, {
    visible: state.visible,
    mode: state.mode,
    streaming,
    messages: state.snapshot?.messages,
  })
  const maximumPanelHeight = Math.min(560, Math.max(0, window.innerHeight - 16))

  useStreamingHeight({
    elementRef: panelRef,
    visible: state.visible,
    targetVersion: [state.snapshot, state.expanded, state.mode],
    minimumHeight: 280,
    maximumHeight: maximumPanelHeight,
    reducedMotion,
    onHeightChange: setPanelHeight,
  })

  useLayoutEffect(() => {
    if (!anchor) return
    const frame = window.requestAnimationFrame(() => {
      const next = computePlacement(
        anchor,
        { width: state.expanded ? 544 : 380, height: panelHeight },
        { width: window.innerWidth, height: window.innerHeight }
      )
      const current = placementRef.current

      if (!state.visible || popoverMotionPhase === 'hidden' || popoverMotionPhase === 'opening') {
        setRelocation(null)
        commitPlacement(next)
        return
      }
      if (popoverMotionPhase === 'closing') return
      if (current.direction !== next.direction) {
        beginRelocation(next)
        return
      }
      if (popoverMotionPhase === 'relocating') return
      commitPlacement(next)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [
    anchor,
    beginRelocation,
    commitPlacement,
    panelHeight,
    popoverMotionPhase,
    state.expanded,
    state.visible,
  ])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (state.visible && event.target instanceof Node && !extensionHost.contains(event.target)) {
        closePopover()
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (popoverMotionPhase === 'closing') return
      if (matchesShortcut(event, settings.shortcuts.close)) {
        event.preventDefault()
        closePopover()
        return
      }
      if (matchesShortcut(event, settings.shortcuts.dock)) {
        event.preventDefault()
        log(Scope.CONTENT_SCRIPT, 'Page received Side Panel toggle shortcut.')
        dockPopover()
        return
      }
      // Tool shortcuts always dispatch; the coordinator decides the target and
      // a no-apparent-UI result changes nothing locally.
      if (
        matchesShortcut(event, settings.shortcuts.tabLeft) ||
        matchesShortcut(event, settings.shortcuts.tabRight)
      ) {
        event.preventDefault()
        cycleTool(matchesShortcut(event, settings.shortcuts.tabLeft) ? 'left' : 'right')
        return
      }
      const toolNumber = toolShortcutNumber(event)
      if (toolNumber !== null) {
        event.preventDefault()
        selectTool(toolNumber)
        return
      }
      if (!state.snapshot) return
      if (matchesShortcut(event, settings.shortcuts.expand)) {
        event.preventDefault()
        dispatch({ type: 'view.expanded', expanded: !state.expanded })
        return
      }
      if (matchesShortcut(event, settings.shortcuts.toggleChat)) {
        event.preventDefault()
        dispatch({ type: 'view.mode', mode: state.mode === 'card' ? 'chat' : 'card' })
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [
    closePopover,
    cycleTool,
    dockPopover,
    extensionHost,
    popoverMotionPhase,
    selectTool,
    settings.shortcuts,
    state,
  ])

  return (
    <ContentApp
      state={state}
      placement={placement}
      panelHeight={panelHeight}
      bodyScrollable={panelHeight >= maximumPanelHeight}
      panelRef={panelRef}
      motionPhase={popoverMotionPhase}
      motionStyle={
        anchor
          ? {
              ...computePopoverMotionStyle(anchor, placement, panelHeight),
              ...(relocation
                ? {
                    '--dz-motion-relocate-x': `${relocation.x}px`,
                    '--dz-motion-relocate-y': `${relocation.y}px`,
                    '--dz-motion-relocate-duration': `${relocation.durationMs}ms`,
                    '--dz-motion-relocate-name': `dz-popover-slide-${relocation.sequence % 2 ? 'a' : 'b'}`,
                    '--dz-motion-relocate-arrow-name': `dz-popover-arrow-slide-${relocation.sequence % 2 ? 'a' : 'b'}`,
                  }
                : {}),
            }
          : undefined
      }
      providerSettings={settings.provider}
      onSaveProvider={saveProvider}
      reasoningEnabled={settings.provider.reasoningEnabled}
      composerValue={composer}
      shortcuts={settings.shortcuts}
      composerRef={composerRef}
      bodyRef={bodyRef}
      onBodyScroll={onBodyScroll}
      onComposerChange={setComposer}
      onToolSelect={(toolId) => {
        const index = state.snapshot?.tools.findIndex(({ tool }) => tool.id === toolId) ?? -1
        if (index >= 0) selectTool(index + 1)
      }}
      onModeChange={(mode) => dispatch({ type: 'view.mode', mode })}
      onExpand={() => dispatch({ type: 'view.expanded', expanded: !state.expanded })}
      onClose={closePopover}
      onDock={dockPopover}
      onSend={() => {
        const content = composer.trim()
        if (!content) return
        setComposer('')
        withConversation((conversationId) => ({
          type: 'conversation.followup',
          requestId: requestId('followup'),
          payload: { conversationId, content },
        }))
      }}
      onStop={() =>
        withConversation((conversationId) => ({
          type: 'stream.stop',
          requestId: requestId('stop'),
          payload: { conversationId },
        }))
      }
      onRetry={() =>
        withConversation((conversationId) => ({
          type: 'conversation.retry',
          requestId: requestId('retry'),
          payload: { conversationId },
        }))
      }
      onOpenSettings={() => openOptionsPageFromContent()}
    />
  )
}
