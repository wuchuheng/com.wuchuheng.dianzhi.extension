import { describe, expect, it } from 'vitest'
import { isNearBottom, SCROLL_GUARD_THRESHOLD } from '@/content/views/scroll-guard'

function container(
  overrides: Partial<{ scrollTop: number; scrollHeight: number; clientHeight: number }> = {}
) {
  return { scrollTop: 0, scrollHeight: 1000, clientHeight: 300, ...overrides }
}

describe('isNearBottom', () => {
  it('exposes the 50px pin threshold used by the content chat scroll guard', () => {
    expect(SCROLL_GUARD_THRESHOLD).toBe(50)
  })

  it('is pinned while the distance to the bottom is within the threshold', () => {
    expect(isNearBottom(container({ scrollTop: 700 }))).toBe(true) // gap 0
    expect(isNearBottom(container({ scrollTop: 650 }))).toBe(true) // gap 50
  })

  it('is unpinned once the distance to the bottom exceeds the threshold', () => {
    expect(isNearBottom(container({ scrollTop: 649 }))).toBe(false) // gap 51
    expect(isNearBottom(container({ scrollTop: 400 }))).toBe(false) // gap 300
  })

  it('treats a view shorter than its container as pinned', () => {
    expect(isNearBottom(container({ scrollHeight: 200 }))).toBe(true)
  })
})
