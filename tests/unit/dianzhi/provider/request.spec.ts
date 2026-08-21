import { describe, expect, it } from 'vitest'

import { DEFAULT_SETTINGS } from '@/dianzhi/domain/settings'
import { buildRequestBody } from '@/dianzhi/provider/request'

const messages = [{ role: 'user' as const, content: 'Hello' }]

describe('buildRequestBody', () => {
  it("uses OpenRouter's normalized reasoning object and no provider-specific fields", () => {
    const body = buildRequestBody({
      provider: {
        ...DEFAULT_SETTINGS.provider,
        baseUrl: 'https://openrouter.ai/api/v1',
        reasoningEnabled: true,
      },
      messages,
    })

    expect(body).toMatchObject({ reasoning: { enabled: true } })
    expect(body).not.toHaveProperty('enable_thinking')
    expect(body).not.toHaveProperty('reasoning_effort')
  })

  it('maps a selected reasoning strength to OpenRouter effort', () => {
    const body = buildRequestBody({
      provider: {
        ...DEFAULT_SETTINGS.provider,
        baseUrl: 'https://openrouter.ai/api/v1',
        reasoningEnabled: true,
        reasoningEffort: 'high',
      },
      messages,
    })

    expect(body).toMatchObject({ reasoning: { effort: 'high' } })
  })

  it('does not send a reasoning dialect to an unknown provider when reasoning is off', () => {
    const body = buildRequestBody({
      provider: {
        ...DEFAULT_SETTINGS.provider,
        baseUrl: 'https://example.invalid/v1',
        reasoningEnabled: false,
      },
      messages,
    })

    expect(body).not.toHaveProperty('enable_thinking')
    expect(body).not.toHaveProperty('reasoning_effort')
    expect(body).not.toHaveProperty('reasoning')
  })

  it('uses the Qwen gateway reasoning switch without OpenRouter or OpenAI fields', () => {
    const body = buildRequestBody({
      provider: {
        ...DEFAULT_SETTINGS.provider,
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        reasoningEnabled: true,
      },
      messages,
    })

    expect(body).toHaveProperty('enable_thinking', true)
    expect(body).not.toHaveProperty('reasoning')
    expect(body).not.toHaveProperty('reasoning_effort')
  })

  it.each(['enable_thinking', 'include_reasoning'])('rejects advanced JSON field %s', (field) => {
    expect(() =>
      buildRequestBody({
        provider: {
          ...DEFAULT_SETTINGS.provider,
          extraBody: JSON.stringify({ [field]: true }),
        },
        messages,
      })
    ).toThrow('Reasoning request fields are managed by the Reasoning switch.')
  })
})
