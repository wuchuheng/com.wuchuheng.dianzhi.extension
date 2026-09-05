import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Composer } from '@/dianzhi/ui/Composer'
import { MessageList } from '@/dianzhi/ui/MessageList'
import { ToolTabs } from '@/dianzhi/ui/ToolTabs'
import { ProviderSetup } from '@/dianzhi/ui/ProviderSetup'
import { useStreamingHeight } from '@/dianzhi/ui/use-streaming-height'
import { DEFAULT_SETTINGS } from '@/dianzhi/domain/settings'
import type { DianzhiSettings, ProviderSettings } from '@/dianzhi/domain/types'
import type { ConversationCommand } from '@/dianzhi/domain/protocol'
import { DianzhiError, type DianzhiErrorShape } from '@/dianzhi/domain/errors'
import {
  extensionConversationCommand,
  panelToolShortcut,
  panelPanelToggle,
  panelSurfaceStatus,
  settingsCommand,
  sidePanelCommand,
  sidePanelConversationUpdate,
} from '@/events/config'
import type { PanelToggleResult, ToolShortcutResult } from '@/dianzhi/domain/ui-session-protocol'
import { log, logError, Scope } from '@/events/logger'
import { matchesShortcut, toolShortcutNumber } from '@/dianzhi/domain/shortcuts'
import { INITIAL_PANEL_STATE, reducePanelState, type PanelState } from './panel-state'
import { useScrollFollow } from './scroll-follow'
import './App.css'

export interface SidePanelViewProps {
  state: PanelState
  reasoningEnabled: boolean
  draft: string
  providerSettings: ProviderSettings
  onDraftChange(value: string): void
  onToolSelect(toolId: number): void
  onSaveProvider(provider: ProviderSettings): Promise<void>
  onSend(): void
  onStop(): void
  onRetry(): void
  onOpenSettings(): void
}

