import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { createStreamingValueController } from './streaming-value-controller'

export interface UseStreamingHeightOptions {
  elementRef: RefObject<HTMLElement | null>
  visible: boolean
  /** Any change re-measures the element's natural height and re-chases it. */
  targetVersion: unknown
  minimumHeight?: number
  maximumHeight?: number
  reducedMotion: boolean
  onHeightChange(height: number): void
}

/**
 * Smoothly sizes an element toward its natural content height whenever content
 * changes, at a rate adapted to recent growth — the content popover's panel and
 * the Side Panel's provider-setup panel both use it. `minimumHeight` defaults to
 * 0 and `maximumHeight` to unbounded, so callers that need no cap (the Side
 * Panel) simply omit it. The caller owns where the height is applied.
 */
export function useStreamingHeight({
  elementRef,
  visible,
  targetVersion,
  minimumHeight = 0,
  maximumHeight = Number.POSITIVE_INFINITY,
  reducedMotion,
  onHeightChange,
}: UseStreamingHeightOptions) {
  const controllerRef = useRef(
    createStreamingValueController(minimumHeight, { min: minimumHeight, max: maximumHeight })
  )
  const animationFrameRef = useRef<number | null>(null)
  const previouslyVisibleRef = useRef(false)

  useLayoutEffect(() => {
    const stopAnimation = () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
        animationFrameRef.current = null
      }
    }
    stopAnimation()
    const element = elementRef.current
    if (!visible || !element) {
      previouslyVisibleRef.current = false
      return stopAnimation
    }

    const now = performance.now()
    const previousHeight = controllerRef.current.getValue()
    element.style.height = 'auto'
    const targetHeight = Math.min(Math.max(element.offsetHeight, minimumHeight), maximumHeight)
    element.style.height = `${previousHeight}px`

    if (!previouslyVisibleRef.current) {
      controllerRef.current = createStreamingValueController(targetHeight, {
        min: minimumHeight,
        max: maximumHeight,
      })
      onHeightChange(targetHeight)
      previouslyVisibleRef.current = true
      return stopAnimation
    }

    controllerRef.current.observeTarget(targetHeight, now)
    if (reducedMotion) {
      onHeightChange(controllerRef.current.jumpToTarget())
      return stopAnimation
    }

    const animate = (frameNow: number) => {
      onHeightChange(controllerRef.current.advance(frameNow))
      if (!controllerRef.current.isSettled()) {
        animationFrameRef.current = window.requestAnimationFrame(animate)
      }
    }
    animationFrameRef.current = window.requestAnimationFrame(animate)
    return stopAnimation
  }, [
    elementRef,
    maximumHeight,
    minimumHeight,
    onHeightChange,
    reducedMotion,
    targetVersion,
    visible,
  ])

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current)
      }
    },
    []
  )
}
