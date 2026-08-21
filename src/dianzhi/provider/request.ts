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

const MANAGED_REASONING_FIELDS = new Set([
  'reasoning',
  'reasoning_effort',
  'enable_thinking',
  'include_reasoning',
])

function parseExtraBody(source: string): Record<string, unknown> {
  if (!source.trim()) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(source) as unknown
  } catch {
    throw new DianzhiError({
      code: 'SETTINGS_INVALID',
      message: 'Extra provider request fields must be a valid JSON object.',
      context: { field: 'provider.extraBody' },
    })
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new DianzhiError({
      code: 'SETTINGS_INVALID',
      message: 'Extra provider request fields must be a valid JSON object.',
      context: { field: 'provider.extraBody' },
    })
  }
  const extraBody = parsed as Record<string, unknown>
  if (Object.keys(extraBody).some((key) => MANAGED_REASONING_FIELDS.has(key))) {
    throw new DianzhiError({
      code: 'SETTINGS_INVALID',
      message: 'Reasoning request fields are managed by the Reasoning switch.',
      context: { field: 'provider.extraBody' },
    })
  }
  return extraBody
}

function reasoningDialect(baseUrl: string): 'openrouter' | 'enable_thinking' | 'reasoning_effort' {
  const hostname = new URL(baseUrl).hostname.toLowerCase()
  if (hostname === 'openrouter.ai' || hostname.endsWith('.openrouter.ai')) return 'openrouter'
  if (hostname.includes('dashscope') || hostname.endsWith('.aliyuncs.com')) return 'enable_thinking'
  return 'reasoning_effort'
}

export function buildChatCompletionsUrl(baseUrl: string): string {
  const url = new URL(baseUrl)
  const path = url.pathname.replace(/\/+$/, '')
  url.pathname = path.endsWith('/chat/completions') ? path : `${path}/chat/completions`
  return url.toString()
}

export function buildRequestBody(
  input: ProviderRequestInput,
  includeReasoning = true
): Record<string, unknown> {
  const { provider } = input
  const body: Record<string, unknown> = {
    model: provider.model,
    messages: input.messages.map((message) => ({ ...message })),
    temperature: provider.temperature,
    stream: true,
  }

  const dialect = reasoningDialect(provider.baseUrl)
  if (includeReasoning && dialect === 'openrouter') {
    body.reasoning = provider.reasoningEnabled
      ? provider.reasoningEffort === 'auto'
        ? { enabled: true }
        : { effort: provider.reasoningEffort }
      : { effort: 'none' }
  } else if (includeReasoning && dialect === 'enable_thinking') {
    body.enable_thinking = provider.reasoningEnabled
  } else if (includeReasoning && provider.reasoningEnabled) {
    body.reasoning_effort =
      provider.reasoningEffort === 'auto' ? 'medium' : provider.reasoningEffort
  }

  return { ...body, ...parseExtraBody(provider.extraBody) }
}
