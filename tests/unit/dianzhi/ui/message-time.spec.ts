import { describe, expect, it } from 'vitest'
import { formatMessageTime } from '@/dianzhi/ui/message-time'

// Build inputs from local time so the assertion is independent of the test
// machine's timezone; pin the locale so the rendered string is deterministic.
function localIso(hour: number, minute: number, second: number, day = 5) {
  return new Date(2026, 2, day, hour, minute, second).toISOString()
}

describe('formatMessageTime', () => {
  it('formats an ISO timestamp as a compact 24-hour time', () => {
    expect(formatMessageTime(localIso(14, 7, 9), 'en-GB')).toBe('14:07:09')
    expect(formatMessageTime(localIso(9, 5, 3), 'en-GB')).toBe('09:05:03')
  })

  it('returns an empty string for malformed timestamps', () => {
    expect(formatMessageTime('not-a-date', 'en-GB')).toBe('')
    expect(formatMessageTime('', 'en-GB')).toBe('')
  })
})
