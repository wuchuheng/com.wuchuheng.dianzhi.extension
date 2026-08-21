export interface StreamingHeightControllerOptions {
  minHeight?: number
  maxHeight?: number
  minimumSpeed?: number
  maximumSpeed?: number
  rateMemoryMs?: number
}

const DEFAULT_MAXIMUM_HEIGHT = Number.POSITIVE_INFINITY
const DEFAULT_MINIMUM_SPEED = 80
const DEFAULT_MAXIMUM_SPEED = 1_600
const DEFAULT_RATE_MEMORY_MS = 260

export function createStreamingHeightController(
  initialHeight: number,
  options: StreamingHeightControllerOptions = {}
) {
  const maxHeight = options.maxHeight ?? DEFAULT_MAXIMUM_HEIGHT
  const minHeight = Math.min(options.minHeight ?? 0, maxHeight)
  const minimumSpeed = options.minimumSpeed ?? DEFAULT_MINIMUM_SPEED
  const maximumSpeed = options.maximumSpeed ?? DEFAULT_MAXIMUM_SPEED
  const rateMemoryMs = options.rateMemoryMs ?? DEFAULT_RATE_MEMORY_MS
  let height = Math.min(Math.max(initialHeight, minHeight), maxHeight)
  let target = height
  let recentGrowthRate = 0
  let lastObservedTarget = height
  let lastObservedAt: number | null = null
  let lastAdvancedAt: number | null = null

  function observeTarget(nextTarget: number, now: number) {
    target = Math.min(Math.max(nextTarget, minHeight), maxHeight)
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
      return height
    }
    const elapsed = Math.max(0, now - lastAdvancedAt)
    lastAdvancedAt = now
    if (height === target) return height
    const speed = Math.min(Math.max(recentGrowthRate, minimumSpeed), maximumSpeed)
    const distance = Math.min(speed * (elapsed / 1_000), Math.abs(target - height))
    height += Math.sign(target - height) * distance
    return height
  }

  function jumpToTarget(): number {
    height = target
    return height
  }

  function isSettled() {
    return height === target
  }

  function getHeight() {
    return height
  }

  return { advance, getHeight, isSettled, jumpToTarget, observeTarget }
}
