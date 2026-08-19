import { act, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScrollGuard, type ScrollGuardOptions } from '@/content/views/scroll-guard'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const CLIENT_HEIGHT = 300
const SCROLL_HEIGHT = 1000

interface HarnessProps {
  options: ScrollGuardOptions
  onScrollRef: { current: (() => void) | null }
}

function Harness({ options, onScrollRef }: HarnessProps) {
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const onScroll = useScrollGuard(bodyRef, options)
  useEffect(() => {
    onScrollRef.current = onScroll
  })
  return <div ref={bodyRef} />
}

let root: Root | undefined
let host: HTMLDivElement | undefined
let onScrollRef: { current: (() => void) | null }
let container: HTMLDivElement

function baseOptions(overrides: Partial<ScrollGuardOptions> = {}): ScrollGuardOptions {
  return { visible: true, mode: 'chat', streaming: false, messages: [{}], ...overrides }
}

function defineScrollTop(value: number) {
  Object.defineProperty(container, 'scrollTop', { value, writable: true, configurable: true })
}

async function render(options: ScrollGuardOptions) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  onScrollRef = { current: null }
  await act(async () => {
    root.render(<Harness options={options} onScrollRef={onScrollRef} />)
  })
  container = host.firstElementChild as HTMLDivElement
  Object.defineProperty(container, 'clientHeight', { value: CLIENT_HEIGHT, configurable: true })
  Object.defineProperty(container, 'scrollHeight', { value: SCROLL_HEIGHT, configurable: true })
  defineScrollTop(SCROLL_HEIGHT - CLIENT_HEIGHT)
}

async function update(options: ScrollGuardOptions) {
  await act(async () => {
    root?.render(<Harness options={options} onScrollRef={onScrollRef} />)
  })
}

/** Simulates a user wheel scroll that leaves the given gap to the bottom. */
function scrollToDistance(distanceToBottom: number) {
  defineScrollTop(SCROLL_HEIGHT - CLIENT_HEIGHT - distanceToBottom)
  onScrollRef.current?.()
}

beforeAll(() => {
  // jsdom does not implement Element#scrollTo; mount effects need it stubbed
  // before the first render, so stub it on the prototype and spy on it.
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
    value: vi.fn(),
    configurable: true,
    writable: true,
  })
})

afterAll(() => {
  delete (HTMLElement.prototype as { scrollTo?: unknown }).scrollTo
})

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

describe('useScrollGuard', () => {
  it('smooth-scrolls to the bottom on a discrete message update while pinned', async () => {
    await render(baseOptions({ streaming: true }))
    await update(baseOptions({ streaming: false }))
    expect(container.scrollTo).toHaveBeenCalledTimes(1)
    expect(container.scrollTo).toHaveBeenCalledWith({ top: SCROLL_HEIGHT, behavior: 'smooth' })
  })

  it('follows the bottom instantly while a reply is streaming', async () => {
    await render(baseOptions({ streaming: true }))
    await update(baseOptions({ streaming: true, messages: [{}, {}] }))
    expect(container.scrollTop).toBe(SCROLL_HEIGHT)
    expect(container.scrollTo).not.toHaveBeenCalled()
  })

  it('keeps the scroll position when the user scrolls away from the bottom (scroll guard)', async () => {
    await render(baseOptions({ streaming: true }))
    scrollToDistance(200)
    await update(baseOptions({ streaming: false, messages: [{}, {}] }))
    expect(container.scrollTo).not.toHaveBeenCalled()
    expect(container.scrollTop).toBe(SCROLL_HEIGHT - CLIENT_HEIGHT - 200)
  })

  it('re-pins once the user scrolls back within the threshold', async () => {
    await render(baseOptions({ streaming: true }))
    scrollToDistance(200)
    scrollToDistance(10)
    await update(baseOptions({ streaming: false, messages: [{}, {}] }))
    expect(container.scrollTo).toHaveBeenCalledTimes(1)
    expect(container.scrollTo).toHaveBeenCalledWith({ top: SCROLL_HEIGHT, behavior: 'smooth' })
  })

  it('reacts to updates that keep the message count unchanged (terminal status changes)', async () => {
    await render(baseOptions({ streaming: true }))
    await update(baseOptions({ streaming: true, messages: [{ text: 'partial' }] }))
    expect(container.scrollTo).not.toHaveBeenCalled()
    await update(baseOptions({ streaming: false, messages: [{ text: 'complete' }] }))
    expect(container.scrollTo).toHaveBeenCalledTimes(1)
    expect(container.scrollTo).toHaveBeenCalledWith({ top: SCROLL_HEIGHT, behavior: 'smooth' })
  })

  it('resets to pinned when the chat mode is entered', async () => {
    await render(baseOptions({ mode: 'card' }))
    scrollToDistance(200)
    await update(baseOptions({ mode: 'chat' }))
    expect(container.scrollTo).toHaveBeenCalledWith({ top: SCROLL_HEIGHT, behavior: 'smooth' })
  })

  it('never auto-scrolls while the popover is in card mode', async () => {
    await render(baseOptions({ mode: 'card' }))
    await update(baseOptions({ mode: 'card', messages: [{}, {}] }))
    expect(container.scrollTo).not.toHaveBeenCalled()
    expect(container.scrollTop).toBe(SCROLL_HEIGHT - CLIENT_HEIGHT)
  })
})
