import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createContinuousGrowthController } from './streaming-value-controller'

type GrowthController = ReturnType<typeof createContinuousGrowthController>

export function StreamingMessageGrowth({
  children,
  streaming,
  reducedMotion,
  onHeightDelta,
}: {
  children: ReactNode
  streaming: boolean
  reducedMotion: boolean
  onHeightDelta?(delta: number): void
}) {
  const contentRef = useRef<HTMLDivElement | null>(null)
  const controllerRef = useRef<GrowthController | null>(null)
  const frameRef = useRef<number | null>(null)
  const committedHeightRef = useRef<number | null>(null)
  const [displayedHeight, setDisplayedHeight] = useState<number | null>(null)

  const animate = useCallback(function animateFrame(now: number) {
    const controller = controllerRef.current
    if (!controller) {
      frameRef.current = null
      return
    }
    setDisplayedHeight(controller.advance(now))
    if (controller.isRunning()) {
      frameRef.current = window.requestAnimationFrame(animateFrame)
    } else {
      frameRef.current = null
      setDisplayedHeight(null)
    }
  }, [])

  const ensureAnimation = useCallback(() => {
    if (frameRef.current === null) frameRef.current = window.requestAnimationFrame(animate)
  }, [animate])

  useEffect(() => {
    const controller = controllerRef.current
    if (!controller) return
    controller.setStreaming(streaming, performance.now())
    if (reducedMotion) {
      setDisplayedHeight(controller.jumpToTarget())
      return
    }
    ensureAnimation()
  }, [ensureAnimation, reducedMotion, streaming])

  useEffect(() => {
    const content = contentRef.current
    if (!content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const measuredHeight = entries[0]?.contentRect.height
      if (measuredHeight === undefined || measuredHeight <= 0) return
      let controller = controllerRef.current
      if (!controller) {
        controller = createContinuousGrowthController(measuredHeight)
        controller.setStreaming(streaming, performance.now())
        controllerRef.current = controller
        setDisplayedHeight(streaming ? measuredHeight : null)
        if (streaming && !reducedMotion) ensureAnimation()
        return
      }
      controller.observeTarget(measuredHeight)
      if (reducedMotion) {
        setDisplayedHeight(controller.jumpToTarget())
      } else {
        ensureAnimation()
      }
    })
    observer.observe(content)
    return () => observer.disconnect()
  }, [ensureAnimation, reducedMotion, streaming])

  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
    },
    []
  )

  useLayoutEffect(() => {
    if (displayedHeight === null) {
      committedHeightRef.current = null
      return
    }
    const previousHeight = committedHeightRef.current
    committedHeightRef.current = displayedHeight
    if (previousHeight !== null && displayedHeight > previousHeight) {
      onHeightDelta?.(displayedHeight - previousHeight)
    }
  }, [displayedHeight, onHeightDelta])

  return (
    <div
      className="dz-streaming-message-growth"
      style={displayedHeight === null ? undefined : { height: displayedHeight }}
    >
      <div ref={contentRef} className="dz-streaming-message-growth-content">
        {children}
      </div>
    </div>
  )
}
