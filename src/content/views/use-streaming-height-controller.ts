import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { createStreamingValueController } from '@/dianzhi/ui/streaming-value-controller'

interface UseStreamingHeightControllerOptions {
  panelRef: RefObject<HTMLDivElement | null>
  visible: boolean
  targetVersion: unknown
  expanded: boolean
  mode: 'card' | 'chat'
  minimumHeight: number
  maximumHeight: number
  reducedMotion: boolean
  onHeightChange(height: number): void
}

export function useStreamingHeightController({
  panelRef,
  visible,
  targetVersion,
  expanded,
  mode,
  minimumHeight,
  maximumHeight,
  reducedMotion,
  onHeightChange,
}: UseStreamingHeightControllerOptions) {
  const controllerRef = useRef(
    createStreamingValueController(minimumHeight, {
      min: minimumHeight,
      max: maximumHeight,
    })
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
    const panel = panelRef.current
    if (!visible || !panel) {
      previouslyVisibleRef.current = false
      return stopAnimation
    }

    const now = performance.now()
    const previousHeight = controllerRef.current.getValue()
    panel.style.height = 'auto'
    const targetHeight = Math.min(Math.max(panel.offsetHeight, minimumHeight), maximumHeight)
    panel.style.height = `${previousHeight}px`

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
      const height = controllerRef.current.advance(frameNow)
      onHeightChange(height)
      if (!controllerRef.current.isSettled()) {
        animationFrameRef.current = window.requestAnimationFrame(animate)
      }
    }
    animationFrameRef.current = window.requestAnimationFrame(animate)
    return stopAnimation
  }, [
    expanded,
    maximumHeight,
    minimumHeight,
    mode,
    onHeightChange,
    panelRef,
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
