import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type { AnchorRect, Placement } from './placement'

export type PopoverMotionPhase = 'hidden' | 'opening' | 'open' | 'relocating' | 'closing'
export type PopoverMotionStyle = CSSProperties & Record<`--dz-motion-${string}`, string>

export const POPOVER_ENTER_MS = 260
export const POPOVER_EXIT_MS = 220

export function computePopoverMotionStyle(
  anchor: AnchorRect,
  placement: Placement,
  panelHeight: number
): PopoverMotionStyle {
  const panelWidth = Math.max(1, placement.width)
  const height = Math.max(1, panelHeight)
  const anchorWidth = Math.max(0, anchor.right - anchor.left)
  const anchorHeight = Math.max(0, anchor.bottom - anchor.top)
  const anchorCenterX = (anchor.left + anchor.right) / 2
  const anchorCenterY = (anchor.top + anchor.bottom) / 2
  const panelCenterX = placement.x + panelWidth / 2
  const panelCenterY = placement.y + height / 2
  const compact = (value: number) => String(Number(value.toFixed(4)))

  return {
    '--dz-motion-x': `${compact(anchorCenterX - panelCenterX)}px`,
    '--dz-motion-y': `${compact(anchorCenterY - panelCenterY)}px`,
    '--dz-motion-scale-x': compact(Math.max(0.08, Math.min(0.35, anchorWidth / panelWidth))),
    '--dz-motion-scale-y': compact(Math.max(0.04, Math.min(0.12, anchorHeight / height))),
  }
}

export function usePopoverMotion(reducedMotion: boolean) {
  const [phase, setPhase] = useState<PopoverMotionPhase>('hidden')
  const phaseRef = useRef<PopoverMotionPhase>('hidden')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const completionRef = useRef<(() => void) | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    timerRef.current = null
  }, [])

  const moveTo = useCallback((next: PopoverMotionPhase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const open = useCallback(() => {
    clearTimer()
    completionRef.current = null
    if (reducedMotion) {
      moveTo('open')
      return
    }
    moveTo('opening')
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      if (phaseRef.current === 'opening') moveTo('open')
    }, POPOVER_ENTER_MS)
  }, [clearTimer, moveTo, reducedMotion])

  const close = useCallback(
    (onComplete: () => void) => {
      if (phaseRef.current === 'hidden') {
        onComplete()
        return
      }
      if (phaseRef.current === 'closing') return
      clearTimer()
      completionRef.current = onComplete
      const finish = () => {
        timerRef.current = null
        if (phaseRef.current !== 'closing') return
        moveTo('hidden')
        const completion = completionRef.current
        completionRef.current = null
        completion?.()
      }
      moveTo('closing')
      if (reducedMotion) finish()
      else timerRef.current = setTimeout(finish, POPOVER_EXIT_MS)
    },
    [clearTimer, moveTo, reducedMotion]
  )

  const relocate = useCallback(
    (durationMs: number) => {
      clearTimer()
      completionRef.current = null
      if (reducedMotion) {
        moveTo('open')
        return
      }
      moveTo('relocating')
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        if (phaseRef.current === 'relocating') moveTo('open')
      }, durationMs)
    },
    [clearTimer, moveTo, reducedMotion]
  )

  useEffect(
    () => () => {
      clearTimer()
      completionRef.current = null
    },
    [clearTimer]
  )

  return { phase, open, close, relocate }
}
