import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '@/dianzhi/domain/settings'
import type { ConversationSnapshot } from '@/dianzhi/domain/protocol'

const contentSurfaceStatusDispatch = vi.fn()
const selectionRouteDispatch = vi.fn()
const contentPanelToggleDispatch = vi.fn()
const contentSelectToolShortcutDispatch = vi.fn()
const contentCycleToolShortcutDispatch = vi.fn()
const contentSettingsCommandDispatch = vi.fn()
const contentConversationCommandDispatch = vi.fn()
const contentUiCommandHandle = vi.fn()
const conversationUpdateToContentHandle = vi.fn()

vi.mock('@/events/config', () => ({
  contentSurfaceStatus: { dispatch: (...args: unknown[]) => contentSurfaceStatusDispatch(...args) },
  selectionRoute: { dispatch: (...args: unknown[]) => selectionRouteDispatch(...args) },
  contentPanelToggle: { dispatch: (...args: unknown[]) => contentPanelToggleDispatch(...args) },
  contentSelectToolShortcut: {
    dispatch: (...args: unknown[]) => contentSelectToolShortcutDispatch(...args),
  },
  contentCycleToolShortcut: {
    dispatch: (...args: unknown[]) => contentCycleToolShortcutDispatch(...args),
  },
  contentSettingsCommand: {
    dispatch: (...args: unknown[]) => contentSettingsCommandDispatch(...args),
  },
  contentConversationCommand: {
    dispatch: (...args: unknown[]) => contentConversationCommandDispatch(...args),
  },
  contentUiCommand: { handle: (...args: unknown[]) => contentUiCommandHandle(...args) },
  conversationUpdateToContent: {
    handle: (...args: unknown[]) => conversationUpdateToContentHandle(...args),
  },
}))

import App from '@/content/views/App'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

const at = new Date(2026, 2, 5, 14, 7).toISOString()

function snapshot(conversationId = 10): ConversationSnapshot {
  return {
    selectionSession: {
      id: conversationId,
      activeConversationId: conversationId,
      createdAt: at,
      updatedAt: at,
    },
    conversation: {
      id: conversationId,
      selectionSessionId: conversationId,
      selectionKey: conversationId,
      tabId: 9,
      toolId: 1,
      toolName: '词典',
      title: 'run',
      selectedText: 'run',
      contextText: 'run fast',
      promptSnapshot: 'Explain run',
      createdAt: at,
      updatedAt: at,
    },
    messages: [
      {
        id: 1,
        conversationId,
        sequence: 1,
        role: 'assistant',
        content: 'hello',
        reasoningContent: '',
        status: 'completed',
        errorCode: null,
        errorMessage: null,
        createdAt: at,
        updatedAt: at,
      },
    ],
    tools: [],
    activeToolId: 1,
  }
}

async function renderApp() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<App extensionHost={host!} />)
  })
}

beforeEach(() => {
  contentSurfaceStatusDispatch.mockReset()
  selectionRouteDispatch.mockReset()
  contentPanelToggleDispatch.mockReset()
  contentSelectToolShortcutDispatch.mockReset()
  contentCycleToolShortcutDispatch.mockReset()
  contentSettingsCommandDispatch.mockReset()
  contentConversationCommandDispatch.mockReset()
  contentUiCommandHandle.mockReset()
  conversationUpdateToContentHandle.mockReset()
  contentSettingsCommandDispatch.mockResolvedValue(DEFAULT_SETTINGS)
  contentSurfaceStatusDispatch.mockResolvedValue({
    currentUI: 'none',
    latestUI: 'contentScript',
    selectionSessionId: null,
  })
  selectionRouteDispatch.mockResolvedValue({ target: 'sidePanel', display: false, snapshot: null })
  contentPanelToggleDispatch.mockResolvedValue({
    currentUI: 'none',
    latestUI: 'contentScript',
    action: 'none',
    snapshot: null,
  })
  contentSelectToolShortcutDispatch.mockResolvedValue({
    handled: false,
    reason: 'NO_APPEARED_UI',
  })
  contentCycleToolShortcutDispatch.mockResolvedValue({
    handled: false,
    reason: 'NO_APPEARED_UI',
  })
  contentConversationCommandDispatch.mockResolvedValue({ snapshot: null })

  // jsdom lacks these window APIs used by the streaming-height/placement hooks.
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList)
  )
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn((cb: FrameRequestCallback) => {
      cb(0)
      return 0
    })
  )
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

/** Dispatches a captured-phase keyboard event on document. */
function pressKey(eventInit: KeyboardEventInit) {
  document.dispatchEvent(new KeyboardEvent('keydown', { ...eventInit, bubbles: true }))
}

describe('content session routing', () => {
  it('boots and reports content destroyed with a null session pointer', async () => {
    await renderApp()
    expect(contentSurfaceStatusDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ui.surfaceStatus',
        payload: { status: 'destroyed', selectionSessionId: null },
      })
    )
  })

  it('registers the Background destroy command handler', async () => {
    await renderApp()
    expect(contentUiCommandHandle).toHaveBeenCalledTimes(1)
  })

  it('does not route a selection on mount; routing is user-driven only', async () => {
    await renderApp()
    expect(selectionRouteDispatch).not.toHaveBeenCalled()
  })

  it('listens for stream updates through the existing channel', async () => {
    await renderApp()
    expect(conversationUpdateToContentHandle).toHaveBeenCalledTimes(1)
  })

  it('handles a destroy command by hiding content and reporting destroyed', async () => {
    await renderApp()
    const handler = contentUiCommandHandle.mock.calls[0][0] as (command: {
      type: string
    }) => Promise<void>
    await act(async () => {
      await handler({ type: 'destroy' })
    })
    expect(contentSurfaceStatusDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ui.surfaceStatus',
        payload: { status: 'destroyed', selectionSessionId: null },
      })
    )
  })

  it('restores a same-page session with a fallback placement via the toggle shortcut', async () => {
    const restorable = snapshot(10)
    contentPanelToggleDispatch.mockResolvedValue({
      currentUI: 'contentScript',
      latestUI: 'contentScript',
      action: 'restore',
      snapshot: restorable,
    })
    contentSurfaceStatusDispatch.mockResolvedValue({
      currentUI: 'contentScript',
      latestUI: 'contentScript',
      selectionSessionId: 10,
    })
    await renderApp()
    await act(async () => {
      pressKey({
        key: '[',
        code: 'BracketLeft',
        ctrlKey: true,
        shiftKey: false,
      })
      await Promise.resolve()
    })
    expect(contentPanelToggleDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'shortcut.panelToggle' })
    )
    expect(host?.querySelector('.dz-popover')).not.toBeNull()
    const popover = host?.querySelector<HTMLElement>('.dz-popover')
    expect(popover?.style.left).toBeTruthy()
    expect(popover?.style.top).toBeTruthy()
  })

  it('ignores tool shortcuts when Background reports no apparent UI', async () => {
    await renderApp()
    await act(async () => {
      pressKey({ key: '1', code: 'Digit1', ctrlKey: true, shiftKey: true })
      await Promise.resolve()
    })
    expect(contentSelectToolShortcutDispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'shortcut.selectTool' })
    )
    expect(host?.querySelector('.dz-popover')).toBeNull()
  })
})
