const MIN_DURATION_MS = 100
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u
const encoder = new TextEncoder()

/**
 * Provides a provider-neutral UI estimate only; it is not a billing token count.
 */
export function estimateOutputTokens(text: string): number {
  let cjk = 0
  let remainder = ''
  for (const point of text) {
    if (CJK.test(point)) cjk += 1
    else remainder += point
  }
  return cjk + Math.ceil(encoder.encode(remainder).byteLength / 4)
}

export function calculateEstimatedThroughputTps(text: string, durationMs: number): number | null {
  const tokens = estimateOutputTokens(text)
  if (tokens === 0) return null
  return Math.max(1, Math.round(tokens / (Math.max(durationMs, MIN_DURATION_MS) / 1_000)))
}
