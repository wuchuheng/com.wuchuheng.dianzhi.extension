import { describe, expect, it } from 'vitest'
import {
  parseConversationCommand,
  parseSidePanelConversationRequest,
  parseToolsCommand,
} from '@/dianzhi/domain/protocol'
import {
  parsePanelToggle,
  parseSelectionRoute,
  parseSurfaceStatus,
  parseToolShortcut,
} from '@/dianzhi/domain/ui-session-protocol'

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

function legacyCommand(type: string, payload: unknown) {
  return { requestId: 'r-legacy', type, payload }
}

describe('parseConversationCommand: legacy panel and selection commands are rejected', () => {
  it('rejects conversation.create', () => {
    expect(
      parseConversationCommand(
        legacyCommand('conversation.create', { selectedText: 'run', contextText: 'run fast' })
      ).ok
    ).toBe(false)
  })

  it('rejects conversation.ensureTool with a selection key', () => {
    expect(
      parseConversationCommand(
        legacyCommand('conversation.ensureTool', { selectionKey: 1, toolId: 2 })
      ).ok
    ).toBe(false)
  })

  it('rejects the panel lifecycle commands', () => {
    for (const type of ['panel.open', 'panel.toggle', 'panel.rendered', 'panel.close']) {
      expect(parseConversationCommand(legacyCommand(type, { conversationId: 1 })).ok).toBe(false)
    }
  })
})

describe('parseSidePanelConversationRequest', () => {
  const followup = {
    type: 'conversation.followup',
    requestId: 'followup-1',
    payload: { conversationId: 22, content: 'Why?' },
  }

  it('accepts a conversation command under a logical panel session', () => {
    expect(
      parseSidePanelConversationRequest({
        panelSessionId: 'panel-session-19',
        command: followup,
      })
    ).toEqual({
      ok: true,
      value: { panelSessionId: 'panel-session-19', command: followup },
    })
  })

  it('rejects invalid sessions, nested commands, browser identity, and extra fields', () => {
    for (const value of [
      { panelSessionId: '', command: followup },
      { panelSessionId: 'panel-session-19' },
      { panelSessionId: 'panel-session-19', command: { ...followup, payload: {} } },
      {
        panelSessionId: 'panel-session-19',
        command: { ...followup, payload: { ...followup.payload, tabId: 9 } },
      },
      { panelSessionId: 'panel-session-19', command: followup, tabId: 9 },
    ]) {
      expect(parseSidePanelConversationRequest(value).ok).toBe(false)
    }
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

  it('accepts explicit Content and Side Panel origins for panel toggles', () => {
    expect(
      parsePanelToggle({
        requestId: 'toggle-visible',
        type: 'shortcut.panelToggle',
        payload: { origin: 'contentScript', contentUIAppeared: false },
      }).ok
    ).toBe(true)
    expect(
      parsePanelToggle({
        requestId: 'toggle-panel',
        type: 'shortcut.panelToggle',
        payload: { origin: 'sidePanel', panelInstanceId: 'panel-instance-1' },
      }).ok
    ).toBe(true)
  })

  it('rejects panel toggles without a valid origin-specific payload', () => {
    for (const payload of [
      {},
      { origin: 'sidePanel' },
      { origin: 'sidePanel', panelInstanceId: '' },
      { origin: 'contentScript', contentUIAppeared: false, panelInstanceId: 'panel-instance-1' },
      { origin: 'sidePanel', panelInstanceId: 'panel-instance-1', windowId: 19 },
    ]) {
      expect(
        parsePanelToggle({ requestId: 'toggle-invalid', type: 'shortcut.panelToggle', payload }).ok
      ).toBe(false)
    }
  })

  it('accepts Side Panel lifecycle reports only with a live-capability-shaped payload', () => {
    expect(
      parseSurfaceStatus({
        requestId: 'status-panel',
        type: 'ui.surfaceStatus',
        payload: {
          status: 'appeared',
          selectionSessionId: null,
          origin: 'sidePanel',
          panelInstanceId: 'panel-instance-1',
        },
      }).ok
    ).toBe(true)
    expect(
      parseSurfaceStatus({
        requestId: 'status-invalid',
        type: 'ui.surfaceStatus',
        payload: { status: 'appeared', selectionSessionId: null, origin: 'sidePanel' },
      }).ok
    ).toBe(false)
  })
})
