import { DianzhiError, type DianzhiErrorShape } from '@/dianzhi/domain/errors'
import type { ConversationUpdate, MessageRecord, MessageStatus } from '@/dianzhi/domain/protocol'
import type { ProviderSettings } from '@/dianzhi/domain/types'
import { streamChat as defaultStreamChat } from '@/dianzhi/provider/client'
import type { ProviderMessage } from '@/dianzhi/provider/request'
import type { ProviderDelta } from '@/dianzhi/provider/sse'
import { calculateEstimatedThroughputTps } from '@/dianzhi/provider/throughput'
import type { StreamLifecycleEvent } from '@/dianzhi/provider/client'
import type { FinalizeAssistantInput } from '@/offscreen/database/store'
import { log, logError, Scope } from '@/events/logger'

const CHECKPOINT_INTERVAL_MS = 250
const CHECKPOINT_BYTES = 1_024

export interface ProviderRunInput {
  conversationId: number
  assistant: MessageRecord
  provider: ProviderSettings
  messages: readonly ProviderMessage[]
}

export interface ProviderRunHandle {
  done: Promise<void>
  stop(): void
}

export interface ProviderRunnerDependencies {
  streamChat?: typeof defaultStreamChat
  checkpoint(messageId: number, content: string, reasoningContent: string): Promise<MessageRecord>
  finalize(messageId: number, input: FinalizeAssistantInput): Promise<MessageRecord>
  publish(update: ConversationUpdate): void | Promise<void>
  now?(): number
  setTimeout?: typeof globalThis.setTimeout
  clearTimeout?: typeof globalThis.clearTimeout
}

