import { describe, expect, it } from 'vitest'
import { computePopoverMotionStyle } from '@/content/popover/motion'

describe('popover selection-origin motion geometry', () => {
  it('maps the popover center and scale to the selected word rectangle', () => {
    expect(
      computePopoverMotionStyle(
        { left: 400, right: 460, top: 100, bottom: 120 },
        { x: 300, y: 126, width: 380, arrowX: 130, direction: 'below' },
        280
      )
    ).toEqual({
      '--dz-motion-x': '-60px',
      '--dz-motion-y': '-156px',
      '--dz-motion-scale-x': '0.1579',
      '--dz-motion-scale-y': '0.0714',
    })
  })

  it('keeps a usable deformation for collapsed or degenerate anchors', () => {
    expect(
      computePopoverMotionStyle(
        { left: 420, right: 420, top: 110, bottom: 110 },
        { x: 300, y: 126, width: 380, arrowX: 130, direction: 'below' },
        280
      )
    ).toMatchObject({
      '--dz-motion-scale-x': '0.08',
      '--dz-motion-scale-y': '0.04',
    })
  })
})
