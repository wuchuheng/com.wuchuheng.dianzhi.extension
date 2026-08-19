import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Composer } from '@/dianzhi/ui/Composer'
import { ConversationStatus } from '@/dianzhi/ui/ConversationStatus'
import { MessageList } from '@/dianzhi/ui/MessageList'
import { ToolTabs } from '@/dianzhi/ui/ToolTabs'
import { DEFAULT_SETTINGS } from '@/dianzhi/domain/settings'
import type { DianzhiSettings } from '@/dianzhi/domain/types'
import type { ConversationCommand, ConversationUpdate } from '@/dianzhi/domain/protocol'
import { SIDEPANEL_PORT_NAME } from '@/dianzhi/domain/protocol'
import { extensionConversationCommand, settingsCommand } from '@/events/config'
import { matchesShortcut, toolShortcutNumber } from '@/dianzhi/domain/shortcuts'
import {
  INITIAL_PANEL_STATE,
  cycleEnabledTool,
  reducePanelState,
  type PanelState,
} from './panel-state'
import { isNearBottom } from './scroll-pin'
import './App.css'

export interface SidePanelViewProps {
  state: PanelState
  reasoningEnabled: boolean
  draft: string
  onDraftChange(value: string): void
  onToolSelect(toolId: number): void
  onSend(): void
  onStop(): void
  onRetry(): void
  onOpenSettings(): void
}

export function SidePanelView({
  state,
  reasoningEnabled,
  draft,
  onDraftChange,
  onToolSelect,
  onSend,
  onStop,
  onRetry,
  onOpenSettings,
}: SidePanelViewProps) {
  const snapshot = state.snapshot
  const latestAssistant =
    [...(snapshot?.messages ?? [])].reverse().find((message) => message.role === 'assistant') ??
    null
  const streaming = latestAssistant?.status === 'streaming'
  const retryable = latestAssistant?.status === 'error' || latestAssistant?.status === 'stopped'
  const needsSettings = latestAssistant?.errorCode === 'PROVIDER_NOT_CONFIGURED'

  const historyRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const hasSnapshot = snapshot !== null
  const pinnedRef = useRef(true)
  const viewKey = `${snapshot?.conversation.id ?? ''}:${snapshot?.activeToolId ?? ''}`
  const previousViewKey = useRef(viewKey)

  useEffect(() => {
    // Opening the panel or switching tools starts pinned to the latest message.
    if (previousViewKey.current !== viewKey) {
      previousViewKey.current = viewKey
      pinnedRef.current = true
    }
  }, [viewKey])

  useEffect(() => {
    // Focus the chat input once a conversation is attached and nothing is
    // streaming (the stream ending flips `streaming` and re-runs this).
    if (!hasSnapshot || streaming) return
    composerRef.current?.focus()
  }, [viewKey, streaming, hasSnapshot])

  const messages = snapshot?.messages
  useEffect(() => {
    // Follow the bottom while pinned so new streamed messages stay visible.
    const container = historyRef.current
    if (container && messages && messages.length > 0 && pinnedRef.current) {
      container.scrollTop = container.scrollHeight
    }
  }, [messages])

  const onHistoryScroll = useCallback(() => {
    const container = historyRef.current
    if (container) pinnedRef.current = isNearBottom(container)
  }, [])

  return (
    <div className="dz-panel-page">
      {snapshot ? (
        <>
          <ToolTabs
            tools={snapshot.tools}
            activeToolId={snapshot.activeToolId}
            onSelect={onToolSelect}
          />
          <main className="dz-panel-history" ref={historyRef} onScroll={onHistoryScroll}>
            <MessageList
              messages={snapshot.messages}
              mode="chat"
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
          <footer className="dz-panel-composer">
            <ConversationStatus message={latestAssistant} />
            {retryable && (
              <button type="button" className="dz-secondary" onClick={onRetry}>
                重试
              </button>
            )}
            <Composer
              value={draft}
              disabled={streaming}
              streaming={streaming}
              onChange={onDraftChange}
              onSend={onSend}
              onStop={onStop}
              inputRef={composerRef}
            />
          </footer>
        </>
      ) : (
        <main className="dz-panel-empty">
          <div className="dz-empty-mark">点</div>
          <h1>选择英文文本后，继续在这里对话</h1>
          <p>{state.connected ? '等待当前标签页的点知会话…' : '连接已断开，请重新打开侧边栏。'}</p>
        </main>
      )}
    </div>
  )
}

