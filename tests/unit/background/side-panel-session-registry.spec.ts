import { describe, expect, it, vi } from 'vitest'
import { createSidePanelSessionRegistry } from '@/background/side-panel-session-registry'

const binding = { tabId: 9, windowId: 19 }

describe('SidePanelSessionRegistry', () => {
  it('joins both channels and becomes ready only after current-generation synchronization', async () => {
    const registry = createSidePanelSessionRegistry()
    const changes = vi.fn()
    registry.observe(changes)

    registry.apply('command', {
      type: 'bound',
      panelSessionId: 'panel-19',
      binding,
    })
    expect(registry.beginSynchronization('panel-19', binding)).toBeNull()

    registry.apply('update', { type: 'bound', panelSessionId: 'panel-19', binding })
    expect(changes).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'channels-ready', panelSessionId: 'panel-19' })
    )
    const session = registry.beginSynchronization('panel-19', { tabId: 10, windowId: 19 })
    expect(session).toMatchObject({ tabId: 10, windowId: 19, generation: 0 })
    expect(registry.readyBinding('panel-19')).toBeNull()
    expect(registry.completeSynchronization('panel-19', session!.generation)).toBe(true)
    await expect(registry.waitUntilReady('panel-19')).resolves.toMatchObject({ tabId: 10 })
  })

  it('invalidates stale synchronization and emits channel-specific disconnects', () => {
    const registry = createSidePanelSessionRegistry()
    const changes = vi.fn()
    registry.observe(changes)
    registry.apply('command', { type: 'bound', panelSessionId: 'panel-19', binding })
    registry.apply('update', { type: 'bound', panelSessionId: 'panel-19', binding })
    const session = registry.beginSynchronization('panel-19', binding)!
    registry.apply('update', { type: 'disconnected', panelSessionId: 'panel-19', binding })

    expect(changes).toHaveBeenLastCalledWith({
      type: 'update-disconnected',
      panelSessionId: 'panel-19',
      windowId: 19,
      generation: 1,
    })
    expect(registry.completeSynchronization('panel-19', session.generation)).toBe(false)
    expect(registry.readyBinding('panel-19')).toBeNull()
  })

  it('keeps an update stream non-ready for commands when only the command channel disconnects', () => {
    const registry = createSidePanelSessionRegistry()
    registry.apply('command', { type: 'bound', panelSessionId: 'panel-19', binding })
    registry.apply('update', { type: 'bound', panelSessionId: 'panel-19', binding })
    const session = registry.beginSynchronization('panel-19', binding)!
    registry.completeSynchronization('panel-19', session.generation)

    registry.apply('command', { type: 'disconnected', panelSessionId: 'panel-19', binding })

    expect(registry.readyBinding('panel-19')).toBeNull()
  })

  it('never joins one session identity across mismatched bindings', () => {
    const registry = createSidePanelSessionRegistry()
    registry.apply('command', { type: 'bound', panelSessionId: 'panel-19', binding })
    registry.apply('update', {
      type: 'bound',
      panelSessionId: 'panel-19',
      binding: { tabId: 9, windowId: 20 },
    })

    expect(registry.beginSynchronization('panel-19', binding)).toBeNull()
  })

  it('removes only sessions from the closed window and rejects their waiters', async () => {
    const registry = createSidePanelSessionRegistry()
    registry.apply('command', { type: 'bound', panelSessionId: 'panel-19', binding })
    registry.apply('update', { type: 'bound', panelSessionId: 'panel-19', binding })
    const waiting = registry.waitUntilReady('panel-19')

    registry.removeWindow(19)

    await expect(waiting).rejects.toMatchObject({ code: 'SIDE_PANEL_SESSION_NOT_READY' })
    expect(registry.sessionsForWindow(19)).toEqual([])
  })
})
