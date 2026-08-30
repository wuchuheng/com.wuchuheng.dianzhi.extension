import { chromium } from '@playwright/test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'design-assets/chrome-store-posters.html')
const browser = await chromium.launch({ headless: true })

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
  })
  await page.goto(pathToFileURL(source).href, { waitUntil: 'load' })
  await page.evaluate(() => document.fonts.ready)

  for (const poster of await page.locator('.poster').all()) {
    const filename = await poster.getAttribute('data-file')
    if (!filename) throw new Error('Poster is missing data-file')
    await poster.screenshot({ path: path.join(root, 'public', filename), type: 'png' })
  }
} finally {
  await browser.close()
}
