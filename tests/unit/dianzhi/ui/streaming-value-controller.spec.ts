import { describe, expect, it } from 'vitest'
import { createStreamingValueController } from '@/dianzhi/ui/streaming-value-controller'

describe('streaming value controller', () => {
  it('advances by equal distances between unchanged generation updates', () => {
    const controller = createStreamingValueController(200)

    controller.observeTarget(200, 0)
    controller.observeTarget(320, 100)
    controller.advance(100)
    const at150 = controller.advance(150)
    const at200 = controller.advance(200)

    expect(at150 - 200).toBeCloseTo(at200 - at150, 6)
  })

  it('uses a faster catch-up speed after faster recent growth', () => {
    const slow = createStreamingValueController(200)
    slow.observeTarget(200, 0)
    slow.observeTarget(220, 100)
    slow.advance(100)
    const slowValue = slow.advance(200)

    const fast = createStreamingValueController(200)
    fast.observeTarget(200, 0)
    fast.observeTarget(320, 100)
    fast.advance(100)
    const fastValue = fast.advance(200)

    expect(fastValue - 200).toBeGreaterThan(slowValue - 200)
  })

  it('never grows beyond the configured upper bound', () => {
    const controller = createStreamingValueController(200, { max: 280 })

    controller.observeTarget(600, 100)
    controller.advance(100)
    const value = controller.advance(2_000)

    expect(value).toBe(280)
  })

  it('keeps the initial reserved value when empty content is shorter', () => {
    const controller = createStreamingValueController(280, { min: 280, max: 560 })

    controller.observeTarget(120, 100)
    controller.advance(100)
    const value = controller.advance(2_000)

    expect(value).toBe(280)
  })

  it('seeds the current value while keeping the recorded growth rate', () => {
    const controller = createStreamingValueController(200)

    // A 100px/100ms burst records ~320px/s after memory decay — well above the
    // 80px/s floor.
    controller.observeTarget(220, 0)
    controller.observeTarget(320, 100)
    controller.setValue(80)
    expect(controller.getValue()).toBe(80)
    controller.observeTarget(320, 200)
    controller.advance(200) // first advance only baselines the chase

    const value = controller.advance(400)

    // 80px over a floor-speed 200ms chase would be exactly 96; a faster chase
    // moves more, so the remembered burst rate survived the seed.
    expect(value).toBeGreaterThan(80 + 16)
  })
})
