import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import {
  INITIAL_CONVERSATION_VIEW,
  reduceConversationView,
  type ConversationViewState,
} from '@/dianzhi/conversation/reducer'
import { DianzhiError, type DianzhiErrorShape } from '@/dianzhi/domain/errors'
import { DEFAULT_SETTINGS } from '@/dianzhi/domain/settings'
import type { DianzhiSettings, ShortcutSettings } from '@/dianzhi/domain/types'
import type { ConversationCommand, ConversationUpdate } from '@/dianzhi/domain/protocol'
import { Composer } from '@/dianzhi/ui/Composer'
import { ConversationStatus } from '@/dianzhi/ui/ConversationStatus'
import { MessageList } from '@/dianzhi/ui/MessageList'
import { ToolTabs } from '@/dianzhi/ui/ToolTabs'
import {
  contentConversationCommand,
  contentSettingsCommand,
  conversationUpdateToContent,
} from '@/events/config'
import { createSelectionController } from '../selection/controller'
import { computePlacement, type AnchorRect, type Placement } from '../popover/placement'
import { formatShortcut, matchesShortcut } from './shortcuts'
import './App.css'

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

export interface ContentAppProps {
  state: ConversationViewState
  placement: Placement
  panelHeight?: number
  reasoningEnabled: boolean
  composerValue?: string
  shortcuts: ShortcutSettings
  composerRef?: React.RefObject<HTMLTextAreaElement | null>
  bodyRef?: React.RefObject<HTMLDivElement | null>
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
  panelRef?: React.RefObject<HTMLDivElement | null>
}

