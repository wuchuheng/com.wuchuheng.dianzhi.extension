import { DianzhiError } from '@/dianzhi/domain/errors'
import { buildEventName } from '../event-name'
import { errorFromResponse, errorToResponse, type ErrorResponse } from '../internal/messaging'
import type { Cancel } from '../types'

export interface TargetedSidePanelEvent<Args, Return> {
  dispatch(args: Args, windowId: number): Promise<Return>
  /** Resolves once a port is bound for `windowId`; rejects on timeout or disconnect. */
  waitForWindow(windowId: number, timeoutMs?: number): Promise<void>
  /** Window IDs with an active panel port binding, used to disambiguate panel senders. */
  connectedWindows(): ReadonlySet<number>
  /** Resolves a live opaque panel capability to its trusted port binding. */
  bindingFor(panelInstanceId: string): { tabId: number; windowId: number } | null
  accept(port: chrome.runtime.Port): boolean
  handle(
    binding: { tabId: number; windowId: number },
    callback: (args: Args) => Promise<Return>
  ): { cancel: Cancel; panelInstanceId: string }
}

/** Matches the pre-coordinator Side Panel ready timeout. */
export const DEFAULT_SIDE_PANEL_READY_TIMEOUT_MS = 5_000

type Binding = { tabId: number; windowId: number }
type BindingMessage = Binding & { panelInstanceId: string }
type RequestMessage<Args> = { messageId: string; args: Args }
type ResponseMessage<Return> = { messageId: string; data?: Return; error?: ErrorResponse }
type PendingRequest<Return> = {
  port: chrome.runtime.Port
  reject: (reason: Error) => void
  resolve: (value: Return) => void
}

function isBinding(value: unknown): value is BindingMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const binding = value as Record<string, unknown>
  return (
    typeof binding.tabId === 'number' &&
    Number.isSafeInteger(binding.tabId) &&
    binding.tabId >= 0 &&
    typeof binding.windowId === 'number' &&
    Number.isSafeInteger(binding.windowId) &&
    binding.windowId >= 0 &&
    typeof binding.panelInstanceId === 'string' &&
    binding.panelInstanceId.trim().length > 0
  )
}

function isResponse<Return>(value: unknown): value is ResponseMessage<Return> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const response = value as Record<string, unknown>
  return typeof response.messageId === 'string'
}

function deliveryError(
  code: 'SIDE_PANEL_READY_TIMEOUT' | 'SIDE_PANEL_DELIVERY_FAILED',
  windowId: number
) {
  return new DianzhiError({
    code,
    message:
      code === 'SIDE_PANEL_READY_TIMEOUT'
        ? 'The Side Panel is not connected for the target window.'
        : 'The Side Panel command could not be delivered.',
    context: { windowId },
  })
}

