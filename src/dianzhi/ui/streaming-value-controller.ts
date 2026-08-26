export interface StreamingValueControllerOptions {
  min?: number
  max?: number
  minimumSpeed?: number
  maximumSpeed?: number
  rateMemoryMs?: number
}

export interface ContinuousGrowthControllerOptions {
  followTimeMs?: number
  cruiseSpeed?: number
  maximumSpeed?: number
  accelerationPerSecond?: number
  decelerationPerSecond?: number
}

const DEFAULT_MAXIMUM_VALUE = Number.POSITIVE_INFINITY
const DEFAULT_MINIMUM_SPEED = 80
const DEFAULT_MAXIMUM_SPEED = 1600
const DEFAULT_RATE_MEMORY_MS = 260

/**
 * Continuously chases a rendered streaming message's natural height. The
 * controller stays alive at a cruise speed for the whole generation, so short
 * token gaps do not create separate stop-start animation cycles. Once the
 * stream completes, it drains the final backlog and decelerates to rest.
 */
export function createContinuousGrowthController(
  initialValue: number,
  options: ContinuousGrowthControllerOptions = {}
) {
  const followTimeSeconds = (options.followTimeMs ?? 400) / 1_000
  const cruiseSpeed = options.cruiseSpeed ?? 40
  const maximumSpeed = Math.max(options.maximumSpeed ?? 480, cruiseSpeed)
  const accelerationPerSecond = options.accelerationPerSecond ?? 1_200
  const decelerationPerSecond = options.decelerationPerSecond ?? 600
  let value = Math.max(0, initialValue)
  let target = value
  let speed = 0
  let streaming = false
  let lastAdvancedAt: number | null = null

  function setStreaming(nextStreaming: boolean, now: number) {
    streaming = nextStreaming
    if (lastAdvancedAt === null) lastAdvancedAt = now
  }

  function advance(now: number): number {
    if (lastAdvancedAt === null) {
      lastAdvancedAt = now
      return value
    }
    const elapsedSeconds = Math.max(0, now - lastAdvancedAt) / 1_000
    lastAdvancedAt = now
    let backlog = Math.max(0, target - value)
    if (!streaming && backlog <= 0.5) {
      value = target
      backlog = 0
    }
    const catchUpSpeed = backlog / followTimeSeconds
    const desiredSpeed = Math.min(
      maximumSpeed,
      backlog > 0
        ? Math.max(streaming ? cruiseSpeed : 0, catchUpSpeed)
        : streaming
          ? cruiseSpeed
          : 0
    )
    const speedDelta =
      desiredSpeed > speed
        ? accelerationPerSecond * elapsedSeconds
        : decelerationPerSecond * elapsedSeconds
    speed += Math.sign(desiredSpeed - speed) * Math.min(Math.abs(desiredSpeed - speed), speedDelta)
    value = Math.min(target, value + speed * elapsedSeconds)
    return value
  }

  return {
    advance,
    getValue: () => value,
    getSpeed: () => speed,
    isRunning: () => streaming || value < target || speed > 0,
    jumpToTarget: () => {
      value = target
      speed = 0
      return value
    },
    observeTarget: (nextTarget: number) => {
      target = Math.max(0, nextTarget)
      if (target < value) value = target
    },
    setStreaming,
  }
}

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
