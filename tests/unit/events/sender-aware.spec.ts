import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DianzhiError } from '@/dianzhi/domain/errors'
import { isPrivilegedExtensionSender } from '@/events/background/background'
import { createMessageEvent } from '@/events/internal/factories'

type RuntimeListener = (
  request: { event: string; args: { value: number } },
  sender: chrome.runtime.MessageSender,
  sendResponse: (response: unknown) => void
) => boolean

const addListener = vi.fn<(listener: RuntimeListener) => void>()
const removeListener = vi.fn<(listener: RuntimeListener) => void>()
const sendMessage = vi.fn()

beforeEach(() => {
  addListener.mockReset()
  removeListener.mockReset()
  sendMessage.mockReset()
  vi.stubGlobal('chrome', {
    runtime: {
      id: 'extension-id',
      onMessage: { addListener, removeListener },
      sendMessage,
    },
  })
})

describe('sender-aware message events', () => {
  it('allows privileged extension contexts but rejects content-script tab senders', () => {
    expect(
      isPrivilegedExtensionSender({ id: 'extension-id' } as chrome.runtime.MessageSender)
    ).toBe(true)
    expect(
      isPrivilegedExtensionSender({
        id: 'extension-id',
        origin: 'chrome-extension://extension-id',
      } as chrome.runtime.MessageSender)
    ).toBe(true)
    expect(
      isPrivilegedExtensionSender({
        id: 'extension-id',
        origin: 'https://reader.example',
        tab: { id: 17 },
      } as chrome.runtime.MessageSender)
    ).toBe(false)
    expect(
      isPrivilegedExtensionSender({ id: 'another-extension' } as chrome.runtime.MessageSender)
    ).toBe(false)
  })

  it('passes the exact Chrome sender to handleWithSender', async () => {
    const event = createMessageEvent<{ value: number }, number>('cs2bg:test')
    const sender = { tab: { id: 17 } } as chrome.runtime.MessageSender
    let seenSender: chrome.runtime.MessageSender | undefined

    event.handleWithSender(async ({ value }, receivedSender) => {
      seenSender = receivedSender
      return value * 2
    })

    const listener = addListener.mock.calls[0]?.[0]
    expect(listener).toBeTypeOf('function')
    const response = await new Promise<unknown>((resolve) => {
      expect(listener?.({ event: 'cs2bg:test', args: { value: 3 } }, sender, resolve)).toBe(true)
    })

    expect(seenSender).toBe(sender)
    expect(response).toEqual({ success: true, data: 6 })
  })

  it('keeps the existing handle callback source-compatible', async () => {
    const event = createMessageEvent<{ value: number }, number>('cs2bg:test')
    event.handle(async ({ value }) => value + 1)

    const listener = addListener.mock.calls[0]?.[0]
    const response = await new Promise<unknown>((resolve) => {
      listener?.(
        { event: 'cs2bg:test', args: { value: 3 } },
        {} as chrome.runtime.MessageSender,
        resolve
      )
    })

    expect(response).toEqual({ success: true, data: 4 })
  })

  it('returns a cancellation function for sender-aware handlers', () => {
    const event = createMessageEvent<void, void>('ep2bg:test')
    const cancel = event.handleWithSender(async () => undefined)
    const listener = addListener.mock.calls[0]?.[0]

    cancel()

    expect(removeListener).toHaveBeenCalledWith(listener)
  })

  it('serializes stable Dianzhi errors from handlers', async () => {
    const event = createMessageEvent<void, void>('cs2bg:test')
    event.handleWithSender(async () => {
      throw new DianzhiError({
        code: 'INVALID_EVENT',
        message: 'Command payload is invalid.',
        context: { requestId: 'r1' },
      })
    })

    const listener = addListener.mock.calls[0]?.[0]
    const response = await new Promise<unknown>((resolve) => {
      listener?.(
        { event: 'cs2bg:test', args: { value: 0 } },
        {} as chrome.runtime.MessageSender,
        resolve
      )
    })

    expect(response).toEqual({
      success: false,
      error: expect.objectContaining({
        code: 'INVALID_EVENT',
        message: 'Command payload is invalid.',
        context: { requestId: 'r1' },
      }),
    })
  })

  it('reconstructs stable Dianzhi errors for dispatchers', async () => {
    sendMessage.mockResolvedValue({
      success: false,
      error: {
        code: 'DB_UNAVAILABLE',
        message: 'Database unavailable.',
        context: { operation: 'conversation.sync' },
        stack: '',
      },
    })
    const event = createMessageEvent<void, void>('cs2bg:test')

    await expect(event.dispatch()).rejects.toMatchObject({
      name: 'DianzhiError',
      code: 'DB_UNAVAILABLE',
      context: { operation: 'conversation.sync' },
    })
  })
})
