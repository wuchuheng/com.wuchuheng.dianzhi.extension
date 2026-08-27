import { describe, expect, it } from 'vitest'
import {
  isNearBottom,
  SCROLL_FOLLOW_THRESHOLD,
  syncScrollForHeightGrowth,
} from '@/sidepanel/scroll-follow'

function container(
  overrides: Partial<{ scrollTop: number; scrollHeight: number; clientHeight: number }> = {}
) {
  return { scrollTop: 0, scrollHeight: 1000, clientHeight: 300, ...overrides }
}

describe('Side Panel scroll follow', () => {
  it('exposes the 150px threshold used by the chat scroll follow', () => {
    expect(SCROLL_FOLLOW_THRESHOLD).toBe(150)
  })

  it('is pinned while the distance to the bottom is strictly inside the threshold', () => {
    expect(isNearBottom(container({ scrollTop: 700 }))).toBe(true) // gap 0
    expect(isNearBottom(container({ scrollTop: 580 }))).toBe(true) // gap 120
  })

  it('is unpinned once the distance to the bottom exceeds the threshold', () => {
    expect(isNearBottom(container({ scrollTop: 550 }))).toBe(false) // gap 150
    expect(isNearBottom(container({ scrollTop: 549 }))).toBe(false) // gap 151
    expect(isNearBottom(container({ scrollTop: 100 }))).toBe(false) // gap 600
  })

  it('treats a view shorter than its container as pinned', () => {
    expect(isNearBottom(container({ scrollHeight: 200 }))).toBe(true)
  })

  it('moves scrollTop by the same height delta when the pre-growth gap is below 150px', () => {
    const element = container({ scrollTop: 551, scrollHeight: 1020 })
    expect(syncScrollForHeightGrowth(element, 20)).toBe(true) // previous gap 149
    expect(element.scrollTop).toBe(571)
  })

  it('does not synchronize at or beyond the strict 150px guard', () => {
    const atGuard = container({ scrollTop: 550, scrollHeight: 1020 })
    expect(syncScrollForHeightGrowth(atGuard, 20)).toBe(false) // previous gap 150
    expect(atGuard.scrollTop).toBe(550)

    const beyondGuard = container({ scrollTop: 549, scrollHeight: 1020 })
    expect(syncScrollForHeightGrowth(beyondGuard, 20)).toBe(false)
    expect(beyondGuard.scrollTop).toBe(549)
  })
})
