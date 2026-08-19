import { describe, expect, it } from 'vitest'
import { formatShortcut, toolShortcutNumber } from '@/dianzhi/domain/shortcuts'

function keyEvent(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

describe('toolShortcutNumber', () => {
  it('returns the index for Ctrl+Shift+Digit1..9', () => {
    expect(
      toolShortcutNumber(keyEvent({ ctrlKey: true, shiftKey: true, code: 'Digit1', key: '!' }))
    ).toBe(1)
    expect(
      toolShortcutNumber(keyEvent({ ctrlKey: true, shiftKey: true, code: 'Digit5', key: '5' }))
    ).toBe(5)
    expect(
      toolShortcutNumber(keyEvent({ ctrlKey: true, shiftKey: true, code: 'Digit9', key: '9' }))
    ).toBe(9)
  })

  it('ignores Digit0, letter keys and unnamed presses', () => {
    expect(
      toolShortcutNumber(keyEvent({ ctrlKey: true, shiftKey: true, code: 'Digit0', key: '0' }))
    ).toBeNull()
    expect(
      toolShortcutNumber(keyEvent({ ctrlKey: true, shiftKey: true, code: 'KeyA', key: 'A' }))
    ).toBeNull()
    expect(toolShortcutNumber(keyEvent({ ctrlKey: true, shiftKey: true }))).toBeNull()
  })

  it('requires Ctrl+Shift together and rejects other modifiers', () => {
    expect(toolShortcutNumber(keyEvent({ ctrlKey: true, code: 'Digit1', key: '1' }))).toBeNull()
    expect(toolShortcutNumber(keyEvent({ shiftKey: true, code: 'Digit1', key: '!' }))).toBeNull()
    expect(
      toolShortcutNumber(
        keyEvent({ ctrlKey: true, shiftKey: true, altKey: true, code: 'Digit1', key: '!' })
      )
    ).toBeNull()
    expect(
      toolShortcutNumber(
        keyEvent({ ctrlKey: true, shiftKey: true, metaKey: true, code: 'Digit1', key: '1' })
      )
    ).toBeNull()
    expect(toolShortcutNumber(keyEvent({}))).toBeNull()
  })
})

describe('formatShortcut', () => {
  it('renders modifier names and passes digit keys through', () => {
    expect(formatShortcut('Control+Shift+1')).toBe('Ctrl+Shift+1')
    expect(formatShortcut('Control+Enter')).toBe('Ctrl+Enter')
  })
})