export function bg2sp<Args, Return>(name: string): TargetedSidePanelEvent<Args, Return> {
  const eventName = buildEventName('bg2sp', name)
  const portsByWindow = new Map<number, chrome.runtime.Port>()
  const windowByPort = new Map<chrome.runtime.Port, number>()
  const bindingByPanelInstanceId = new Map<
    string,
    { binding: Binding; port: chrome.runtime.Port }
  >()
  const panelInstanceIdByPort = new Map<chrome.runtime.Port, string>()
  const pendingByMessageId = new Map<string, PendingRequest<Return>>()
  type WindowWaiter = {
    resolve: () => void
    reject: (error: Error) => void
    timer: ReturnType<typeof setTimeout>
  }
  const waitersByWindow = new Map<number, WindowWaiter[]>()
  let messageSequence = 0

  const rejectPendingForPort = (port: chrome.runtime.Port, error: Error) => {
    for (const [messageId, pending] of pendingByMessageId) {
      if (pending.port !== port) continue
      pendingByMessageId.delete(messageId)
      pending.reject(error)
    }
  }

  const removePortBinding = (port: chrome.runtime.Port) => {
    const panelInstanceId = panelInstanceIdByPort.get(port)
    if (panelInstanceId && bindingByPanelInstanceId.get(panelInstanceId)?.port === port) {
      bindingByPanelInstanceId.delete(panelInstanceId)
    }
    panelInstanceIdByPort.delete(port)
  }

  const resolveWaiters = (windowId: number) => {
    const waiters = waitersByWindow.get(windowId)
    if (!waiters) return
    waitersByWindow.delete(windowId)
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.resolve()
    }
  }

  const rejectWaiters = (windowId: number, error: Error) => {
    const waiters = waitersByWindow.get(windowId)
    if (!waiters) return
    waitersByWindow.delete(windowId)
    for (const waiter of waiters) {
      clearTimeout(waiter.timer)
      waiter.reject(error)
    }
  }

  function registerWait(windowId: number, timeoutMs: number): Promise<void> {
    if (portsByWindow.has(windowId)) return Promise.resolve()

    return new Promise<void>((resolve, reject) => {
      const waiter: WindowWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          rejectWaiters(windowId, deliveryError('SIDE_PANEL_READY_TIMEOUT', windowId))
        }, timeoutMs),
      }
      const waiters = waitersByWindow.get(windowId) ?? []
      waiters.push(waiter)
      waitersByWindow.set(windowId, waiters)
    })
  }

  return {
    dispatch(args, windowId) {
      const port = portsByWindow.get(windowId)
      if (!port) return Promise.reject(deliveryError('SIDE_PANEL_READY_TIMEOUT', windowId))

      const messageId = `${eventName}:${++messageSequence}`
      return new Promise<Return>((resolve, reject) => {
        pendingByMessageId.set(messageId, { port, resolve, reject })
        try {
          port.postMessage({ messageId, args } satisfies RequestMessage<Args>)
        } catch {
          pendingByMessageId.delete(messageId)
          reject(deliveryError('SIDE_PANEL_DELIVERY_FAILED', windowId))
        }
      })
    },
    waitForWindow(windowId, timeoutMs = DEFAULT_SIDE_PANEL_READY_TIMEOUT_MS) {
      return registerWait(windowId, timeoutMs)
    },
    connectedWindows() {
      return new Set(portsByWindow.keys())
    },
    bindingFor(panelInstanceId) {
      const entry = bindingByPanelInstanceId.get(panelInstanceId)
      return entry ? { ...entry.binding } : null
    },
    accept(port) {
      if (port.name !== eventName) return false

      port.onMessage.addListener((message: unknown) => {
        if (isBinding(message)) {
          const existingPort = portsByWindow.get(message.windowId)
          if (existingPort && existingPort !== port) {
            rejectPendingForPort(
              existingPort,
              deliveryError('SIDE_PANEL_READY_TIMEOUT', message.windowId)
            )
            removePortBinding(existingPort)
            windowByPort.delete(existingPort)
          }
          portsByWindow.set(message.windowId, port)
          windowByPort.set(port, message.windowId)
          const previousPanelInstanceId = panelInstanceIdByPort.get(port)
          if (previousPanelInstanceId) bindingByPanelInstanceId.delete(previousPanelInstanceId)
          bindingByPanelInstanceId.set(message.panelInstanceId, {
            binding: { tabId: message.tabId, windowId: message.windowId },
            port,
          })
          panelInstanceIdByPort.set(port, message.panelInstanceId)
          resolveWaiters(message.windowId)
          return
        }

        if (!isResponse<Return>(message)) return
        const pending = pendingByMessageId.get(message.messageId)
        if (!pending || pending.port !== port) return
        pendingByMessageId.delete(message.messageId)
        if (message.error) {
          pending.reject(errorFromResponse(message.error))
          return
        }
        pending.resolve(message.data as Return)
      })

      port.onDisconnect.addListener(() => {
        const windowId = windowByPort.get(port)
        if (windowId === undefined) return
        if (portsByWindow.get(windowId) === port) portsByWindow.delete(windowId)
        rejectPendingForPort(port, deliveryError('SIDE_PANEL_READY_TIMEOUT', windowId))
        rejectWaiters(windowId, deliveryError('SIDE_PANEL_READY_TIMEOUT', windowId))
        removePortBinding(port)
        windowByPort.delete(port)
      })

      return true
    },
    handle(binding, callback) {
      const port = chrome.runtime.connect({ name: eventName })
      const panelInstanceId = crypto.randomUUID()
      const listener = async (message: unknown) => {
        if (!message || typeof message !== 'object' || Array.isArray(message)) return
        const request = message as Partial<RequestMessage<Args>>
        if (typeof request.messageId !== 'string') return

        const response: ResponseMessage<Return> = { messageId: request.messageId }
        try {
          response.data = await callback(request.args as Args)
        } catch (error) {
          response.error = errorToResponse(error)
        }
        port.postMessage(response)
      }
      port.onMessage.addListener(listener)
      port.postMessage({ ...binding, panelInstanceId } satisfies BindingMessage)
      return {
        panelInstanceId,
        cancel: () => {
        port.onMessage.removeListener(listener)
        port.disconnect()
        },
      }
    },
  }
}
