// @vitest-environment node
import { expect, it } from 'vitest'
import { DEFAULT_TOOLS } from '@/dianzhi/domain/settings'
import { createConversationStore } from '@/offscreen/database/store'
import { createNodeDatabase } from './sqlite-helper'

function selectionInput(toolIndex: number) {
  return {
    tabId: 9,
    tool: DEFAULT_TOOLS[toolIndex],
    selectedText: 'run',
    contextText: 'run fast',
    promptSnapshot: 'Explain run',
  }
}

it('round-trips terminal estimated throughput', async () => {
  const { connection } = createNodeDatabase()
  const store = createConversationStore(connection, () => '2026-08-27T00:00:00.000Z')
  const created = await store.createSelectionSession(selectionInput(0))
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

it('restores every used tool and the persisted active conversation', async () => {
  const { connection } = createNodeDatabase()
  const store = createConversationStore(connection, () => '2026-08-27T00:00:00.000Z')
  const created = await store.createSelectionSession(selectionInput(0))
  const second = await store.ensureToolConversation({
    selectionSessionId: created.selectionSession.id,
    tool: DEFAULT_TOOLS[1],
    promptSnapshot: 'Translate run',
  })
  await store.setActiveConversation(created.selectionSession.id, second.conversation.id)

  const restored = await store.getSelectionSession(created.selectionSession.id)
  expect(restored?.selectionSession.activeConversationId).toBe(second.conversation.id)
  expect(restored?.conversations.map((row) => row.toolId)).toEqual([1, 2])
})

it('rejects an active conversation from another session', async () => {
  const { connection } = createNodeDatabase()
  const store = createConversationStore(connection, () => '2026-08-27T00:00:00.000Z')
  const first = await store.createSelectionSession(selectionInput(0))
  const second = await store.createSelectionSession(selectionInput(1))

  await expect(
    store.setActiveConversation(first.selectionSession.id, second.conversation.id)
  ).rejects.toMatchObject({ code: 'INVALID_EVENT' })
})

it('repairs a nullable active pointer before restoring a selection session', async () => {
  const { connection, db } = createNodeDatabase()
  const store = createConversationStore(connection, () => '2026-08-27T00:00:00.000Z')
  const created = await store.createSelectionSession(selectionInput(0))
  db.prepare('UPDATE selection_sessions SET active_conversation_id = NULL WHERE id = ?').run(
    created.selectionSession.id
  )

  const restored = await store.getSelectionSession(created.selectionSession.id)

  expect(restored?.selectionSession.activeConversationId).toBe(created.conversation.id)
  expect(
    db.prepare('SELECT active_conversation_id FROM selection_sessions WHERE id = ?')
      .get(created.selectionSession.id)
  ).toEqual({ active_conversation_id: created.conversation.id })
})

it('deletes selected sessions and session orphans without affecting retained sessions', async () => {
  const { connection } = createNodeDatabase()
  const store = createConversationStore(connection, () => '2026-08-27T00:00:00.000Z')
  const first = await store.createSelectionSession(selectionInput(0))
  const second = await store.createSelectionSession(selectionInput(1))
  const third = await store.createSelectionSession(selectionInput(0))

  await store.deleteSelectionSession(first.selectionSession.id)
  await store.deleteOrphanSelectionSessions([second.selectionSession.id])

  await expect(store.getSelectionSession(first.selectionSession.id)).resolves.toBeNull()
  await expect(store.getSelectionSession(second.selectionSession.id)).resolves.toMatchObject({
    selectionSession: { id: second.selectionSession.id },
  })
  await expect(store.getSelectionSession(third.selectionSession.id)).resolves.toBeNull()
})
