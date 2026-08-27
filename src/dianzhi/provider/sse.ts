import { DianzhiError } from '@/dianzhi/domain/errors'

export interface ProviderDelta {
  kind: 'content' | 'reasoning'
  delta: string
}

export interface SseHandlers {
  onDelta(delta: ProviderDelta): void
  onDone(signal: StreamCompletionSignal): void
}

export type StreamCompletionSignal = 'done_marker' | 'finish_reason' | 'response_end'

export interface SseParser {
  readonly done: boolean
  push(chunk: string): void
  finish(): void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function streamError(message: string): DianzhiError {
  return new DianzhiError({ code: 'PROVIDER_STREAM_ERROR', message })
}

export function createSseParser(handlers: SseHandlers): SseParser {
  let buffer = ''
  let dataLines: string[] = []
  let done = false

  const complete = (signal: StreamCompletionSignal) => {
    if (done) return
    done = true
    handlers.onDone(signal)
  }

  const dispatchEvent = () => {
    if (dataLines.length === 0 || done) {
      dataLines = []
      return
    }
    const data = dataLines.join('\n')
    dataLines = []
    if (data.trim() === '[DONE]') {
      complete('done_marker')
      return
    }

    let payload: unknown
    try {
      payload = JSON.parse(data) as unknown
    } catch {
      throw streamError('The provider returned malformed streaming JSON.')
    }
    if (!isRecord(payload)) throw streamError('The provider returned an invalid stream event.')
    if (payload.error !== undefined) {
      throw streamError('The provider reported an error while streaming.')
    }
    if (!Array.isArray(payload.choices)) return
    let hasFinishReason = false
    for (const choice of payload.choices) {
      if (!isRecord(choice) || !isRecord(choice.delta)) continue
      if (typeof choice.delta.content === 'string' && choice.delta.content) {
        handlers.onDelta({ kind: 'content', delta: choice.delta.content })
      }
      if (typeof choice.delta.reasoning_content === 'string' && choice.delta.reasoning_content) {
        handlers.onDelta({ kind: 'reasoning', delta: choice.delta.reasoning_content })
      }
      if (typeof choice.finish_reason === 'string' && choice.finish_reason) hasFinishReason = true
    }
    if (hasFinishReason) complete('finish_reason')
  }

  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (!line) {
      dispatchEvent()
      return
    }
    if (line.startsWith(':')) return
    if (line === 'data') dataLines.push('')
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).replace(/^ /, ''))
  }

  return {
    get done() {
      return done
    },
    push(chunk: string) {
      if (done || !chunk) return
      buffer += chunk
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        processLine(buffer.slice(0, newline))
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
    },
    finish() {
      if (done) return
      if (buffer) processLine(buffer)
      buffer = ''
      dispatchEvent()
      complete('response_end')
    },
  }
}
