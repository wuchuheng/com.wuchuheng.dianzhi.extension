// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { createOffscreenClient } from '../../../src/background/offscreen-client'

function chromeApi(contexts: unknown[] = []) {
  return {
    runtime: {
      getURL: vi.fn((path: string) => `chrome-extension://id/${path}`),
      getContexts: vi.fn(async () => contexts),
    },
    offscreen: { createDocument: vi.fn(async () => undefined) },
  }
}

describe('background offscreen client', () => {
  it('creates one offscreen document for concurrent requests', async () => {
    const api = chromeApi()
    const dispatch = vi.fn(async () => null)
    const client = createOffscreenClient(
      api as never,
      undefined,
      dispatch as never,
      vi.fn(async () => true)
    )

    await Promise.all([client.ensureDocument(), client.ensureDocument(), client.ensureDocument()])

    expect(api.runtime.getContexts).toHaveBeenCalledTimes(1)
    expect(api.offscreen.createDocument).toHaveBeenCalledTimes(1)
    expect(api.offscreen.createDocument).toHaveBeenCalledWith({
      url: 'chrome-extension://id/src/offscreen/index.html',
      reasons: ['WORKERS'],
      justification: expect.stringContaining('SQLite'),
    })
  })

  it('reuses an existing offscreen context', async () => {
    const api = chromeApi([{}])
    const client = createOffscreenClient(
      api as never,
      undefined,
      vi.fn() as never,
      vi.fn(async () => true)
    )

    await client.ensureDocument()

    expect(api.offscreen.createDocument).not.toHaveBeenCalled()
  })

  it('retries one idempotent read but never replays a failed mutation', async () => {
    const api = chromeApi([{}])
    const dispatch = vi.fn().mockRejectedValueOnce(new Error('waking')).mockResolvedValueOnce(null)
    const client = createOffscreenClient(
      api as never,
      undefined,
      dispatch as never,
      vi.fn(async () => true)
    )

    await expect(client.request('getConversation', { id: 7 })).resolves.toBeNull()
    expect(dispatch).toHaveBeenCalledTimes(2)

    dispatch.mockClear()
    dispatch.mockRejectedValue(new Error('write failed'))
    await expect(
      client.request('deleteSelection', { tabId: 1, selectionKey: 7 })
    ).rejects.toMatchObject({ code: 'DB_UNAVAILABLE' })
    expect(dispatch).toHaveBeenCalledTimes(1)
  })
})
