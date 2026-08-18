import { describe, expect, it } from 'vitest'
import { SCROLL_PIN_THRESHOLD, isNearBottom } from '../../../src/sidepanel/scroll-pin'

describe('isNearBottom', () => {
  it('is true when the conversation is at the very bottom', () => {
    expect(isNearBottom({ scrollTop: 400, scrollHeight: 500, clientHeight: 100 })).toBe(true)
  })

  it('is true within the pin threshold', () => {
    expect(
      isNearBottom({
        scrollTop: 500 - 100 - SCROLL_PIN_THRESHOLD + 1,
        scrollHeight: 500,
        clientHeight: 100,
      })
    ).toBe(true)
  })

  it('is false once the user scrolls up beyond the threshold', () => {
    expect(isNearBottom({ scrollTop: 300, scrollHeight: 500, clientHeight: 100 })).toBe(false)
  })

  it('is true when the content fits without scrolling', () => {
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 100, clientHeight: 100 })).toBe(true)
  })
})
