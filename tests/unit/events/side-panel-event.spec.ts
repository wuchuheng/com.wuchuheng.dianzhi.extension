import { describe, expect, it, vi } from 'vitest'
import { bg2sp } from '@/events/sidePanel/sidePanel'
import type { SidePanelCommand } from '@/dianzhi/domain/ui-session-protocol'

type Listener<T> = {
  addListener(listener: (message: T) => void): void
  removeListener(listener: (message: T) => void): void
}

function listener<T>() {
  const listeners = new Set<(message: T) => void>()
  return {
    api: {
      addListener(callback: (message: T) => void) {
        listeners.add(callback)
      },
      removeListener(callback: (message: T) => void) {
        listeners.delete(callback)
      },
    } satisfies Listener<T>,
    emit(message: T) {
      for (const callback of listeners) callback(message)
    },
  }
}

function fakePort(binding: { tabId: number; windowId: number }) {
  const messages = listener<unknown>()
  const disconnects = listener<void>()
  const postMessage = vi.fn()
  const port = {
    name: 'bg2sp:dianzhi:side-panel-command',
    onMessage: messages.api,
    onDisconnect: disconnects.api,
    postMessage,
    disconnect: vi.fn(),
  } as unknown as chrome.runtime.Port

  return {
    port,
    postMessage,
    bind: (panelInstanceId = `panel-${binding.windowId}`) =>
      messages.emit({ ...binding, panelInstanceId }),
    acknowledge(data: true) {
      const message = postMessage.mock.calls.at(-1)?.[0] as { messageId: string } | undefined
      if (!message) throw new Error('No message is pending acknowledgement.')
      messages.emit({ messageId: message.messageId, data })
    },
    respond(messageId: string, data: true) {
      messages.emit({ messageId, data })
    },
    disconnect: () => disconnects.emit(),
  }
}

describe('bg2sp', () => {
  it('resolves a live opaque capability to its bound panel window', () => {
    const event = bg2sp<SidePanelCommand, true>('dianzhi:side-panel-command')
    const panel = fakePort({ tabId: 9, windowId: 19 })
    event.accept(panel.port)

    ;(globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
      runtime: { connect: vi.fn(() => panel.port) },
    }
    const handle = event.handle({ tabId: 9, windowId: 19 }, async () => true)
    panel.bind(handle.panelInstanceId)

    expect(event.bindingFor(handle.panelInstanceId)).toEqual({ tabId: 9, windowId: 19 })
    panel.disconnect()
    expect(event.bindingFor(handle.panelInstanceId)).toBeNull()
  })

  it('delivers only to the requested window and waits for acknowledgement', async () => {
    const event = bg2sp<SidePanelCommand, true>('dianzhi:side-panel-command')
    const left = fakePort({ tabId: 9, windowId: 19 })
    const right = fakePort({ tabId: 10, windowId: 20 })
    event.accept(left.port)
    event.accept(right.port)
    left.bind()
    right.bind()

    const result = event.dispatch({ type: 'clear' }, 20)
    expect(left.postMessage).not.toHaveBeenCalled()
    right.acknowledge(true)
    await expect(result).resolves.toBe(true)
  })

  it('rejects pending delivery when the target port disconnects', async () => {
    const event = bg2sp<SidePanelCommand, true>('dianzhi:side-panel-command')
    const left = fakePort({ tabId: 9, windowId: 19 })
    event.accept(left.port)
    left.bind()

    const result = event.dispatch({ type: 'clear' }, 19)
    left.disconnect()
    await expect(result).rejects.toMatchObject({ code: 'SIDE_PANEL_READY_TIMEOUT' })
  })

  it('keeps deliveries to other windows pending after a different panel disconnects', async () => {
    const event = bg2sp<SidePanelCommand, true>('dianzhi:side-panel-command')
    const left = fakePort({ tabId: 9, windowId: 19 })
    const right = fakePort({ tabId: 10, windowId: 20 })
    event.accept(left.port)
    event.accept(right.port)
    left.bind()
    right.bind()

    const leftResult = event.dispatch({ type: 'clear' }, 19)
    const rightResult = event.dispatch({ type: 'clear' }, 20)
    left.disconnect()
    right.acknowledge(true)

    await expect(leftResult).rejects.toMatchObject({ code: 'SIDE_PANEL_READY_TIMEOUT' })
    await expect(rightResult).resolves.toBe(true)
  })

  it('accepts an acknowledgement only from the targeted panel port', async () => {
    const event = bg2sp<SidePanelCommand, true>('dianzhi:side-panel-command')
    const left = fakePort({ tabId: 9, windowId: 19 })
    const right = fakePort({ tabId: 10, windowId: 20 })
    event.accept(left.port)
    event.accept(right.port)
    left.bind()
    right.bind()

    const result = event.dispatch({ type: 'clear' }, 19)
    const message = left.postMessage.mock.calls.at(-1)?.[0] as { messageId: string }
    let settled = false
    void result.finally(() => {
      settled = true
    })

    right.respond(message.messageId, true)
    await Promise.resolve()
    expect(settled).toBe(false)

    left.acknowledge(true)
    await expect(result).resolves.toBe(true)
  })
})

describe('bg2sp waitForWindow', () => {
  it('resolves immediately when the window already has a bound port', async () => {
    const event = bg2sp<SidePanelCommand, true>('dianzhi:side-panel-command')
    const panel = fakePort({ tabId: 9, windowId: 19 })
    event.accept(panel.port)
    panel.bind()

    await expect(event.waitForWindow(19)).resolves.toBeUndefined()
  })

  it('resolves once the port binds during the wait', async () => {
    const event = bg2sp<SidePanelCommand, true>('dianzhi:side-panel-command')
    const panel = fakePort({ tabId: 9, windowId: 19 })
    event.accept(panel.port)

    let settled = false
    const waiting = event.waitForWindow(19).then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    panel.bind()
    await expect(waiting).resolves.toBeUndefined()
  })

  it('rejects with SIDE_PANEL_READY_TIMEOUT when the wait expires', async () => {
    vi.useFakeTimers()
    try {
      const event = bg2sp<SidePanelCommand, true>('dianzhi:side-panel-command')
      const waiting = event.waitForWindow(19, 5_000)
      const assertion = expect(waiting).rejects.toMatchObject({ code: 'SIDE_PANEL_READY_TIMEOUT' })
      await vi.advanceTimersByTimeAsync(5_000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a pending wait alive when an unrelated panel port disconnects', async () => {
    const event = bg2sp<SidePanelCommand, true>('dianzhi:side-panel-command')
    const left = fakePort({ tabId: 9, windowId: 19 })
    event.accept(left.port)
    left.bind()

    let settled = false
    const waiting = event.waitForWindow(20).then(() => {
      settled = true
    })
    left.disconnect()

    await Promise.resolve()
    expect(settled).toBe(false)

    const right = fakePort({ tabId: 10, windowId: 20 })
    event.accept(right.port)
    right.bind()
    await expect(waiting).resolves.toBeUndefined()
  })

  it('reports only windows with a currently bound panel port', () => {
    const event = bg2sp<SidePanelCommand, true>('dianzhi:side-panel-command')
    expect([...event.connectedWindows()]).toEqual([])

    const panel = fakePort({ tabId: 9, windowId: 19 })
    event.accept(panel.port)
    panel.bind()
    expect([...event.connectedWindows()]).toEqual([19])

    panel.disconnect()
    expect([...event.connectedWindows()]).toEqual([])
  })
})
