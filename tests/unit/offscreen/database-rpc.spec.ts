import { describe, expect, it, vi } from 'vitest'
import { createDatabaseRpc } from '@/offscreen/database/rpc'
import type { ConfigStore } from '@/offscreen/database/config-store'
import type { ConversationStore } from '@/offscreen/database/store'

describe('database RPC rejection logging', () => {
  it('does not serialize selected text or provider credentials from rejected requests', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const rpc = createDatabaseRpc({
      conversation: {} as ConversationStore,
      config: {} as ConfigStore,
    })

    await expect(
      rpc({
        requestId: 'request-safe-log',
        operation: 'createSelectionSession',
        args: {
          tabId: 0,
          tool: {
            id: 1,
            name: 'Tool',
            builtin: true,
            enabled: true,
            isDefault: true,
            promptMode: 'custom',
            customPrompt: 'API_KEY_SENTINEL',
          },
          selectedText: 'SELECTED_TEXT_SENTINEL',
          contextText: 'CONTEXT_SENTINEL',
          promptSnapshot: 'PROMPT_SENTINEL',
        },
      })
    ).rejects.toMatchObject({ code: 'INVALID_EVENT' })

    const serialized = JSON.stringify(error.mock.calls)
    expect(serialized).toContain('request-safe-log')
    expect(serialized).not.toContain('SELECTED_TEXT_SENTINEL')
    expect(serialized).not.toContain('CONTEXT_SENTINEL')
    expect(serialized).not.toContain('PROMPT_SENTINEL')
    expect(serialized).not.toContain('API_KEY_SENTINEL')
  })
})
