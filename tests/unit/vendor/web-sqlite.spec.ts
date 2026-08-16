// @vitest-environment node

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { sqliteRuntimeAssets } from '../../../scripts/sqlite-runtime-assets.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const upstreamPath = resolve(root, 'node_modules/web-sqlite-js/dist/index.js')
const vendorRoot = resolve(root, 'src/vendor/web-sqlite')
const expectedHash = '97ab499174918ff700f17213c9493ad325af6c0cc7bf29c6eb1eae04789c4784'

const readText = (path: string) => readFile(path, 'utf8')
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

describe('CSP-safe web-sqlite vendor assets', () => {
  it('pins the exact package and upstream distribution hash', async () => {
    const packageJson = JSON.parse(await readText(resolve(root, 'package.json'))) as {
      dependencies: Record<string, string>
    }
    const upstream = await readText(upstreamPath)

    expect(packageJson.dependencies['web-sqlite-js']).toBe('2.3.0')
    expect(sha256(upstream)).toBe(expectedHash)
  })

  it('emits the main module, SQLite worker, OPFS proxy, and declaration', async () => {
    const [main, sqliteWorker, opfsProxy, declaration] = await Promise.all([
      readText(resolve(vendorRoot, 'index.js')),
      readText(resolve(vendorRoot, 'web-sqlite-worker.js')),
      readText(resolve(vendorRoot, 'web-sqlite-opfs-proxy.js')),
      readText(resolve(vendorRoot, 'index.d.ts')),
    ])

    expect(main).toContain('web-sqlite-worker.js')
    expect(sqliteWorker).toContain('web-sqlite-opfs-proxy.js')
    expect(opfsProxy.length).toBeGreaterThan(100)
    expect(declaration).toContain('declare const openDB:')
    expect(declaration).toContain('export default openDB')
  })

  it('contains no remote, Blob, or data URL worker factories in any executable asset', async () => {
    const assets = await Promise.all([
      readText(resolve(vendorRoot, 'index.js')),
      readText(resolve(vendorRoot, 'web-sqlite-worker.js')),
      readText(resolve(vendorRoot, 'web-sqlite-opfs-proxy.js')),
    ])
    const executable = assets.join('\n')

    expect(executable).not.toMatch(/createObjectURL\s*\(\s*new Blob/)
    expect(executable).not.toMatch(/data:text\/javascript/)
    expect(executable).not.toMatch(
      /(?:importScripts|new\s+Worker)\s*\(\s*(?:new URL\(\s*)?['"]https?:\/\//
    )
  })

  it('wires the offscreen entry to the local adapter rather than the npm runtime bundle', async () => {
    const offscreenEntry = await readText(resolve(root, 'src/offscreen/main.ts'))

    expect(offscreenEntry).toContain("from '@/vendor/web-sqlite'")
    expect(offscreenEntry).not.toContain("from 'web-sqlite-js'")
  })

  it('publishes the nested OPFS proxy beside Vite emitted worker assets', async () => {
    const assets = sqliteRuntimeAssets(root)

    expect(assets).toHaveLength(1)
    expect(assets[0]?.fileName).toBe('assets/web-sqlite-opfs-proxy.js')
    expect(assets[0]?.source).toBe(await readText(resolve(vendorRoot, 'web-sqlite-opfs-proxy.js')))
  })
})
