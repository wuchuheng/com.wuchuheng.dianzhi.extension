import { describe, expect, it } from 'vitest'
import {
  CONTENT_PORT_NAME,
  OPTIONS_TOOL_TEST_PORT_NAME,
  SIDEPANEL_PORT_NAME,
  parseConversationCommand,
  parseOptionsTestCommand,
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
    expect(OPTIONS_TOOL_TEST_PORT_NAME).toBe('dianzhi:options-tool-test')
  })
})

const VALID_PROVIDER = {
  baseUrl: 'https://example.com/v1',
  apiKey: 'sk-test',
  model: 'gpt-4o-mini',
  temperature: 0.7,
  reasoningEnabled: true,
  reasoningEffort: 'medium',
  thinkingParam: '',
  extraBody: '',
}

describe('parseOptionsTestCommand', () => {
  it('accepts a valid tool test with a full provider payload', () => {
    expect(
      parseOptionsTestCommand({
        type: 'tool.test',
        requestId: 'request-1',
        payload: { prompt: '  Explain serendipity.  ', provider: VALID_PROVIDER },
      })
    ).toEqual({
      ok: true,
      value: {
        type: 'tool.test',
        requestId: 'request-1',
        payload: { prompt: '  Explain serendipity.  ', provider: VALID_PROVIDER },
      },
    })
  })

  it('accepts a tool stop command with an empty payload', () => {
    expect(
      parseOptionsTestCommand({ type: 'tool.test.stop', requestId: 'r1', payload: {} })
    ).toEqual({
      ok: true,
      value: { type: 'tool.test.stop', requestId: 'r1', payload: {} },
    })
  })

  it.each([
    { type: 'tool.test', requestId: 'r1', payload: null },
    { type: 'tool.test', payload: { prompt: 'x', provider: VALID_PROVIDER } },
    { type: 'tool.test', requestId: '  ', payload: { prompt: 'x', provider: VALID_PROVIDER } },
    { type: 'tool.test', requestId: 'r1', payload: { prompt: '   ', provider: VALID_PROVIDER } },
    { type: 'tool.test', requestId: 'r1', payload: { provider: VALID_PROVIDER } },
    { type: 'tool.test', requestId: 'r1', payload: 'nope' },
    {
      type: 'tool.test',
      requestId: 'r1',
      payload: { prompt: 'x', provider: VALID_PROVIDER, tabId: 99 },
    },
    {
      type: 'tool.test',
      requestId: 'r1',
      payload: { prompt: 'x', provider: { ...VALID_PROVIDER, reasoningEffort: 'ultra' } },
    },
    {
      type: 'tool.test',
      requestId: 'r1',
      payload: {
        prompt: 'x',
        provider: { baseUrl: 'u', apiKey: 'k', model: 'm', extraBody: '' } as unknown,
      },
    },
    {
      type: 'tool.test',
      requestId: 'r1',
      payload: { prompt: 'x', provider: { ...VALID_PROVIDER, temperature: Number.NaN } },
    },
    {
      type: 'tool.test',
      requestId: 'r1',
      payload: { prompt: 'x', provider: { ...VALID_PROVIDER, thinkingParam: 'on' } },
    },
    { type: 'unknown', requestId: 'r1', payload: { prompt: 'x', provider: VALID_PROVIDER } },
    { type: 'tool.test', requestId: 'r1', payload: {} },
  ])('rejects invalid tool-test payload %#', (value) => {
    expect(parseOptionsTestCommand(value)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'INVALID_EVENT' }),
    })
  })

  it('rejects a stop command carrying a non-empty payload', () => {
    expect(
      parseOptionsTestCommand({ type: 'tool.test.stop', requestId: 'r1', payload: { extra: 1 } })
    ).toEqual({ ok: false, error: expect.objectContaining({ code: 'INVALID_EVENT' }) })
  })
})
