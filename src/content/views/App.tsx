import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import {
  INITIAL_CONVERSATION_VIEW,
  reduceConversationView,
  type ConversationViewState,
} from '@/dianzhi/conversation/reducer'
import { DianzhiError, type DianzhiErrorShape } from '@/dianzhi/domain/errors'
import { DEFAULT_SETTINGS } from '@/dianzhi/domain/settings'
import type { DianzhiSettings } from '@/dianzhi/domain/types'
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
import './App.css'

function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1]?.toLowerCase()
  if (!key) return false
  return (
    event.ctrlKey === parts.includes('Control') &&
    event.altKey === parts.includes('Alt') &&
    event.shiftKey === parts.includes('Shift') &&
    event.metaKey === parts.includes('Meta') &&
    event.key.toLowerCase() === key
  )
}

export interface ContentAppProps {
  state: ConversationViewState
  placement: Placement
  panelHeight?: number
  reasoningEnabled: boolean
  composerValue?: string
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
          <div className="dz-header-main">
            {snapshot?.tools.length ? (
              <ToolTabs
                tools={snapshot.tools}
                activeToolId={snapshot.activeToolId}
                onSelect={onToolSelect}
              />
            ) : (
              <strong>点知</strong>
            )}
          </div>
          <div className="dz-actions">
            <button
              type="button"
              aria-label={state.mode === 'card' ? '展开对话' : '显示卡片'}
              title={state.mode === 'card' ? '展开对话' : '显示卡片'}
              onClick={() => onModeChange(state.mode === 'card' ? 'chat' : 'card')}
            >
              {state.mode === 'card' ? '◫' : '▣'}
            </button>
            <button
              type="button"
              aria-label={state.expanded ? '收起宽屏' : '展开宽屏'}
              title={state.expanded ? '收起宽屏' : '展开宽屏'}
              onClick={onExpand}
            >
              {state.expanded ? '↙' : '↗'}
            </button>
            <button type="button" aria-label="在侧边栏继续" title="在侧边栏继续" onClick={onDock}>
              ⇥
            </button>
            <button type="button" aria-label="关闭" title="关闭" onClick={onClose}>
              ×
            </button>
          </div>
        </header>

        <main className="dz-body">
          <MessageList
            messages={snapshot?.messages ?? []}
            mode={state.mode}
            reasoningEnabled={reasoningEnabled}
          />
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

        <footer className="dz-footer">
          <ConversationStatus message={latestAssistant} />
          <div className="dz-footer-actions">
            {streaming && (
              <button type="button" className="dz-secondary" onClick={onStop}>
                停止
              </button>
            )}
            {canRetry && (
              <button type="button" className="dz-secondary" onClick={onRetry}>
                重试
              </button>
            )}
          </div>
          {state.mode === 'chat' && (
            <Composer
              value={composerValue}
              disabled={streaming}
              onChange={onComposerChange}
              onSend={onSend}
            />
          )}
        </footer>
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
        dispatch({ type: 'view.closed' })
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && state.visible) dispatch({ type: 'view.closed' })
      if (!state.snapshot) return
      if (matchesShortcut(event, settings.shortcuts.toggleChat)) {
        event.preventDefault()
        dispatch({ type: 'view.mode', mode: state.mode === 'card' ? 'chat' : 'card' })
        return
      }
      if (matchesShortcut(event, settings.shortcuts.dock)) {
        event.preventDefault()
        withConversation((conversationId) => ({
          type: 'panel.open',
          requestId: requestId('panel'),
          payload: { conversationId },
        }))
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
  }, [extensionHost, requestId, selectTool, settings.shortcuts, state, withConversation])

  return (
    <ContentApp
      state={state}
      placement={placement}
      panelHeight={panelHeight}
      panelRef={panelRef}
      reasoningEnabled={settings.provider.reasoningEnabled}
      composerValue={composer}
      onComposerChange={setComposer}
      onToolSelect={(toolId) => void selectTool(toolId)}
      onModeChange={(mode) => dispatch({ type: 'view.mode', mode })}
      onExpand={() => dispatch({ type: 'view.expanded', expanded: !state.expanded })}
      onClose={() => dispatch({ type: 'view.closed' })}
      onDock={() =>
        withConversation((conversationId) => ({
          type: 'panel.open',
          requestId: requestId('panel'),
          payload: { conversationId },
        }))
      }
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
