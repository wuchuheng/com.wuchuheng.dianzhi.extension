// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { dianzhiManifest as manifest } from '../../../manifest.config'

describe('Dianzhi manifest security contract', () => {
  it('uses Chrome 141 native Side Panel and minimal permissions', () => {
    expect(manifest.minimum_chrome_version).toBe('141')
    expect(manifest.permissions).toEqual(['storage', 'offscreen', 'sidePanel'])
    expect(manifest.side_panel).toEqual({ default_path: 'src/sidepanel/index.html' })
  })

  it('enables packaged workers, WASM, and cross-origin isolation', () => {
    expect(manifest.content_security_policy).toEqual({
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; object-src 'self';",
    })
    expect(manifest.cross_origin_opener_policy).toEqual({ value: 'same-origin' })
    expect(manifest.cross_origin_embedder_policy).toEqual({ value: 'require-corp' })
  })
})
