import { DianzhiError } from '@/dianzhi/domain/errors'
import type { SidePanelPortLifecycle } from '@/events/sidePanel/sidePanel'
import type { Cancel } from '@/events/types'

export type SidePanelChannel = 'command' | 'update'

export interface ReadyPanelSession {
  panelSessionId: string
  tabId: number
  windowId: number
  generation: number
}

export type PanelSessionChange =
  | (ReadyPanelSession & { type: 'channels-ready' })
  | {
      type: 'command-disconnected' | 'update-disconnected' | 'removed'
      panelSessionId: string
      windowId: number
      generation: number
    }

export interface SidePanelSessionRegistry {
  apply(channel: SidePanelChannel, event: SidePanelPortLifecycle): void
  beginSynchronization(
    panelSessionId: string,
    currentBinding: { tabId: number; windowId: number }
  ): ReadyPanelSession | null
  completeSynchronization(panelSessionId: string, generation: number): boolean
  readyBinding(panelSessionId: string): ReadyPanelSession | null
  waitUntilReady(panelSessionId: string, timeoutMs?: number): Promise<ReadyPanelSession>
  sessionsForWindow(windowId: number): readonly ReadyPanelSession[]
  removeWindow(windowId: number): void
  observe(listener: (change: PanelSessionChange) => void): Cancel
}

type SessionRecord = ReadyPanelSession & {
  commandConnected: boolean
  updateConnected: boolean
  phase: 'binding' | 'synchronizing' | 'ready' | 'recovering'
}

type Waiter = {
  resolve(session: ReadyPanelSession): void
  reject(error: Error): void
  timer: ReturnType<typeof setTimeout>
}

const DEFAULT_READY_TIMEOUT_MS = 5_000

function publicSession(record: SessionRecord): ReadyPanelSession {
  return {
    panelSessionId: record.panelSessionId,
    tabId: record.tabId,
    windowId: record.windowId,
    generation: record.generation,
  }
}

function notReady(panelSessionId: string, windowId?: number): DianzhiError {
  return new DianzhiError({
    code: 'SIDE_PANEL_SESSION_NOT_READY',
    message: 'The Side Panel session has not finished reconnecting.',
    context: { panelSessionId, ...(windowId === undefined ? {} : { windowId }) },
  })
}

export function createSidePanelSessionRegistry(): SidePanelSessionRegistry {
  const sessions = new Map<string, SessionRecord>()
  const listeners = new Set<(change: PanelSessionChange) => void>()
  const waiters = new Map<string, Waiter[]>()

  const emit = (change: PanelSessionChange) => {
    for (const listener of listeners) listener(change)
  }

  const resolveWaiters = (record: SessionRecord) => {
    const pending = waiters.get(record.panelSessionId)
    if (!pending) return
    waiters.delete(record.panelSessionId)
    for (const waiter of pending) {
      clearTimeout(waiter.timer)
      waiter.resolve(publicSession(record))
    }
  }

  const rejectWaiters = (record: SessionRecord) => {
    const pending = waiters.get(record.panelSessionId)
    if (!pending) return
    waiters.delete(record.panelSessionId)
    for (const waiter of pending) {
      clearTimeout(waiter.timer)
      waiter.reject(notReady(record.panelSessionId, record.windowId))
    }
  }

  return {
    apply(channel, event) {
      const current = sessions.get(event.panelSessionId)
      if (event.type === 'bound') {
        let record = current
        if (!record || record.windowId !== event.binding.windowId) {
          if (record) rejectWaiters(record)
          record = {
            panelSessionId: event.panelSessionId,
            ...event.binding,
            generation: (record?.generation ?? -1) + 1,
            commandConnected: false,
            updateConnected: false,
            phase: 'binding',
          }
          sessions.set(event.panelSessionId, record)
        }
        if (channel === 'command') record.commandConnected = true
        else record.updateConnected = true
        if (record.commandConnected && record.updateConnected && record.phase !== 'ready') {
          record.phase = 'binding'
          emit({ type: 'channels-ready', ...publicSession(record) })
        }
        return
      }

      if (!current || current.windowId !== event.binding.windowId) return
      const wasConnected =
        channel === 'command' ? current.commandConnected : current.updateConnected
      if (!wasConnected) return
      if (channel === 'command') current.commandConnected = false
      else current.updateConnected = false
      current.generation += 1
      current.phase = 'recovering'
      emit({
        type: channel === 'command' ? 'command-disconnected' : 'update-disconnected',
        panelSessionId: current.panelSessionId,
        windowId: current.windowId,
        generation: current.generation,
      })
    },

    beginSynchronization(panelSessionId, currentBinding) {
      const record = sessions.get(panelSessionId)
      if (
        !record ||
        !record.commandConnected ||
        !record.updateConnected ||
        record.windowId !== currentBinding.windowId
      ) {
        return null
      }
      record.tabId = currentBinding.tabId
      record.phase = 'synchronizing'
      return publicSession(record)
    },

    completeSynchronization(panelSessionId, generation) {
      const record = sessions.get(panelSessionId)
      if (
        !record ||
        record.generation !== generation ||
        record.phase !== 'synchronizing' ||
        !record.commandConnected ||
        !record.updateConnected
      ) {
        return false
      }
      record.phase = 'ready'
      resolveWaiters(record)
      return true
    },

    readyBinding(panelSessionId) {
      const record = sessions.get(panelSessionId)
      return record?.phase === 'ready' && record.commandConnected && record.updateConnected
        ? publicSession(record)
        : null
    },

    waitUntilReady(panelSessionId, timeoutMs = DEFAULT_READY_TIMEOUT_MS) {
      const record = sessions.get(panelSessionId)
      if (record?.phase === 'ready' && record.commandConnected && record.updateConnected) {
        return Promise.resolve(publicSession(record))
      }
      return new Promise<ReadyPanelSession>((resolve, reject) => {
        const waiter: Waiter = {
          resolve,
          reject,
          timer: setTimeout(() => {
            const pending = waiters.get(panelSessionId) ?? []
            waiters.set(
              panelSessionId,
              pending.filter((item) => item !== waiter)
            )
            reject(notReady(panelSessionId, record?.windowId))
          }, timeoutMs),
        }
        waiters.set(panelSessionId, [...(waiters.get(panelSessionId) ?? []), waiter])
      })
    },

    sessionsForWindow(windowId) {
      return [...sessions.values()]
        .filter((record) => record.windowId === windowId)
        .map(publicSession)
    },

    removeWindow(windowId) {
      for (const [panelSessionId, record] of sessions) {
        if (record.windowId !== windowId) continue
        sessions.delete(panelSessionId)
        rejectWaiters(record)
        emit({
          type: 'removed',
          panelSessionId,
          windowId,
          generation: record.generation + 1,
        })
      }
    },

    observe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
