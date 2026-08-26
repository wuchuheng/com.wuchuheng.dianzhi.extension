import { act, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStreamingHeight } from '@/dianzhi/ui/use-streaming-height'
;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

interface HarnessProps {
  visible: boolean
  targetVersion: unknown
  minimumHeight?: number
  maximumHeight?: number
  reducedMotion: boolean
  onHeightChange(height: number): void
}

function Harness(props: HarnessProps) {
  const elementRef = useRef<HTMLDivElement | null>(null)
  useStreamingHeight({ elementRef, ...props })
  return <div ref={elementRef} className="grow" />
}

let root: Root | undefined
let host: HTMLDivElement | undefined
let frameCallback: ((now: number) => void) | null

const base = (overrides: Partial<HarnessProps> = {}): HarnessProps => ({
  visible: true,
  targetVersion: 1,
  reducedMotion: false,
  onHeightChange: vi.fn(),
  ...overrides,
})

async function render(props: HarnessProps): Promise<HTMLDivElement> {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => {
    root?.render(<Harness {...props} />)
  })
  return host.firstElementChild as HTMLDivElement
}

async function update(props: HarnessProps) {
  await act(async () => {
    root?.render(<Harness {...props} />)
  })
}

function defineOffsetHeight(element: HTMLElement, value: number) {
  Object.defineProperty(element, 'offsetHeight', { value, configurable: true })
}

const driveFrames = (count = 300) => {
  let now = 1_000
  for (let i = 0; i < count && frameCallback !== null; i++) {
    const cb = frameCallback
    frameCallback = null
    cb(now)
    now += 33
  }
}

beforeEach(() => {
  frameCallback = null
  vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
    frameCallback = cb
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', () => {
    frameCallback = null
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  act(() => root?.unmount())
  root = undefined
  host?.remove()
  host = undefined
})

describe('useStreamingHeight', () => {
  it('applies the measured height instantly the first time it becomes visible', async () => {
    const onHeightChange = vi.fn()
    const element = await render(base({ visible: false, targetVersion: 1, onHeightChange }))
    defineOffsetHeight(element, 240)
    await update(base({ visible: true, targetVersion: 1, onHeightChange }))
    expect(frameCallback).toBeNull()
    expect(onHeightChange).toHaveBeenLastCalledWith(240)
  })

  it('clamps the measured height to maximumHeight', async () => {
    const onHeightChange = vi.fn()
    const element = await render(base({ visible: false, maximumHeight: 560, onHeightChange }))
    defineOffsetHeight(element, 900)
    await update(base({ visible: true, maximumHeight: 560, onHeightChange }))
    expect(onHeightChange).toHaveBeenLastCalledWith(560)
  })

  it('grows without a cap when maximumHeight is omitted', async () => {
    const onHeightChange = vi.fn()
    const element = await render(base({ visible: false, onHeightChange }))
    defineOffsetHeight(element, 900)
    await update(base({ visible: true, targetVersion: 2, onHeightChange }))
    expect(onHeightChange).toHaveBeenLastCalledWith(900)
  })

  it('glides toward a new measured height across animation frames', async () => {
    const onHeightChange = vi.fn()
    const element = await render(base({ visible: true, targetVersion: 1, onHeightChange }))
    expect(onHeightChange).toHaveBeenLastCalledWith(0)
    defineOffsetHeight(element, 240)
    await update(base({ visible: true, targetVersion: 2, onHeightChange }))
    expect(frameCallback).not.toBeNull()
    driveFrames()
    expect(onHeightChange).toHaveBeenLastCalledWith(240)
  })

  it('jumps instantly instead of animating under reduced motion', async () => {
    const onHeightChange = vi.fn()
    const element = await render(
      base({ visible: true, targetVersion: 1, reducedMotion: true, onHeightChange })
    )
    defineOffsetHeight(element, 240)
    await update(base({ visible: true, targetVersion: 2, reducedMotion: true, onHeightChange }))
    expect(frameCallback).toBeNull()
    expect(onHeightChange).toHaveBeenLastCalledWith(240)
  })

  it('leaves the height untouched while not visible', async () => {
    const onHeightChange = vi.fn()
    await render(base({ visible: false, targetVersion: 1, onHeightChange }))
    expect(onHeightChange).not.toHaveBeenCalled()
  })
})
