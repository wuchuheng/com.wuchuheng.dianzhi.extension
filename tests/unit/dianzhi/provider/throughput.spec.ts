import { describe, expect, it } from 'vitest'
import * as throughput from '@/dianzhi/provider/throughput'

type ThroughputModule = {
  estimateOutputTokens(text: string): number
  calculateEstimatedThroughputTps(text: string, durationMs: number): number | null
}

const implementation = throughput as typeof throughput & Partial<ThroughputModule>

describe('estimated provider throughput', () => {
  it('counts CJK code points and groups remaining UTF-8 bytes by four', () => {
    expect(implementation.estimateOutputTokens?.('你好')).toBe(2)
    expect(implementation.estimateOutputTokens?.('abcdefgh')).toBe(2)
    expect(implementation.estimateOutputTokens?.('你好abcd')).toBe(3)
  })

  it('returns no speed without output and floors tiny durations', () => {
    expect(implementation.calculateEstimatedThroughputTps?.('', 1_000)).toBeNull()
    expect(implementation.calculateEstimatedThroughputTps?.('abcdefgh', 1_000)).toBe(2)
    expect(implementation.calculateEstimatedThroughputTps?.('abcdefgh', 0)).toBe(20)
  })
})
