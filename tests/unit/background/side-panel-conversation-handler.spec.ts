import { describe, expect, it, vi } from 'vitest'
import { createSidePanelConversationHandler } from '@/background/side-panel-conversation-handler'

const request = {
  panelSessionId: 'panel-session-19',
  command: {
    type: 'conversation.followup' as const,
    requestId: 'followup-1',
    payload: { conversationId: 22, content: 'Why?' },
  },
}

describe('Side Panel conversation admission', () => {
  it('waits for runtime restoration and a ready session, then authorizes its current tab', async () => {
    let restore!: () => void
    const runtimeReady = new Promise<void>((resolve) => {
      restore = resolve
    })
    const manager = { handle: vi.fn(async () => ({ accepted: true as const, snapshot: null })) }
    const panelSessions = {
      waitUntilReady: vi.fn(async () => ({
        panelSessionId: request.panelSessionId,
        tabId: 9,
        windowId: 19,
        generation: 2,
      })),
    }
    const handle = createSidePanelConversationHandler({ runtimeReady, panelSessions, manager })

    const pending = handle(request, {} as chrome.runtime.MessageSender)
    await Promise.resolve()
    expect(panelSessions.waitUntilReady).not.toHaveBeenCalled()
    expect(manager.handle).not.toHaveBeenCalled()

    restore()
    await expect(pending).resolves.toMatchObject({ accepted: true })
    expect(panelSessions.waitUntilReady).toHaveBeenCalledWith(request.panelSessionId)
    expect(manager.handle).toHaveBeenCalledWith(request.command, {}, 'extension', 9)
  })

  it('does not call the manager when the logical session is not ready', async () => {
    const manager = { handle: vi.fn() }
    const panelSessions = {
      waitUntilReady: vi.fn(async () => {
        throw new Error('not ready')
      }),
    }
    const handle = createSidePanelConversationHandler({
      runtimeReady: Promise.resolve(),
      panelSessions,
      manager,
    })

    await expect(handle(request, {} as chrome.runtime.MessageSender)).rejects.toThrow('not ready')
    expect(manager.handle).not.toHaveBeenCalled()
  })
})
