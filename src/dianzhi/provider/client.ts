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

export async function streamChat(
  input: StreamChatInput,
  dependencies: StreamChatDependencies
): Promise<void> {
  let response: Response
  try {
    response = await dependencies.fetch(buildChatCompletionsUrl(input.provider.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${input.provider.apiKey}`,
      },
      body: JSON.stringify(buildRequestBody(input)),
      signal: input.signal,
    })
  } catch (error) {
    if (isAbortError(error)) throw error
    if (error instanceof DianzhiError) throw error
    throw new DianzhiError({
      code: 'PROVIDER_STREAM_ERROR',
      message: 'The provider request could not be started.',
    })
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new DianzhiError({
      code: 'PROVIDER_HTTP_ERROR',
      message: providerHttpMessage(response.status, body, input.provider.apiKey),
      context: { status: response.status },
    })
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
