// @vitest-environment node
import { expect, it } from 'vitest'
import { DEFAULT_TOOLS } from '@/dianzhi/domain/settings'
import { createConversationStore } from '@/offscreen/database/store'
import { createNodeDatabase } from './sqlite-helper'

it('round-trips terminal estimated throughput', async () => {
  const { connection } = createNodeDatabase()
  const store = createConversationStore(connection, () => '2026-08-27T00:00:00.000Z')
  const created = await store.createSelection({
    tabId: 9,
    tool: DEFAULT_TOOLS[0],
    selectedText: 'run',
    contextText: 'run fast',
    promptSnapshot: 'Explain run',
  })
  const assistant = await store.appendAssistant(created.conversation.id)
  await (store.finalizeAssistant as (id: number, input: unknown) => Promise<unknown>)(
    assistant.id,
    {
      status: 'completed',
      content: 'hello',
      reasoningContent: '',
      estimatedThroughputTps: 65,
    }
  )

  const reloaded = await store.getConversation(created.conversation.id)
  expect(
    (reloaded?.messages.at(-1) as { estimatedThroughputTps?: number | null } | undefined)
      ?.estimatedThroughputTps
  ).toBe(65)
})
