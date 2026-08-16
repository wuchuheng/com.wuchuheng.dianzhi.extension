import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, expect, test, type BrowserContext, type Worker } from '@playwright/test'
import { startMockProvider } from './support/mock-provider'

const extensionPath = resolve('dist')

async function extensionId(context: BrowserContext): Promise<string> {
  let worker = context.serviceWorkers()[0]
  if (!worker) worker = await context.waitForEvent('serviceworker')
  return new URL(worker.url()).host
}

test('runs the built extension selection and provider flow', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'dianzhi-e2e-'))
  const provider = await startMockProvider()
  const consoleErrors: string[] = []
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH ?? '/snap/bin/chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })
  try {
    const observeWorker = (worker: Worker) => {
      worker.on('console', (message) => {
        if (message.type() === 'error') consoleErrors.push(`worker: ${message.text()}`)
      })
    }
    context.on('serviceworker', observeWorker)
    context.serviceWorkers().forEach(observeWorker)
    const id = await extensionId(context)
    const options = await context.newPage()
    options.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await options.goto(`chrome-extension://${id}/src/options/index.html`)
    await expect(options.getByRole('heading', { name: 'AI 服务' })).toBeVisible()

    await context.serviceWorkers()[0]!.evaluate(
      async ({ baseUrl }) => {
        const stored = await chrome.storage.sync.get('dianzhi.settings')
        await chrome.storage.sync.set({
          'dianzhi.settings': {
            ...(stored['dianzhi.settings'] ?? {}),
            provider: {
              baseUrl,
              apiKey: 'e2e-key',
              model: 'mock-model',
              temperature: 0.2,
              reasoningEnabled: true,
              reasoningEffort: 'medium',
              thinkingParam: '',
              extraBody: '',
            },
          },
        })
      },
      { baseUrl: provider.baseUrl }
    )
    const fetchProbe = await context.serviceWorkers()[0]!.evaluate(async (url) => {
      try {
        const response = await fetch(`${url}/chat/completions`, { method: 'POST' })
        return { ok: response.ok, body: await response.text() }
      } catch (error) {
        return { ok: false, body: error instanceof Error ? error.message : String(error) }
      }
    }, provider.baseUrl)
    expect(fetchProbe.ok, fetchProbe.body).toBe(true)
    const reader = await context.newPage()
    reader.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    const fixture = await readFile(resolve('tests/e2e/fixtures/reader.html'), 'utf8')
    await reader.route('https://reader.dianzhi.test/**', (route) =>
      route.fulfill({ status: 200, contentType: 'text/html', body: fixture })
    )
    await reader.goto('https://reader.dianzhi.test/article')
    await reader.waitForFunction(() => Boolean(document.querySelector('#dianzhi-root')?.shadowRoot))
    await reader.waitForTimeout(300)
    await reader.evaluate(() => {
      const text = document.querySelector('#reading')!.firstChild!
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, 18)
      const selection = window.getSelection()!
      selection.removeAllRanges()
      selection.addRange(range)
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
    })
    await expect(reader.getByText('正在生成')).toBeVisible({ timeout: 20_000 })
    await reader.keyboard.press('Control+ArrowRight')
    await expect(reader.getByRole('tab', { name: /同义词/ })).toHaveAttribute(
      'aria-selected',
      'true'
    )
    await expect(reader.getByText('正在生成')).toBeVisible()
    await reader.getByRole('button', { name: '在侧边栏继续' }).click()
    await expect
      .poll(async () => {
        const panelOpen = await context.serviceWorkers()[0]!.evaluate(async () => {
          const stored = await chrome.storage.session.get('dianzhi.tab-conversations')
          return Object.values(
            (stored['dianzhi.tab-conversations'] ?? {}) as Record<string, { panelOpen?: boolean }>
          ).some((state) => state.panelOpen)
        })
        const popover = await reader.evaluate(
          () =>
            document.querySelector('#dianzhi-root')?.shadowRoot?.querySelector('.dz-popover')
              ?.textContent ?? ''
        )
        return JSON.stringify({ panelOpen, popover, consoleErrors })
      })
      .toContain('"panelOpen":true')
    await expect
      .poll(() =>
        context.serviceWorkers()[0]!.evaluate(async () => {
          const contexts = await chrome.runtime.getContexts({
            contextTypes: ['SIDE_PANEL' as chrome.runtime.ContextType],
          })
          return contexts.length
        })
      )
      .toBe(1)
    await expect(reader.getByRole('dialog', { name: '点知查询' })).toHaveCount(0)
    await expect
      .poll(
        () =>
          context.serviceWorkers()[0]!.evaluate(async () => {
            const stored = await chrome.storage.session.get('dianzhi.tab-conversations')
            const state = Object.values(
              (stored['dianzhi.tab-conversations'] ?? {}) as Record<
                string,
                { activeConversationId?: number }
              >
            )[0]
            if (!state?.activeConversationId) return null
            const response = await chrome.runtime.sendMessage({
              event: 'bg2ep:dianzhi:database-request',
              args: {
                requestId: `e2e-read-${state.activeConversationId}`,
                operation: 'getConversation',
                args: { id: state.activeConversationId },
              },
            })
            if (!response?.success)
              throw new Error(response?.error?.message ?? 'Database read failed')
            const messages = response.data?.messages ?? []
            const assistant = [...messages]
              .reverse()
              .find((message) => message.role === 'assistant')
            return assistant
              ? { status: assistant.status, content: assistant.content, panelOpen: true }
              : null
          }),
        { timeout: 20_000 }
      )
      .toEqual({ status: 'completed', content: 'Mock answer from Dianzhi.', panelOpen: true })
    expect(consoleErrors).toEqual([])
  } finally {
    await context.close()
    await new Promise<void>((resolve) => provider.server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})
