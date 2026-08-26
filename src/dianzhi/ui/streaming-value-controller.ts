export interface StreamingValueControllerOptions {
  min?: number
  max?: number
  minimumSpeed?: number
  maximumSpeed?: number
  rateMemoryMs?: number
}

const DEFAULT_MAXIMUM_VALUE = Number.POSITIVE_INFINITY
const DEFAULT_MINIMUM_SPEED = 80
const DEFAULT_MAXIMUM_SPEED = 1600
const DEFAULT_RATE_MEMORY_MS = 260

/**
 * Interpolates a numeric value toward an observed target at a speed that tracks
 * recent target growth, so fast growth (a token stream) keeps up while slow
 * growth glides gently. Pure math — no DOM. Used for the content popover's
 * panel height and the Side Panel's chat scroll position.
 */
export function createStreamingValueController(
  initialValue: number,
  options: StreamingValueControllerOptions = {}
) {
  const max = options.max ?? DEFAULT_MAXIMUM_VALUE
  const min = Math.min(options.min ?? 0, max)
  const minimumSpeed = options.minimumSpeed ?? DEFAULT_MINIMUM_SPEED
  const maximumSpeed = options.maximumSpeed ?? DEFAULT_MAXIMUM_SPEED
  const rateMemoryMs = options.rateMemoryMs ?? DEFAULT_RATE_MEMORY_MS
  let value = Math.min(Math.max(initialValue, min), max)
  let target = value
  let recentGrowthRate = 0
  let lastObservedTarget = value
  let lastObservedAt: number | null = null
  let lastAdvancedAt: number | null = null

  function observeTarget(nextTarget: number, now: number) {
    target = Math.min(Math.max(nextTarget, min), max)
    if (lastObservedAt !== null && now > lastObservedAt) {
      const elapsed = now - lastObservedAt
      const growth = Math.max(0, target - lastObservedTarget)
      const decay = Math.exp(-elapsed / rateMemoryMs)
      const instantRate = (growth / elapsed) * 1_000
      recentGrowthRate = recentGrowthRate * decay + instantRate * (1 - decay)
    }
    lastObservedTarget = target
    lastObservedAt = now
  }

  function advance(now: number): number {
    if (lastAdvancedAt === null) {
      lastAdvancedAt = now
      return value
    }
    const elapsed = Math.max(0, now - lastAdvancedAt)
    lastAdvancedAt = now
    if (value === target) return value
    const speed = Math.min(Math.max(recentGrowthRate, minimumSpeed), maximumSpeed)
    const distance = Math.min(speed * (elapsed / 1_000), Math.abs(target - value))
    value += Math.sign(target - value) * distance
    return value
  }

  function jumpToTarget(): number {
    value = target
    return value
  }

  function setValue(nextValue: number) {
    value = Math.min(Math.max(nextValue, min), max)
    target = value
  }

  function isSettled() {
    return value === target
  }

  function getValue() {
    return value
  }

  return { advance, getValue, isSettled, jumpToTarget, observeTarget, setValue }
}
