// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { mergeSettings } from '../../../src/dianzhi/domain/settings'
import { buildChatCompletionsUrl, buildRequestBody } from '../../../src/dianzhi/provider/request'

const messages = [
  { role: 'user' as const, content: 'first' },
  { role: 'assistant' as const, content: 'second' },
  { role: 'user' as const, content: 'third' },
]

describe('provider request builder', () => {
  it.each([
    ['https://api.example.com/v1', 'https://api.example.com/v1/chat/completions'],
    ['https://api.example.com/v1/', 'https://api.example.com/v1/chat/completions'],
    ['https://api.example.com/v1/chat/completions', 'https://api.example.com/v1/chat/completions'],
  ])('joins %s to the chat completions endpoint', (baseUrl, expected) => {
    expect(buildChatCompletionsUrl(baseUrl)).toBe(expected)
  })

  it('preserves ordered messages and sends the default reasoning effort only when enabled', () => {
    const provider = mergeSettings({
      provider: { reasoningEnabled: true, reasoningEffort: 'high' },
    }).provider

    expect(buildRequestBody({ provider, messages })).toEqual({
      model: provider.model,
      messages,
      temperature: provider.temperature,
      stream: true,
      reasoning_effort: 'high',
    })
    expect(
      buildRequestBody({ provider: { ...provider, reasoningEnabled: false }, messages })
    ).not.toHaveProperty('reasoning_effort')
  })

  it.each([true, false])(
    'sends enable_thinking=%s and omits reasoning_effort in gateway mode',
    (reasoningEnabled) => {
      const provider = mergeSettings({
        provider: { thinkingParam: 'enable_thinking', reasoningEnabled },
      }).provider
      const body = buildRequestBody({ provider, messages })

      expect(body.enable_thinking).toBe(reasoningEnabled)
      expect(body).not.toHaveProperty('reasoning_effort')
    }
  )

  it('merges the JSON escape hatch last', () => {
    const provider = mergeSettings({
      provider: {
        extraBody: '{"temperature":0.2,"top_p":0.8,"stream":false}',
      },
    }).provider

    expect(buildRequestBody({ provider, messages })).toMatchObject({
      temperature: 0.2,
      top_p: 0.8,
      stream: false,
    })
  })
})
