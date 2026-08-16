// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'
import { createDatabaseRpc } from '../../../src/offscreen/database/rpc'

describe('offscreen database RPC', () => {
  it('dispatches only named operations and caches successful mutation responses by request ID', async () => {
    const store = {
      createSelection: vi.fn(async () => ({ conversation: { id: 1 }, messages: [] })),
      getConversation: vi.fn(async () => null),
    }
    const handle = createDatabaseRpc(store as never)
    const request = {
      requestId: 'request-1',
      operation: 'createSelection' as const,
      args: {
        tabId: 7,
        tool: {
          id: 'context',
          name: '上下文',
          builtin: true,
          enabled: true,
          promptMode: 'preset',
          customPrompt: '',
        },
        selectedText: 'word',
        contextText: '<selected>word</selected>',
        promptSnapshot: 'prompt',
      },
    }

    const first = await handle(request)
    const second = await handle(request)

    expect(first).toEqual(second)
    expect(store.createSelection).toHaveBeenCalledTimes(1)
    await expect(
      handle({ requestId: 'bad', operation: 'executeSql', args: {} } as never)
    ).rejects.toMatchObject({ code: 'INVALID_EVENT' })
  })

  it('does not cache idempotent reads', async () => {
    const store = { getConversation: vi.fn(async () => null) }
    const handle = createDatabaseRpc(store as never)
    const request = { requestId: 'read-1', operation: 'getConversation' as const, args: { id: 9 } }

    await handle(request)
    await handle(request)

    expect(store.getConversation).toHaveBeenCalledTimes(2)
  })
})
