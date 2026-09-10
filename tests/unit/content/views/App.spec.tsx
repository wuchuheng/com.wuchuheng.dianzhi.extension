import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentApp } from '@/content/views/App'
import type { ConversationViewState } from '@/dianzhi/conversation/reducer'
import { DEFAULT_SETTINGS } from '@/dianzhi/domain/settings'
import type { Placement } from '@/content/popover/placement'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

const placement: Placement = {
  x: 10,
  y: 20,
  width: 320,
  arrowX: 24,
  direction: 'below',
}

function visibleState(): ConversationViewState {
  const at = new Date(2026, 2, 5, 14, 7).toISOString()
  return {
    visible: true,
    mode: 'card',
    expanded: false,
    error: null,
    snapshot: {
      conversation: {
        id: 1,
        tabId: 1,
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
          conversationId: 1,
          sequence: 1,
          role: 'assistant',
          content: '**hello** world',
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
    },
  }
}

async function render(onOpenSettings = vi.fn(), bodyScrollable = false, state = visibleState()) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(
      <ContentApp
        state={state}
        placement={placement}
        reasoningEnabled={false}
        shortcuts={DEFAULT_SETTINGS.shortcuts}
        onToolSelect={() => undefined}
        onModeChange={() => undefined}
        onExpand={() => undefined}
        onClose={() => undefined}
        onDock={() => undefined}
        onSend={() => undefined}
        onStop={() => undefined}
        onRetry={() => undefined}
        onOpenSettings={onOpenSettings}
        providerSettings={DEFAULT_SETTINGS.provider}
        onSaveProvider={async () => undefined}
        bodyScrollable={bodyScrollable}
      />
    )
  })
  return onOpenSettings
}

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  })
})

afterEach(() => {
  vi.clearAllMocks()
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

describe('ContentApp title actions', () => {
  it('copies the visible assistant reply as plain text from the title bar', async () => {
    await render()
    expect(host?.querySelector('.dz-message-meta')).toBeNull()
    await act(async () => {
      host?.querySelector<HTMLButtonElement>('[aria-label="复制纯文本"]')?.click()
    })
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello world')
  })

  it('does not render a settings button in the normal content popover', async () => {
    await render()
    expect(host?.querySelector('[aria-label="打开设置"]')).toBeNull()
  })

  it('only enables message-body scrolling when the panel is at its height cap', async () => {
    await render()
    expect(host?.querySelector('.dz-body')?.classList.contains('is-scrollable')).toBe(false)

    await act(async () => {
      root?.render(
        <ContentApp
          state={visibleState()}
          placement={placement}
          reasoningEnabled={false}
          shortcuts={DEFAULT_SETTINGS.shortcuts}
          onToolSelect={() => undefined}
          onModeChange={() => undefined}
          onExpand={() => undefined}
          onClose={() => undefined}
          onDock={() => undefined}
          onSend={() => undefined}
          onStop={() => undefined}
          onRetry={() => undefined}
          onOpenSettings={() => undefined}
          providerSettings={DEFAULT_SETTINGS.provider}
          onSaveProvider={async () => undefined}
          bodyScrollable={true}
        />
      )
    })
    expect(host?.querySelector('.dz-body')?.classList.contains('is-scrollable')).toBe(true)
  })
})

describe('ContentApp selection-origin motion', () => {
  it('keeps a closing popover mounted with its selection-origin transform', async () => {
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(
        <ContentApp
          state={{ ...visibleState(), visible: false }}
          placement={placement}
          panelHeight={280}
          motionPhase="closing"
          motionStyle={{
            '--dz-motion-x': '-120px',
            '--dz-motion-y': '-80px',
            '--dz-motion-scale-x': '0.25',
            '--dz-motion-scale-y': '0.07',
          }}
          reasoningEnabled={false}
          shortcuts={DEFAULT_SETTINGS.shortcuts}
          onToolSelect={() => undefined}
          onModeChange={() => undefined}
          onExpand={() => undefined}
          onClose={() => undefined}
          onDock={() => undefined}
          onSend={() => undefined}
          onStop={() => undefined}
          onRetry={() => undefined}
          onOpenSettings={() => undefined}
          providerSettings={DEFAULT_SETTINGS.provider}
          onSaveProvider={async () => undefined}
        />
      )
    })

    const layer = host.querySelector<HTMLElement>('.dz-layer')
    const popover = host.querySelector<HTMLElement>('.dz-popover')
    expect(layer?.dataset.motionPhase).toBe('closing')
    expect(popover?.style.getPropertyValue('--dz-motion-x')).toBe('-120px')
    expect(popover?.style.getPropertyValue('--dz-motion-scale-y')).toBe('0.07')
  })
})

