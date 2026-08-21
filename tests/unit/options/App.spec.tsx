import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { dispatch } = vi.hoisted(() => ({
  dispatch: vi.fn(),
}))

vi.mock('@/events/config', () => ({
  settingsCommand: {
    dispatch,
  },
}))

vi.mock('@/options/tools/ToolsWorkspace', () => ({
  ToolsWorkspace: () => <div data-testid="tools-workspace-stub" />,
}))

vi.mock('@/options/about/About', () => ({
  About: () => <div data-testid="about-stub" />,
}))

vi.mock('@/options/guide/UsageGuide', () => ({
  UsageGuide: () => <div data-testid="guide-stub" />,
}))

import App from '@/options/App'
import { DEFAULT_SETTINGS, rowDataFromSettings } from '@/dianzhi/domain/settings'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

function setInputValue(input: HTMLInputElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')
  descriptor?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function installChrome() {
  ;(globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
    runtime: {
      getManifest: () => ({ version: '9.9.9' }),
    },
  }
}

async function renderApp() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root.render(<App />)
  })
  return host
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  installChrome()
  dispatch.mockImplementation(async (event: { type: string; settings?: unknown }) => {
    if (event.type === 'settings.get') return DEFAULT_SETTINGS
    if (event.type === 'settings.save') return { ...DEFAULT_SETTINGS, ...event.settings }
    if (event.type === 'settings.testProvider') return DEFAULT_SETTINGS
    return DEFAULT_SETTINGS
  })
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
  vi.useRealTimers()
})

describe('Options autosave', () => {
  it('autosaves provider edits without rendering the save button', async () => {
    const container = await renderApp()
    await act(async () => {
      await Promise.resolve()
    })

    expect(container.querySelector('footer.save-bar')).toBeNull()

    const input = container.querySelector<HTMLInputElement>('#provider\\.baseUrl')
    expect(input).not.toBeNull()

    await act(async () => {
      setInputValue(input!, 'https://example.com/v1')
      await Promise.resolve()
      vi.advanceTimersByTime(500)
      await Promise.resolve()
    })

    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'settings.save',
        settings: rowDataFromSettings({
          ...DEFAULT_SETTINGS,
          provider: { ...DEFAULT_SETTINGS.provider, baseUrl: 'https://example.com/v1' },
        }),
      })
    )
    expect(container.textContent).toContain('已保存')
  })

  it('groups provider configuration and keeps advanced request JSON collapsed', async () => {
    const container = await renderApp()
    await act(async () => {
      await Promise.resolve()
    })

    expect(container.querySelector('fieldset.provider-connection')).not.toBeNull()
    expect(container.querySelector('fieldset.provider-behavior')).not.toBeNull()
    const advanced = container.querySelector<HTMLDetailsElement>('details.provider-advanced')
    expect(advanced).not.toBeNull()
    expect(advanced?.open).toBe(false)
  })

  it('uses a persistent navigation rail and a separately scrollable content pane', async () => {
    const container = await renderApp()
    await act(async () => {
      await Promise.resolve()
    })

    expect(container.querySelector('aside.options-sidebar')).not.toBeNull()
    expect(container.querySelector('main.options-content')).not.toBeNull()
  })

  it('reveals reasoning strength only after reasoning is enabled', async () => {
    const container = await renderApp()
    await act(async () => {
      await Promise.resolve()
    })

    expect(
      Array.from(container.querySelectorAll('label')).some((label) =>
        label.textContent?.includes('推理强度')
      )
    ).toBe(false)

    const reasoningToggle = container.querySelector<HTMLInputElement>(
      '#provider\\.reasoningEnabled'
    )
    expect(reasoningToggle).not.toBeNull()
    await act(async () => {
      reasoningToggle!.click()
    })

    expect(
      Array.from(container.querySelectorAll('label')).some((label) =>
        label.textContent?.includes('推理强度')
      )
    ).toBe(true)
  })

  it('shows connection feedback beside the connection test action', async () => {
    const container = await renderApp()
    await act(async () => {
      await Promise.resolve()
    })

    const testButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '测试连接'
    )
    expect(testButton).toBeDefined()
    await act(async () => {
      testButton!.click()
      await Promise.resolve()
    })

    expect(
      container.querySelector('.provider-connection .connection-status')?.textContent
    ).toContain('连接成功')
  })
})
