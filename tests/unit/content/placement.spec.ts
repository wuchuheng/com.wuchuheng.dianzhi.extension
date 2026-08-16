// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { computePlacement } from '../../../src/content/popover/placement'

const viewport = { width: 800, height: 600 }
const panel = { width: 380, height: 220 }

describe('anchored popover placement', () => {
  it('defaults below and centers its arrow on the selection', () => {
    expect(
      computePlacement({ left: 300, right: 400, top: 100, bottom: 120 }, panel, viewport)
    ).toEqual({ direction: 'below', x: 160, y: 126, arrowX: 190, width: 380 })
  })

  it('flips above when below overflows', () => {
    const placement = computePlacement(
      { left: 300, right: 400, top: 500, bottom: 520 },
      panel,
      viewport
    )

    expect(placement.direction).toBe('above')
    expect(placement.y).toBe(274)
  })

  it('clamps wide panels and keeps the arrow away from corners', () => {
    const left = computePlacement(
      { left: 0, right: 4, top: 100, bottom: 120 },
      { width: 900, height: 200 },
      viewport
    )

    expect(left.width).toBe(784)
    expect(left.x).toBe(8)
    expect(left.arrowX).toBe(24)
  })

  it('centers a fully degenerate synthetic rect', () => {
    const placement = computePlacement({ left: 0, right: 0, top: 0, bottom: 0 }, panel, viewport)

    expect(placement.x).toBe(210)
    expect(placement.arrowX).toBe(190)
  })
})
