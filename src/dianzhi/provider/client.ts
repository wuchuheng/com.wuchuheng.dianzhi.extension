import { DianzhiError } from '@/dianzhi/domain/errors'
import { buildChatCompletionsUrl, buildRequestBody, type ProviderRequestInput } from './request'
import { createSseParser, type ProviderDelta } from './sse'

export interface StreamChatInput extends ProviderRequestInput {
  signal: AbortSignal
}

export interface StreamChatDependencies {
  fetch: typeof globalThis.fetch
  onDelta(delta: ProviderDelta): void
  onDone(): void
}

function redactCredentials(value: string, apiKey: string): string {
  let redacted = value.replace(/Bearer\s+[^\s"']+/gi, 'Bearer [REDACTED]')
  if (apiKey) redacted = redacted.split(apiKey).join('[REDACTED]')
  return redacted
}

function providerHttpMessage(status: number, body: string, apiKey: string): string {
  let detail = ''
  try {
    const payload = JSON.parse(body) as unknown
    if (typeof payload === 'object' && payload !== null) {
      const error = (payload as Record<string, unknown>).error
      if (typeof error === 'object' && error !== null) {
        const message = (error as Record<string, unknown>).message
        if (typeof message === 'string') detail = message
      }
      const message = (payload as Record<string, unknown>).message
      if (!detail && typeof message === 'string') detail = message
      const fallback = (payload as Record<string, unknown>).detail
      if (!detail && typeof fallback === 'string') detail = fallback
    }
  } catch {
    detail = body
  }
  const safeDetail = redactCredentials(detail, apiKey).trim().slice(0, 500)
  return safeDetail
    ? `Provider request failed with HTTP ${status}: ${safeDetail}`
    : `Provider request failed with HTTP ${status}.`
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function canRetryWithoutReasoning(status: number, body: string): boolean {
  if (status !== 400 && status !== 422) return false
  return /unsupported|unknown|unrecognized|invalid (parameter|field)|not allowed|mandatory|does not support/i.test(
    body
  )
}

const reasoningFallbacks = new Set<string>()
const reasoningFieldNames = ['reasoning', 'reasoning_effort', 'enable_thinking']

function reasoningFallbackKey(input: StreamChatInput): string {
  const url = new URL(input.provider.baseUrl)
  const normalizedUrl = `${url.origin}${url.pathname.replace(/\/+$/, '')}`
  return `${normalizedUrl}\u0000${input.provider.model}\u0000${input.provider.reasoningEnabled}`
}

export async function streamChat(
  input: StreamChatInput,
  dependencies: StreamChatDependencies
): Promise<void> {
  const request = async (
    includeReasoning: boolean
  ): Promise<{ response: Response; includesReasoning: boolean }> => {
    const body = buildRequestBody(input, includeReasoning)
    try {
      const response = await dependencies.fetch(buildChatCompletionsUrl(input.provider.baseUrl), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${input.provider.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: input.signal,
      })
      return {
        response,
        includesReasoning: reasoningFieldNames.some((field) =>
          Object.prototype.hasOwnProperty.call(body, field)
        ),
      }
    } catch (error) {
      if (isAbortError(error)) throw error
      if (error instanceof DianzhiError) throw error
      const reason =
        error instanceof Error
          ? redactCredentials(error.message, input.provider.apiKey).trim().slice(0, 240)
          : ''
      throw new DianzhiError({
        code: 'PROVIDER_STREAM_ERROR',
        message: reason
          ? `The provider request could not be started: ${reason}`
          : 'The provider request could not be started.',
        ...(reason ? { context: { reason } } : {}),
      })
    }
  }

  const fallbackKey = reasoningFallbackKey(input)
  let requestResult = await request(!reasoningFallbacks.has(fallbackKey))
  let { response } = requestResult
  if (!response.ok) {
    let body = await response.text().catch(() => '')
    if (requestResult.includesReasoning && canRetryWithoutReasoning(response.status, body)) {
      requestResult = await request(false)
      response = requestResult.response
      if (response.ok) reasoningFallbacks.add(fallbackKey)
      else body = await response.text().catch(() => '')
    }
    if (!response.ok) {
      throw new DianzhiError({
        code: 'PROVIDER_HTTP_ERROR',
        message: providerHttpMessage(response.status, body, input.provider.apiKey),
        context: { status: response.status },
      })
    }
  }
  if (!response.body) {
    throw new DianzhiError({
      code: 'PROVIDER_STREAM_ERROR',
      message: 'The provider response did not contain a readable stream.',
    })
  }

  const parser = createSseParser({
    onDelta: dependencies.onDelta,
    onDone: dependencies.onDone,
  })
  const reader = response.body.getReader()
  const decoder = new TextDecoder()

  try {
    while (!parser.done) {
      const { done, value } = await reader.read()
      if (done) break
      parser.push(decoder.decode(value, { stream: true }))
    }
    if (!parser.done) {
      parser.push(decoder.decode())
      parser.finish()
    } else {
      await reader.cancel()
    }
  } catch (error) {
    if (isAbortError(error) || error instanceof DianzhiError) throw error
    throw new DianzhiError({
      code: 'PROVIDER_STREAM_ERROR',
      message: 'The provider stream ended unexpectedly.',
    })
  } finally {
    reader.releaseLock()
  }
}