export function SidePanelView({
  state,
  reasoningEnabled,
  draft,
  providerSettings,
  onDraftChange,
  onToolSelect,
  onSaveProvider,
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
  const needsSettings = latestAssistant?.errorCode === 'PROVIDER_NOT_CONFIGURED'

  const historyRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const hasSnapshot = snapshot !== null
  const viewKey = `${snapshot?.conversation.id ?? ''}:${snapshot?.activeToolId ?? ''}`

  useEffect(() => {
    // Focus the chat input when a conversation or active tool is attached.
    if (!hasSnapshot) return
    composerRef.current?.focus()
  }, [viewKey, hasSnapshot])

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const { onScroll: onHistoryScroll, onStreamingHeightDelta } = useScrollFollow(historyRef, {
    reducedMotion,
    messages: snapshot?.messages,
    viewKey,
  })

  const setupRef = useRef<HTMLDivElement | null>(null)
  const [setupHeight, setSetupHeight] = useState(0)
  const [setupDismissed, setSetupDismissed] = useState(false)
  const [previousNeedsSettings, setPreviousNeedsSettings] = useState(needsSettings)
  if (previousNeedsSettings !== needsSettings) {
    setPreviousNeedsSettings(needsSettings)
    if (!needsSettings) setSetupDismissed(false)
  }
  const showSetup = needsSettings && !setupDismissed

  // Grows the provider-setup panel to fit its content with no cap; the popover
  // caps the same shared logic because its floating panel has a max height.
  useStreamingHeight({
    elementRef: setupRef,
    visible: showSetup,
    targetVersion: snapshot,
    reducedMotion,
    onHeightChange: setSetupHeight,
  })

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
            <div className="dz-panel-history-content">
              <MessageList
                messages={snapshot.messages}
                mode="chat"
                reasoningEnabled={reasoningEnabled}
                showMeta
                latestAssistantId={latestAssistant?.id}
                onRetryMessage={() => onRetry()}
                smoothStreamingGrowth
                reducedMotion={reducedMotion}
                onStreamingHeightDelta={onStreamingHeightDelta}
              />
              {showSetup ? (
                <div
                  ref={setupRef}
                  className="dz-provider-setup-host"
                  style={{ height: setupHeight }}
                >
                  <ProviderSetup
                    provider={providerSettings}
                    onSave={(provider) =>
                      onSaveProvider(provider).then(() => setSetupDismissed(true))
                    }
                    onOpenSettings={onOpenSettings}
                  />
                </div>
              ) : state.error && !latestAssistant?.errorMessage ? (
                <div className="dz-error" role="alert">
                  <span>{state.error.message}</span>
                </div>
              ) : null}
            </div>
          </main>
          <footer className="dz-panel-composer">
            <Composer
              value={draft}
              disabled={!state.connected}
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
  const surfacesReported = useRef(false)
  const panelInstanceId = useRef<string | null>(null)
  const panelSessionId = useRef(requestId('panel-session'))
  const boundChannels = useRef(new Set<'command' | 'update'>())

  const command = useCallback(async (value: ConversationCommand) => {
    const result = await extensionConversationCommand.dispatch({
      panelSessionId: panelSessionId.current,
      command: value,
    })
    if (result.snapshot) dispatch({ type: 'conversation.sync', snapshot: result.snapshot })
    return result
  }, [])

  /** Applies a tool-shortcut response only when Background routed it to the panel. */
  const applyToolResult = useCallback((result: ToolShortcutResult) => {
    if (result.handled && result.target === 'sidePanel' && result.snapshot) {
      dispatch({ type: 'panel.render', snapshot: result.snapshot })
    }
  }, [])

  const reportSurface = useCallback((status: 'appeared' | 'destroyed', instanceId: string) => {
    void panelSurfaceStatus
      .dispatch({
        type: 'ui.surfaceStatus',
        requestId: requestId('surface'),
        payload: {
          origin: 'sidePanel',
          status,
          selectionSessionId: null,
          panelInstanceId: instanceId,
        },
      })
      .catch((error: unknown) =>
        logError(Scope.EXTENSION_PAGE, 'Panel surface status report failed.', error)
      )
  }, [])

  useEffect(() => {
    let disposed = false
    let cancelCommandHandle: (() => void) | undefined
    let cancelUpdateHandle: (() => void) | undefined

    void chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([tab]) => {
        if (disposed || !tab?.id || !tab.windowId) {
          logError(Scope.EXTENSION_PAGE, 'Side Panel could not bind its typed events.')
          return
        }
        const binding = { tabId: tab.id, windowId: tab.windowId }
        log(Scope.EXTENSION_PAGE, 'Side Panel binding typed events to active tab.', binding)
        const onStatus = (status: 'connecting' | 'bound' | 'disconnected') => {
          if (status === 'bound') return
          boundChannels.current.clear()
          dispatch({ type: 'panel.disconnected' })
        }
        const reportIfBound = () => {
          if (boundChannels.current.size !== 2 || surfacesReported.current) return
          surfacesReported.current = true
          reportSurface('appeared', panelSessionId.current)
        }
        const commandHandle = sidePanelCommand.handle(
          binding,
          async (commandValue) => {
            if (commandValue.type === 'session.ready') {
              if (commandValue.panelSessionId === panelSessionId.current) {
                dispatch({ type: 'panel.connected' })
              }
              return true
            }
            if (commandValue.type === 'render' || commandValue.type === 'selectTool') {
              dispatch({ type: 'panel.render', snapshot: commandValue.snapshot })
            } else {
              dispatch({ type: 'panel.clear' })
            }
            return true
          },
          {
            panelSessionId: panelSessionId.current,
            reconnect: true,
            onStatus: (status) => {
              onStatus(status)
              if (status === 'bound') {
                boundChannels.current.add('command')
                reportIfBound()
              }
            },
          }
        )
        cancelCommandHandle = commandHandle.cancel
        panelInstanceId.current = panelSessionId.current
        const updateHandle = sidePanelConversationUpdate.handle(
          binding,
          async (update) => {
            flushSync(() => dispatch(update))
            return true
          },
          {
            panelSessionId: panelSessionId.current,
            reconnect: true,
            onStatus: (status) => {
              onStatus(status)
              if (status === 'bound') boundChannels.current.add('update')
              if (status === 'bound') reportIfBound()
            },
          }
        )
        cancelUpdateHandle = updateHandle.cancel
      })
      .catch((error: unknown) =>
        logError(Scope.EXTENSION_PAGE, 'Side Panel typed event binding failed.', error)
      )

    return () => {
      disposed = true
      const instanceId = panelInstanceId.current
      if (surfacesReported.current && instanceId) reportSurface('destroyed', instanceId)
      surfacesReported.current = false
      panelInstanceId.current = null
      cancelCommandHandle?.()
      cancelUpdateHandle?.()
    }
  }, [reportSurface])

  const currentTool = state.snapshot?.activeToolId
  const draftKey = currentTool === undefined ? '' : String(currentTool)
  const draft = drafts[draftKey] ?? ''
  const withConversation = useCallback(
    (build: (id: number) => ConversationCommand) => {
      const id = state.snapshot?.conversation.id
      if (id && state.connected) {
        void command(build(id)).catch((error: unknown) => {
          dispatch({ type: 'view.error', error: errorShape(error) })
        })
      }
    },
    [command, state.connected, state.snapshot?.conversation.id]
  )
  const selectToolByIndex = useCallback(
    (index: number) => {
      const panelInstance = panelInstanceId.current
      if (!panelInstance || !state.connected) return
      void panelToolShortcut
        .dispatch({
          type: 'shortcut.tool',
          requestId: requestId('tool'),
          payload: {
            origin: 'sidePanel',
            panelInstanceId: panelInstance,
            action: 'select',
            value: index,
          },
        })
        .then(applyToolResult)
        .catch((error: unknown) => logError(Scope.EXTENSION_PAGE, 'Tool select failed.', error))
    },
    [applyToolResult, state.connected]
  )
  const cycleTool = useCallback(
    (direction: 'left' | 'right') => {
      const panelInstance = panelInstanceId.current
      if (!panelInstance || !state.connected) return
      void panelToolShortcut
        .dispatch({
          type: 'shortcut.tool',
          requestId: requestId('cycle'),
          payload: {
            origin: 'sidePanel',
            panelInstanceId: panelInstance,
            action: 'cycle',
            value: direction,
          },
        })
        .then(applyToolResult)
        .catch((error: unknown) => logError(Scope.EXTENSION_PAGE, 'Tool cycle failed.', error))
    },
    [applyToolResult, state.connected]
  )
  const saveProvider = useCallback(
    async (provider: ProviderSettings) => {
      const saved = await settingsCommand.dispatch({
        type: 'settings.save',
        requestId: requestId('settings'),
        settings: { ...settings, provider },
      })
      setSettings(saved)
    },
    [settings]
  )

  const onToolSelect = useCallback(
    (toolId: number) => {
      const index = state.snapshot?.tools.findIndex(({ tool }) => tool.id === toolId) ?? -1
      if (index >= 0) selectToolByIndex(index + 1)
    },
    [selectToolByIndex, state.snapshot]
  )

  useEffect(() => {
    void settingsCommand
      .dispatch({ type: 'settings.get', requestId: requestId('settings') })
      .then(setSettings)
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const toolNumber = toolShortcutNumber(event)
      // The configured close (Esc by default) and the dock toggle both tell
      // Background to close the panel directly from inside it — the content-script
      // half of the toggle cannot hear keys while focus lives in the Side Panel.
      if (
        matchesShortcut(event, settings.shortcuts.close) ||
        matchesShortcut(event, settings.shortcuts.dock)
      ) {
        event.preventDefault()
        log(Scope.EXTENSION_PAGE, 'Side Panel toggle shortcut received.', {
          shortcut: matchesShortcut(event, settings.shortcuts.dock) ? 'dock' : 'close',
          hasConversation: state.snapshot !== null,
        })
        const instanceId = panelInstanceId.current
        if (!instanceId || !state.connected) return
        void panelPanelToggle
          .dispatch({
            type: 'shortcut.panelToggle',
            requestId: requestId('panel'),
            payload: { origin: 'sidePanel', panelInstanceId: instanceId },
          })
          .then((result: PanelToggleResult) => {
            if (
              result.action === 'restore' &&
              result.currentUI === 'sidePanel' &&
              result.snapshot
            ) {
              dispatch({ type: 'panel.render', snapshot: result.snapshot })
            }
            log(Scope.EXTENSION_PAGE, 'Side Panel toggle completed.', {
              currentUI: result.currentUI,
              action: result.action,
            })
          })
          .catch((error: unknown) =>
            logError(Scope.EXTENSION_PAGE, 'Side Panel toggle failed.', error)
          )
      } else if (toolNumber !== null) {
        event.preventDefault()
        selectToolByIndex(toolNumber)
      } else if (event.ctrlKey && event.key === '.') {
        event.preventDefault()
        withConversation((conversationId) => ({
          type: 'stream.stop',
          requestId: requestId('stop'),
          payload: { conversationId },
        }))
      } else if (event.ctrlKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        event.preventDefault()
        cycleTool(event.key === 'ArrowLeft' ? 'left' : 'right')
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [cycleTool, selectToolByIndex, settings.shortcuts, state.snapshot, withConversation])

  return (
    <SidePanelView
      state={state}
      reasoningEnabled={settings.provider.reasoningEnabled}
      draft={draft}
      providerSettings={settings.provider}
      onDraftChange={(value) => setDrafts((current) => ({ ...current, [draftKey]: value }))}
      onToolSelect={onToolSelect}
      onSaveProvider={saveProvider}
      onSend={async () => {
        const content = draft.trim()
        const conversationId = state.snapshot?.conversation.id
        if (!content || !conversationId || !state.connected) return
        try {
          await command({
            type: 'conversation.followup',
            requestId: requestId('followup'),
            payload: { conversationId, content },
          })
          setDrafts((current) => ({ ...current, [draftKey]: '' }))
        } catch (error) {
          dispatch({ type: 'view.error', error: errorShape(error) })
        }
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

function errorShape(error: unknown): DianzhiErrorShape {
  if (error instanceof DianzhiError) return error.toJSON()
  return {
    code: 'SIDE_PANEL_SESSION_NOT_READY',
    message: error instanceof Error ? error.message : '点知请求失败。',
  }
}
