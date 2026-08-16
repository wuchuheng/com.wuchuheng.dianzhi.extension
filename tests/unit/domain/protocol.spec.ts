import { describe, expect, it } from 'vitest'
import {
  CONTENT_PORT_NAME,
  SIDEPANEL_PORT_NAME,
  parseConversationCommand,
} from '@/dianzhi/domain/protocol'

describe('parseConversationCommand', () => {
  it('accepts a valid selection command without caller-controlled tab identity', () => {
    expect(
      parseConversationCommand({
        type: 'conversation.create',
        requestId: 'request-1',
        payload: {
          selectedText: 'learning',
          contextText: '<selected>learning</selected> matters',
        },
      })
    ).toEqual({
      ok: true,
      value: {
        type: 'conversation.create',
        requestId: 'request-1',
        payload: {
          selectedText: 'learning',
          contextText: '<selected>learning</selected> matters',
        },
      },
    })
  })

  it.each([
    { type: 'conversation.sync', requestId: 'r1', payload: { conversationId: '17' } },
    { type: 'conversation.sync', requestId: 'r1', payload: { conversationId: 'uuid-17' } },
    { type: 'conversation.sync', requestId: 'r1', payload: { conversationId: 0 } },
    {
      type: 'conversation.followup',
      requestId: 'r1',
      payload: { conversationId: 1, content: ' ' },
    },
    { type: 'conversation.ensureTool', requestId: 'r1', payload: { selectionKey: 1, toolId: '' } },
    { type: 'panel.open', requestId: 'r1', payload: { conversationId: 1, tabId: 99 } },
    { type: 'panel.close', requestId: 'r1', payload: {} },
    { type: 'unknown', requestId: 'r1', payload: {} },
  ])('rejects invalid or caller-owned identity payload %#', (value) => {
    expect(parseConversationCommand(value)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'INVALID_EVENT' }),
    })
  })

  it('defines stable long-lived subscriber port names', () => {
    expect(CONTENT_PORT_NAME).toBe('dianzhi:content')
    expect(SIDEPANEL_PORT_NAME).toBe('dianzhi:sidepanel')
  })
})
