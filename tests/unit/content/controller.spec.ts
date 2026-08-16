// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createSelectionController } from '../../../src/content/selection/controller'

describe('selection controller', () => {
  it('respects alt-mouseup, ignores the extension host, and recomputes on scroll', () => {
    document.body.innerHTML =
      '<p id="page">English selection text.</p><div id="host">extension text</div>'
    const host = document.querySelector('#host')!
    const pageText = document.querySelector('#page')!.firstChild!
    const selection = window.getSelection()!
    const range = document.createRange()
    range.setStart(pageText, 0)
    range.setEnd(pageText, 7)
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: vi.fn(() => ({ left: 10, right: 70, top: 20, bottom: 40, width: 60, height: 20 })),
    })
    selection.removeAllRanges()
    selection.addRange(range)
    const onSelection = vi.fn()
    const onAnchorChange = vi.fn()
    const controller = createSelectionController({
      document,
      extensionHost: host,
      triggerMode: 'alt-mouseup',
      limits: { targetWords: 20, maxWords: 40, maxBlocks: 3 },
      onSelection,
      onAnchorChange,
    })
    controller.start()

    document.dispatchEvent(new MouseEvent('mouseup'))
    expect(onSelection).not.toHaveBeenCalled()
    document.dispatchEvent(new MouseEvent('mouseup', { altKey: true }))
    expect(onSelection).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('scroll'))
    expect(onAnchorChange).toHaveBeenCalledTimes(1)

    const hostText = host.firstChild!
    range.setStart(hostText, 0)
    range.setEnd(hostText, 9)
    document.dispatchEvent(new MouseEvent('mouseup', { altKey: true }))
    expect(onSelection).toHaveBeenCalledTimes(1)
    controller.stop()
  })
})
