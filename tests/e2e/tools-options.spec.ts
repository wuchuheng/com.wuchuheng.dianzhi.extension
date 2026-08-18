import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { chromium, expect, test, type BrowserContext } from '@playwright/test'
import { startMockProvider } from './support/mock-provider'

const extensionPath = resolve('dist')

async function extensionId(context: BrowserContext): Promise<string> {
  let worker = context.serviceWorkers()[0]
  if (!worker) worker = await context.waitForEvent('serviceworker')
  return new URL(worker.url()).host
}

test('runs a live tool test from the three-pane workspace without persisting', async () => {
  const profile = await mkdtemp(join(tmpdir(), 'dianzhi-tools-options-'))
  const provider = await startMockProvider()
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH ?? '/snap/bin/chromium',
    headless: true,
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  })
  try {
    const id = await extensionId(context)
    // Seed the mock provider BEFORE Options loads so the workspace draft uses it.
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

    const options = await context.newPage()
    const consoleErrors: string[] = []
    options.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    await options.goto(`chrome-extension://${id}/src/options/index.html`)
    await options.getByRole('button', { name: '查询工具' }).click()

    // Three-pane workspace is present.
    await expect(options.getByRole('heading', { name: '查询工具' })).toBeVisible()
    await expect(options.getByText('共 3 个工具')).toBeVisible()
    await expect(options.getByRole('heading', { name: '工具配置' })).toBeVisible()
    await expect(options.getByRole('heading', { name: '实时测试' })).toBeVisible()

    // Live test streams reasoning and answer from the mock provider.
    await options.getByLabel('选择词').fill('serendipity')
    await options.getByLabel('上下文').fill('Chance meetings and happy accidents.')
    await options.getByRole('button', { name: '运行测试' }).click()
    await expect(options.getByText('Mock answer from Dianzhi.')).toBeVisible({ timeout: 20_000 })
    await expect(options.getByText('Brief reasoning.')).toBeVisible()
    await expect(options.getByText('已完成')).toBeVisible()

    // The tool test must not create any tab conversation state.
    await expect
      .poll(async () => {
        const stored = await context.serviceWorkers()[0]!.evaluate(async () => {
          const value = await chrome.storage.session.get('dianzhi.tab-conversations')
          return Object.keys(value['dianzhi.tab-conversations'] ?? {}).length
        })
        return JSON.stringify({ conversations: stored, consoleErrors })
      })
      .toContain('"conversations":0')
    expect(consoleErrors).toEqual([])
  } finally {
    await context.close()
    await new Promise<void>((resolve) => provider.server.close(() => resolve()))
    await rm(profile, { recursive: true, force: true })
  }
})
