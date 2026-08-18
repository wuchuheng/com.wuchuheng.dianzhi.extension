import { DianzhiError } from '@/dianzhi/domain/errors'
import type { MessageRole } from '@/dianzhi/domain/protocol'
import type { ProviderSettings } from '@/dianzhi/domain/types'

export interface ProviderMessage {
  role: MessageRole
  content: string
}

export interface ProviderRequestInput {
  provider: ProviderSettings
  messages: readonly ProviderMessage[]
}

function parseExtraBody(source: string): Record<string, unknown> {
  if (!source.trim()) return {}
  try {
    const parsed = JSON.parse(source) as unknown
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error()
    return parsed as Record<string, unknown>
  } catch {
    throw new DianzhiError({
      code: 'SETTINGS_INVALID',
      message: 'Extra provider request fields must be a valid JSON object.',
      context: { field: 'provider.extraBody' },
    })
  }
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`
  return url.toString()
}

export function buildRequestBody(input: ProviderRequestInput): Record<string, unknown> {
  const { provider } = input
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: input.messages.map((message) => ({ ...message })),
    temperature: provider.temperature,
    stream: true,
    enable_thinking: provider.reasoningEnabled,
  }

  if (provider.thinkingParam === 'enable_thinking') {
    body.enable_thinking = provider.reasoningEnabled
  } else if (provider.reasoningEnabled) {
    body.reasoning_effort = provider.reasoningEffort
  }

  return { ...body, ...parseExtraBody(provider.extraBody) }
}
