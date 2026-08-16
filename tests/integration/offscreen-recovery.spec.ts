// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { createOffscreenClient } from '../../src/background/offscreen-client'

describe('offscreen recovery integration', () => {
  it('creates one document and retries an idempotent conversation read after context loss', async () => {
    let hasContext = false
    const createDocument = vi.fn(async () => {
      hasContext = true
    })
    const chromeApi = {
      runtime: {
        getURL: (path: string) => `chrome-extension://id/${path}`,
        getContexts: vi.fn(async () => (hasContext ? [{}] : [])),
      },
      offscreen: { createDocument },
    }
    let attempts = 0
    const client = createOffscreenClient(
      chromeApi as never,
      { setTimeout, clearTimeout },
      vi.fn(async () => {
        attempts += 1
        if (attempts === 1) throw new Error('offscreen context closed')
        return null
      }) as never,
      vi.fn(async () => true)
    )

    await expect(client.request('getConversation', { id: 9 })).resolves.toBeNull()
    expect(attempts).toBe(2)
    expect(createDocument).toHaveBeenCalledTimes(1)
  })
})
