import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

export interface SQLiteRuntimeAsset {
  fileName: string
  source: string
}

export function sqliteRuntimeAssets(root: string): SQLiteRuntimeAsset[] {
  return [
    {
      fileName: 'assets/web-sqlite-opfs-proxy.js',
      source: readFileSync(resolve(root, 'src/vendor/web-sqlite/web-sqlite-opfs-proxy.js'), 'utf8'),
    },
  ]
}

export function sqliteRuntimeAssetsPlugin(root: string): Plugin {
  return {
    name: 'dianzhi-sqlite-runtime-assets',
    apply: 'build',
    buildStart() {
      for (const asset of sqliteRuntimeAssets(root)) {
        this.emitFile({ type: 'asset', ...asset })
      }
    },
  }
}