describe('ContentApp composer while streaming', () => {
  it('keeps the chat input editable while a reply is streaming', async () => {
    const streamingState: ConversationViewState = {
      ...visibleState(),
      mode: 'chat',
      snapshot: {
        ...visibleState().snapshot!,
        messages: [
          {
            ...visibleState().snapshot!.messages[0],
            status: 'streaming',
          },
        ],
      },
    }
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(
        <ContentApp
          state={streamingState}
          placement={placement}
          reasoningEnabled={false}
          shortcuts={DEFAULT_SETTINGS.shortcuts}
          onToolSelect={() => undefined}
          onModeChange={() => undefined}
          onExpand={() => undefined}
          onClose={() => undefined}
          onDock={() => undefined}
          onSend={() => undefined}
          onStop={() => undefined}
          onRetry={() => undefined}
          onOpenSettings={() => undefined}
          providerSettings={DEFAULT_SETTINGS.provider}
          onSaveProvider={async () => undefined}
        />
      )
    })
    const textarea = host?.querySelector<HTMLTextAreaElement>('textarea')
    expect(textarea).not.toBeNull()
    expect(textarea?.disabled).toBe(false)
  })
})

describe('ContentApp provider setup', () => {
  it('renders the inline setup panel instead of the banner when unconfigured', async () => {
    const unconfigured = visibleState()
    unconfigured.error = { code: 'PROVIDER_NOT_CONFIGURED', message: 'provider missing' }
    const onSaveProvider = vi.fn().mockResolvedValue(undefined)
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    await act(async () => {
      root.render(
        <ContentApp
          state={unconfigured}
          placement={placement}
          reasoningEnabled={false}
          shortcuts={DEFAULT_SETTINGS.shortcuts}
          onToolSelect={() => undefined}
          onModeChange={() => undefined}
          onExpand={() => undefined}
          onClose={() => undefined}
          onDock={() => undefined}
          onSend={() => undefined}
          onStop={() => undefined}
          onRetry={() => undefined}
          onOpenSettings={() => undefined}
          providerSettings={DEFAULT_SETTINGS.provider}
          onSaveProvider={onSaveProvider}
        />
      )
    })
    expect(host?.querySelector('.dz-provider-setup')).not.toBeNull()
    expect(host?.querySelector('.dz-error')).toBeNull()

    await act(async () => {
      host
        ?.querySelector<HTMLFormElement>('.dz-provider-setup')
        ?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    })
    expect(onSaveProvider).toHaveBeenCalledTimes(1)
    // Dismissed after a successful save.
    expect(host?.querySelector('.dz-provider-setup')).toBeNull()
  })
})

it('shows routing failure without the understanding placeholder', async () => {
  await render(vi.fn(), false, {
    ...visibleState(),
    snapshot: null,
    error: {
      code: 'UI_SESSION_STALE',
      message: 'The tab session changed before the UI operation completed.',
    },
  })
  expect(host?.querySelector('[role="alert"]')?.textContent).toContain('The tab session changed')
  expect(host?.textContent).not.toContain('正在理解所选内容')
})
