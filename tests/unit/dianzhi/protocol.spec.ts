import { describe, expect, it } from 'vitest'
import { parseConversationCommand, parseToolsCommand } from '@/dianzhi/domain/protocol'
import { parseSelectionRoute, parseToolShortcut } from '@/dianzhi/domain/ui-session-protocol'

function selectionRequest(selectedText: string, contextText: string) {
  return {
    requestId: 'r-selection-route',
    type: 'selection.route' as const,
    payload: { selectedText, contextText },
  }
}

function toolIndexRequest(index: number) {
  return {
    requestId: 'r-select-tool',
    type: 'shortcut.selectTool' as const,
    payload: { index },
  }
}

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

describe('parseToolsCommand: tools.delete', () => {
  const requestId = 'r-tools-delete'

  it('accepts a positive integer id', () => {
    const result = parseToolsCommand({
      type: 'tools.delete',
      requestId,
      payload: { id: 5 },
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value).toMatchObject({ type: 'tools.delete', payload: { id: 5 } })
    }
  })

  it('rejects a non-positive id', () => {
    const result = parseToolsCommand({
      type: 'tools.delete',
      requestId,
      payload: { id: 0 },
    })
    expect(result.ok).toBe(false)
  })

  it('rejects a missing id', () => {
    const result = parseToolsCommand({ type: 'tools.delete', requestId, payload: {} })
    expect(result.ok).toBe(false)
  })
})

describe('UI session request parsers', () => {
  it('accepts selection routing content without caller-owned browser identity', () => {
    expect(parseSelectionRoute(selectionRequest('run', 'run fast')).ok).toBe(true)
  })

  it('rejects caller-supplied tab identity during selection routing', () => {
    expect(
      parseSelectionRoute({
        ...selectionRequest('run', 'run fast'),
        payload: { selectedText: 'run', contextText: 'run fast', tabId: 9 },
      }).ok
    ).toBe(false)
  })

  it('accepts a positive tool shortcut index and rejects zero', () => {
    expect(parseToolShortcut(toolIndexRequest(2)).ok).toBe(true)
    expect(parseToolShortcut(toolIndexRequest(0)).ok).toBe(false)
  })
})