function errorShape(error: unknown) {
  if (error instanceof DianzhiError) return error.toJSON()
  return {
    code: 'PROVIDER_STREAM_ERROR' as const,
    message: error instanceof Error ? error.message : 'The provider stream failed.',
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function safeErrorDetails(error: unknown) {
  if (error instanceof DianzhiError) {
    return { name: error.name, code: error.code, message: error.message.slice(0, 300) }
  }
  return {
    name: error instanceof Error ? error.name : 'UnknownError',
    message: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300),
  }
}

export function createProviderRunner(dependencies: ProviderRunnerDependencies) {
  const runs = new Map<number, { controller: AbortController; token: symbol }>()
  const runStream = dependencies.streamChat ?? defaultStreamChat
  const schedule = dependencies.setTimeout ?? globalThis.setTimeout
  const cancel = dependencies.clearTimeout ?? globalThis.clearTimeout
  const now = dependencies.now ?? (() => performance.now())
  const encoder = new TextEncoder()

  function start(input: ProviderRunInput): ProviderRunHandle {
    runs.get(input.conversationId)?.controller.abort()
    const controller = new AbortController()
    const token = Symbol(`conversation-${input.conversationId}`)
    runs.set(input.conversationId, { controller, token })
    const runStartedAt = Date.now()
    const diagnosticContext = {
      conversationId: input.conversationId,
      messageId: input.assistant.id,
      providerHost: new URL(input.provider.baseUrl).hostname,
      model: input.provider.model,
    }
    const info = (message: string, phase: string, details: Record<string, unknown> = {}) =>
      log(Scope.BACKGROUND, message, {
        ...diagnosticContext,
        phase,
        elapsedMs: Date.now() - runStartedAt,
        ...details,
      })
    const failure = (
      message: string,
      phase: string,
      error: unknown,
      details: Record<string, unknown> = {}
    ) =>
      logError(Scope.BACKGROUND, message, {
        ...diagnosticContext,
        phase,
        elapsedMs: Date.now() - runStartedAt,
        ...details,
        error: safeErrorDetails(error),
      })

    info('Provider stream started.', 'start', { historyMessages: input.messages.length })

    const done = Promise.resolve().then(async () => {
      let content = input.assistant.content
      let reasoningContent = input.assistant.reasoningContent
      let checkpointedBytes = encoder.encode(content + reasoningContent).byteLength
      let checkpointChain = Promise.resolve<MessageRecord | null>(null)
      let timer: ReturnType<typeof setTimeout> | null = null
      let firstOutputAt: number | null = null

      const isCurrent = () => runs.get(input.conversationId)?.token === token

      const byteCounts = () => ({
        contentBytes: encoder.encode(content).byteLength,
        reasoningBytes: encoder.encode(reasoningContent).byteLength,
      })

      const queueCheckpoint = (reason: 'timer' | 'size') => {
        if (!isCurrent()) return
        if (timer !== null) {
          cancel(timer)
          timer = null
        }
        const nextContent = content
        const nextReasoning = reasoningContent
        checkpointedBytes = encoder.encode(nextContent + nextReasoning).byteLength
        info('Provider checkpoint queued.', 'checkpoint_queued', {
          reason,
          ...byteCounts(),
        })
        checkpointChain = checkpointChain.then(async () => {
          info('Provider checkpoint started.', 'checkpoint_started', byteCounts())
          try {
            const message = await dependencies.checkpoint(
              input.assistant.id,
              nextContent,
              nextReasoning
            )
            info('Provider checkpoint completed.', 'checkpoint_completed', byteCounts())
            return message
          } catch (error) {
            failure('Provider checkpoint failed.', 'checkpoint', error, byteCounts())
            throw error
          }
        })
      }

      const armCheckpoint = () => {
        const bytes = encoder.encode(content + reasoningContent).byteLength
        if (bytes - checkpointedBytes >= CHECKPOINT_BYTES) {
          queueCheckpoint('size')
          return
        }
        if (timer === null) timer = schedule(() => queueCheckpoint('timer'), CHECKPOINT_INTERVAL_MS)
      }

      const publishDelta = (delta: ProviderDelta) => {
        if (!isCurrent()) return
        if (firstOutputAt === null) {
          firstOutputAt = now()
          info('Provider first output received.', 'first_output', { kind: delta.kind })
        }
        if (delta.kind === 'content') content += delta.delta
        else reasoningContent += delta.delta
        info('Provider stream delta received.', 'delta', {
          kind: delta.kind,
          deltaBytes: encoder.encode(delta.delta).byteLength,
          ...byteCounts(),
        })
        void dependencies.publish({
          type: delta.kind === 'content' ? 'stream.delta' : 'stream.reasoning',
          conversationId: input.conversationId,
          messageId: input.assistant.id,
          content: delta.delta,
        })
        armCheckpoint()
      }

      const terminalThroughput = (terminalAt: number) =>
        firstOutputAt === null
          ? null
          : calculateEstimatedThroughputTps(content + reasoningContent, terminalAt - firstOutputAt)

      const reportLifecycle = (event: StreamLifecycleEvent) => {
        if (event.phase === 'terminal_signal') return
        if (event.phase === 'reader_cancel' && event.state === 'failed') {
          failure('Provider response reader cancellation failed.', 'reader_cancel', event.error, {
            state: event.state,
          })
          return
        }
        info('Provider stream lifecycle advanced.', event.phase, event)
      }

      const finalizeAndPublish = async (
        status: Extract<MessageStatus, 'completed' | 'error' | 'stopped'>,
        terminalAt: number,
        terminalError?: DianzhiErrorShape
      ) => {
        const throughput = terminalThroughput(terminalAt)
        const finalization: FinalizeAssistantInput = {
          status,
          content,
          reasoningContent,
          estimatedThroughputTps: throughput,
          ...(terminalError
            ? { errorCode: terminalError.code, errorMessage: terminalError.message }
            : {}),
        }
        info('Provider terminal persistence started.', 'finalize_started', {
          status,
          estimatedThroughputTps: throughput,
          ...byteCounts(),
        })
        let message: MessageRecord
        try {
          message = await dependencies.finalize(input.assistant.id, finalization)
          info('Provider terminal state persisted.', 'finalize_completed', {
            status: message.status,
            estimatedThroughputTps: message.estimatedThroughputTps,
            ...byteCounts(),
          })
        } catch (error) {
          const reason = safeErrorDetails(error).message
          const persistenceError: DianzhiErrorShape = {
            code: 'DB_UNAVAILABLE',
            message: `The completed response could not be saved: ${reason}`,
            context: { conversationId: input.conversationId, messageId: input.assistant.id },
          }
          failure('Provider terminal persistence failed.', 'finalize', error, {
            intendedStatus: status,
            ...byteCounts(),
          })
          if (!isCurrent()) return
          message = {
            ...input.assistant,
            content,
            reasoningContent,
            estimatedThroughputTps: throughput,
            status: 'error',
            errorCode: persistenceError.code,
            errorMessage: persistenceError.message,
            updatedAt: new Date().toISOString(),
          }
          await dependencies.publish({
            type: 'stream.error',
            conversationId: input.conversationId,
            message,
            error: persistenceError,
          })
          info('Provider terminal persistence fallback published.', 'publish_fallback', {
            status: message.status,
            errorCode: message.errorCode,
          })
          return
        }
        if (!isCurrent()) return
        const update: ConversationUpdate =
          status === 'completed'
            ? { type: 'stream.done', conversationId: input.conversationId, message }
            : status === 'stopped'
              ? { type: 'stream.stopped', conversationId: input.conversationId, message }
              : {
                  type: 'stream.error',
                  conversationId: input.conversationId,
                  message,
                  error: terminalError as DianzhiErrorShape,
                }
        try {
          await dependencies.publish(update)
          info('Provider terminal update published.', 'publish_terminal', {
            updateType: update.type,
            status: message.status,
          })
        } catch (error) {
          failure('Provider terminal update publication failed.', 'publish_terminal', error, {
            updateType: update.type,
            status: message.status,
          })
          throw error
        }
      }

      try {
        if (!input.provider.apiKey.trim() || !input.provider.model.trim()) {
          throw new DianzhiError({
            code: 'PROVIDER_NOT_CONFIGURED',
            message: 'Configure an API key and model before starting a conversation.',
          })
        }
        await runStream(
          {
            provider: input.provider,
            messages: input.messages,
            signal: controller.signal,
          },
          {
            fetch: (request, init) => globalThis.fetch(request, init),
            onDelta: publishDelta,
            onDone: (signal) =>
              info('Provider terminal signal received.', 'terminal_signal', { signal }),
            onLifecycle: reportLifecycle,
          }
        )
        if (!isCurrent()) return
        const terminalAt = now()
        info('Provider stream function completed.', 'stream_completed', byteCounts())
        if (timer !== null) cancel(timer)
        await checkpointChain
        await finalizeAndPublish('completed', terminalAt)
      } catch (error) {
        const terminalAt = now()
        if (!isCurrent()) return
        if (timer !== null) cancel(timer)
        await checkpointChain.catch(() => null)
        if (controller.signal.aborted || isAbort(error)) {
          info('Provider stream stop requested.', 'stopped', byteCounts())
          await finalizeAndPublish('stopped', terminalAt)
          return
        }

        const shape = errorShape(error)
        failure('Provider stream failed.', 'stream', error, byteCounts())
        await finalizeAndPublish('error', terminalAt, shape)
      } finally {
        info('Provider run released.', 'cleanup', { current: isCurrent() })
        if (runs.get(input.conversationId)?.token === token) runs.delete(input.conversationId)
      }
    })

    return { done, stop: () => controller.abort() }
  }

  function stop(conversationId: number): boolean {
    const run = runs.get(conversationId)
    if (!run) return false
    run.controller.abort()
    return true
  }

  return { start, stop }
}

export type ProviderRunner = ReturnType<typeof createProviderRunner>