function requestId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export default function App() {
  const [state, dispatch] = useReducer(reducePanelState, INITIAL_PANEL_STATE)
  const [settings, setSettings] = useState<DianzhiSettings>(DEFAULT_SETTINGS)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const handoffAcknowledged = useRef(false)

  const command = useCallback(async (value: ConversationCommand) => {
    const result = await extensionConversationCommand.dispatch(value)
    if (result.snapshot) dispatch({ type: 'conversation.sync', snapshot: result.snapshot })
  }, [])

  useEffect(() => {
    void settingsCommand
      .dispatch({ type: 'settings.get', requestId: requestId('settings') })
      .then(setSettings)
    let disposed = false
    let port: chrome.runtime.Port | null = null
    let reconnectTimer: number | null = null

    const connect = () => {
      if (disposed) return
      const current = chrome.runtime.connect({ name: SIDEPANEL_PORT_NAME })
      port = current
      dispatch({ type: 'panel.connected' })
      current.onMessage.addListener((value: unknown) => {
        if (
          typeof value === 'object' &&
          value !== null &&
          typeof (value as { type?: unknown }).type === 'string'
        ) {
          dispatch(value as ConversationUpdate)
        }
      })
      current.onDisconnect.addListener(() => {
        if (disposed || port !== current) return
        port = null
        dispatch({ type: 'panel.disconnected' })
        reconnectTimer = window.setTimeout(connect, 100)
      })
      void chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
        if (!disposed && port === current && tab?.id)
          current.postMessage({ type: 'ready', tabId: tab.id })
      })
    }

    connect()
    return () => {
      disposed = true
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer)
      port?.disconnect()
    }
  }, [])

  useEffect(() => {
    const conversationId = state.snapshot?.conversation.id
    if (!conversationId || handoffAcknowledged.current) return
    handoffAcknowledged.current = true
    void command({
      type: 'panel.rendered',
      requestId: requestId('rendered'),
      payload: { conversationId },
    }).catch(() => {
      handoffAcknowledged.current = false
    })
  }, [command, state.snapshot?.conversation.id])

  const currentTool = state.snapshot?.activeToolId
  const draftKey = currentTool === undefined ? '' : String(currentTool)
  const draft = drafts[draftKey] ?? ''
  const withConversation = useCallback(
    (build: (id: number) => ConversationCommand) => {
      const id = state.snapshot?.conversation.id
      if (id) void command(build(id))
    },
    [command, state.snapshot?.conversation.id]
  )
  const selectTool = useCallback(
    (toolId: number) => {
      const snapshot = state.snapshot
      if (!snapshot || toolId === snapshot.activeToolId) return
      void command({
        type: 'conversation.ensureTool',
        requestId: requestId('tool'),
        payload: { selectionKey: snapshot.conversation.selectionKey, toolId },
      })
    },
    [command, state.snapshot]
  )

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const toolNumber = toolShortcutNumber(event)
      // The configured close (Esc by default) and the dock toggle both close
      // the panel from inside it — the content-script half of the toggle
      // cannot hear keys while focus lives in the Side Panel page.
      if (
        matchesShortcut(event, settings.shortcuts.close) ||
        matchesShortcut(event, settings.shortcuts.dock)
      ) {
        event.preventDefault()
        withConversation((conversationId) => ({
          type: 'panel.close',
          requestId: requestId('close'),
          payload: { conversationId },
        }))
      } else if (toolNumber !== null) {
        event.preventDefault()
        const tool = state.snapshot?.tools[toolNumber - 1]
        if (tool) selectTool(tool.tool.id)
      } else if (event.ctrlKey && event.key === '.') {
        event.preventDefault()
        withConversation((conversationId) => ({
          type: 'stream.stop',
          requestId: requestId('stop'),
          payload: { conversationId },
        }))
      } else if (event.ctrlKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault()
        const toolId = cycleEnabledTool(state.snapshot, event.key === 'ArrowLeft' ? -1 : 1)
        if (toolId) selectTool(toolId)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectTool, settings.shortcuts, state.snapshot, withConversation])

  return (
    <SidePanelView
      state={state}
      reasoningEnabled={settings.provider.reasoningEnabled}
      draft={draft}
      onDraftChange={(value) => setDrafts((current) => ({ ...current, [draftKey]: value }))}
      onToolSelect={selectTool}
      onSend={() => {
        const content = draft.trim()
        if (!content) return
        setDrafts((current) => ({ ...current, [draftKey]: '' }))
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