export function ContentApp({
  state,
  placement,
  panelHeight = 280,
  reasoningEnabled,
  composerValue = '',
  shortcuts,
  composerRef,
  bodyRef,
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
  panelRef,
}: ContentAppProps) {
  if (!state.visible) return null
  const snapshot = state.snapshot
  const latestAssistant =
    [...(snapshot?.messages ?? [])].reverse().find((message) => message.role === 'assistant') ??
    null
  const streaming = latestAssistant?.status === 'streaming'
  const canRetry = latestAssistant?.status === 'error' || latestAssistant?.status === 'stopped'
  const needsSettings =
    state.error?.code === 'PROVIDER_NOT_CONFIGURED' ||
    latestAssistant?.errorCode === 'PROVIDER_NOT_CONFIGURED'
  const arrowTop = placement.direction === 'below' ? placement.y - 6 : placement.y + panelHeight - 6
  const shortcutTip = (shortcut: string) => ` (${formatShortcut(shortcut)})`
  const expandLabel = state.expanded ? '收起宽屏' : '展开宽屏'
  return (
    <div className="dz-layer" data-dianzhi-popover="true">
      <div
        className={`dz-arrow is-${placement.direction}`}
        style={{ left: placement.x + placement.arrowX - 6, top: arrowTop }}
      />
      <div
        ref={panelRef}
        className={`dz-popover${state.expanded ? ' is-expanded' : ''}`}
        style={{ left: placement.x, top: placement.y, width: placement.width }}
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

        <main ref={bodyRef} className="dz-body">
          <MessageList
            messages={snapshot?.messages ?? []}
            mode={state.mode}
            reasoningEnabled={reasoningEnabled}
          />
          {state.mode === 'card' && (
            <button type="button" className="dz-card-cta" onClick={() => onModeChange('chat')}>
              继续对话{shortcutTip(shortcuts.toggleChat)}
            </button>
          )}
          {(state.error || latestAssistant?.errorMessage) && (
            <div className="dz-error" role="alert">
              <span>{state.error?.message ?? latestAssistant?.errorMessage}</span>
              {needsSettings && (
                <button type="button" onClick={onOpenSettings}>
                  打开设置
                </button>
              )}
            </div>
          )}
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
              disabled={streaming}
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
  const [composer, setComposer] = useState('')
  const panelRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const requestNumber = useRef(0)

  const requestId = useCallback(
    (prefix: string) => `${prefix}-${Date.now()}-${++requestNumber.current}`,
    []
  )
  const sendCommand = useCallback(async (command: ConversationCommand) => {
    const result = await contentConversationCommand.dispatch(command)
    if (result.snapshot) dispatch({ type: 'conversation.sync', snapshot: result.snapshot })
    return result
  }, [])
  const selectTool = useCallback(
    async (toolId: number) => {
      const snapshot = state.snapshot
      if (!snapshot || toolId === snapshot.activeToolId) return
      await sendCommand({
        type: 'conversation.ensureTool',
        requestId: requestId('tool'),
        payload: { selectionKey: snapshot.conversation.selectionKey, toolId },
      }).catch((error: unknown) => dispatch({ type: 'view.error', error: errorShape(error) }))
    },
    [requestId, sendCommand, state.snapshot]
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
  const togglePanel = useCallback(() => {
    withConversation((conversationId) => ({
      type: 'panel.toggle',
      requestId: requestId('panel'),
      payload: { conversationId },
    }))
  }, [requestId, withConversation])

  useEffect(() => {
    void contentSettingsCommand
      .dispatch({ type: 'settings.get', requestId: requestId('settings') })
      .then(setSettings)
      .catch((error: unknown) => dispatch({ type: 'view.error', error: errorShape(error) }))
  }, [requestId])

  useEffect(
    () =>
      conversationUpdateToContent.handle(async (update: ConversationUpdate) => {
        dispatch(update)
      }),
    []
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
      onSelection: ({ context, rect }) => {
        setAnchor(rect)
        dispatch({ type: 'selection.started' })
        void sendCommand({
          type: 'conversation.create',
          requestId: requestId('selection'),
          payload: { selectedText: context.selectedText, contextText: context.contextText },
        }).catch((error: unknown) => {
          console.error('[dianzhi] conversation.create failed:', error)
          dispatch({ type: 'view.error', error: errorShape(error) })
        })
      },
      onAnchorChange: setAnchor,
    })
    controller.start()
    return () => controller.stop()
  }, [extensionHost, requestId, sendCommand, settings])

  const latestAssistant =
    [...(state.snapshot?.messages ?? [])]
      .reverse()
      .find((message) => message.role === 'assistant') ?? null
  const streaming = latestAssistant?.status === 'streaming'

  // Closing the popover returns focus to the page instead of leaving it
  // stuck on a removed node (WCAG focus management).
  const closePopover = useCallback(() => {
    if (
      document.activeElement instanceof HTMLElement &&
      extensionHost.contains(document.activeElement)
    ) {
      document.activeElement.blur()
    }
    dispatch({ type: 'view.closed' })
  }, [extensionHost])

  useLayoutEffect(() => {
    if (!state.visible || state.mode !== 'chat') return
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    // Defer focusing until the stream ends; `streaming` flips to false so this
    // effect re-runs once the reply completes.
    if (streaming) return
    composerRef.current?.focus()
  }, [state.visible, state.mode, streaming])

  useLayoutEffect(() => {
    if (!state.visible || !anchor) return
    const frame = window.requestAnimationFrame(() => {
      const measuredHeight = Math.min(
        panelRef.current?.offsetHeight ?? 280,
        window.innerHeight - 16
      )
      setPanelHeight(measuredHeight)
      setPlacement(
        computePlacement(
          anchor,
          { width: state.expanded ? 680 : 380, height: measuredHeight },
          { width: window.innerWidth, height: window.innerHeight }
        )
      )
    })
    return () => window.cancelAnimationFrame(frame)
  }, [anchor, state.visible, state.expanded, state.snapshot, state.mode])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (state.visible && event.target instanceof Node && !extensionHost.contains(event.target)) {
        closePopover()
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (matchesShortcut(event, settings.shortcuts.close)) {
        event.preventDefault()
        closePopover()
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
        return
      }
      if (matchesShortcut(event, settings.shortcuts.dock)) {
        event.preventDefault()
        togglePanel()
        return
      }
      if (
        matchesShortcut(event, settings.shortcuts.tabLeft) ||
        matchesShortcut(event, settings.shortcuts.tabRight)
      ) {
        event.preventDefault()
        const tools = state.snapshot.tools
        const current = tools.findIndex(({ tool }) => tool.id === state.snapshot?.activeToolId)
        const direction = matchesShortcut(event, settings.shortcuts.tabLeft) ? -1 : 1
        const next = tools[(current + direction + tools.length) % tools.length]
        if (next) void selectTool(next.tool.id)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [closePopover, extensionHost, requestId, selectTool, settings.shortcuts, state, togglePanel])

  return (
    <ContentApp
      state={state}
      placement={placement}
      panelHeight={panelHeight}
      panelRef={panelRef}
      reasoningEnabled={settings.provider.reasoningEnabled}
      composerValue={composer}
      shortcuts={settings.shortcuts}
      composerRef={composerRef}
      bodyRef={bodyRef}
      onComposerChange={setComposer}
      onToolSelect={(toolId) => void selectTool(toolId)}
      onModeChange={(mode) => dispatch({ type: 'view.mode', mode })}
      onExpand={() => dispatch({ type: 'view.expanded', expanded: !state.expanded })}
      onClose={closePopover}
      onDock={togglePanel}
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
      onOpenSettings={() => void chrome.runtime.openOptionsPage()}
    />
  )
}
