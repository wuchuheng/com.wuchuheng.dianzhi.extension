import { describe, expect, it } from 'vitest'
import { parseConversationCommand } from '@/dianzhi/domain/protocol'

function createCommand(selectedText: unknown, contextText = 'ctx <selected>x</selected>') {
  return { requestId: 'r-1', type: 'conversation.create', payload: { selectedText, contextText } }
}

describe('parseConversationCommand: conversation.create', () => {
  it('accepts selectedText longer than 300 chars (no length limit)', () => {
    const longText = '长'.repeat(1000)
    const result = parseConversationCommand(createCommand(longText))
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.payload.selectedText).toBe(longText)
  })

  it('accepts selectedText around the old 300 boundary', () => {
    expect(parseConversationCommand(createCommand('x'.repeat(300))).ok).toBe(true)
    expect(parseConversationCommand(createCommand('x'.repeat(301))).ok).toBe(true)
  })

  it('accepts a normal single-tag context', () => {
    const result = parseConversationCommand(
      createCommand('world', '<context>hello, <selected>world</selected></context>')
    )
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.payload.contextText).toContain('<context>')
  })

  it('rejects empty or whitespace-only selectedText', () => {
    expect(parseConversationCommand(createCommand('')).ok).toBe(false)
    expect(parseConversationCommand(createCommand('   ')).ok).toBe(false)
  })

  it('rejects non-string selectedText', () => {
    expect(parseConversationCommand(createCommand(42)).ok).toBe(false)
  })

  it('rejects empty or whitespace-only contextText', () => {
    expect(parseConversationCommand(createCommand('world', '')).ok).toBe(false)
    expect(parseConversationCommand(createCommand('world', '  ')).ok).toBe(false)
  })
})
