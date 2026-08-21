import { describe, expect, it } from 'vitest'
import { createStreamingHeightController } from '@/content/views/streaming-height-controller'

describe('streaming height controller', () => {
  it('advances by equal distances between unchanged generation updates', () => {
    const controller = createStreamingHeightController(200)

    controller.observeTarget(200, 0)
    controller.observeTarget(320, 100)
    controller.advance(100)
    const at150 = controller.advance(150)
    const at200 = controller.advance(200)

    expect(at150 - 200).toBeCloseTo(at200 - at150, 6)
  })

  it('uses a faster catch-up speed after faster recent growth', () => {
    const slow = createStreamingHeightController(200)
    slow.observeTarget(200, 0)
    slow.observeTarget(220, 100)
    slow.advance(100)
    const slowHeight = slow.advance(200)

    const fast = createStreamingHeightController(200)
    fast.observeTarget(200, 0)
    fast.observeTarget(320, 100)
    fast.advance(100)
    const fastHeight = fast.advance(200)

    expect(fastHeight - 200).toBeGreaterThan(slowHeight - 200)
  })

  it('never grows beyond the configured outer-height cap', () => {
    const controller = createStreamingHeightController(200, { maxHeight: 280 })

    controller.observeTarget(600, 100)
    controller.advance(100)
    const height = controller.advance(2_000)

    expect(height).toBe(280)
  })

  it('keeps the initial reserved height when empty content is shorter', () => {
    const controller = createStreamingHeightController(280, { minHeight: 280, maxHeight: 560 })

    controller.observeTarget(120, 100)
    controller.advance(100)
    const height = controller.advance(2_000)

    expect(height).toBe(280)
  })
})
