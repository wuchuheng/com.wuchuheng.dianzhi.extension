import { DianzhiError } from '@/dianzhi/domain/errors'
import { buildEventName } from '../event-name'
import { errorFromResponse, errorToResponse, type ErrorResponse } from '../internal/messaging'
import type { Cancel } from '../types'

export interface TargetedSidePanelEvent<Args, Return> {
  dispatch(args: Args, windowId: number): Promise<Return>
  accept(port: chrome.runtime.Port): boolean
  handle(
    binding: { tabId: number; windowId: number },
    callback: (args: Args) => Promise<Return>
  ): Cancel
}

type Binding = { tabId: number; windowId: number }
type RequestMessage<Args> = { messageId: string; args: Args }
type ResponseMessage<Return> = { messageId: string; data?: Return; error?: ErrorResponse }
type PendingRequest<Return> = {
  port: chrome.runtime.Port
  reject: (reason: Error) => void
  resolve: (value: Return) => void
}

function isBinding(value: unknown): value is Binding {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const binding = value as Record<string, unknown>
  return (
    typeof binding.tabId === 'number' &&
    Number.isSafeInteger(binding.tabId) &&
    binding.tabId >= 0 &&
    typeof binding.windowId === 'number' &&
    Number.isSafeInteger(binding.windowId) &&
    binding.windowId >= 0
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
  const pendingByMessageId = new Map<string, PendingRequest<Return>>()
  let messageSequence = 0

  const rejectPendingForPort = (port: chrome.runtime.Port, error: Error) => {
    for (const [messageId, pending] of pendingByMessageId) {
      if (pending.port !== port) continue
      pendingByMessageId.delete(messageId)
      pending.reject(error)
    }
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
            windowByPort.delete(existingPort)
          }
          portsByWindow.set(message.windowId, port)
          windowByPort.set(port, message.windowId)
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
        windowByPort.delete(port)
      })

      return true
    },
    handle(binding, callback) {
      const port = chrome.runtime.connect({ name: eventName })
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
      port.postMessage(binding)
      return () => {
        port.onMessage.removeListener(listener)
        port.disconnect()
      }
    },
  }
}
