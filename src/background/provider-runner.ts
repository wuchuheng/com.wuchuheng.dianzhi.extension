import { DianzhiError } from '@/dianzhi/domain/errors'
import type { ConversationUpdate, MessageRecord } from '@/dianzhi/domain/protocol'
import type { ProviderSettings } from '@/dianzhi/domain/types'
import { streamChat as defaultStreamChat } from '@/dianzhi/provider/client'
import type { ProviderMessage } from '@/dianzhi/provider/request'
import type { ProviderDelta } from '@/dianzhi/provider/sse'
import type { FinalizeAssistantInput } from '@/offscreen/database/store'

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

export function createProviderRunner(dependencies: ProviderRunnerDependencies) {
  const runs = new Map<number, { controller: AbortController; token: symbol }>()
  const runStream = dependencies.streamChat ?? defaultStreamChat
  const schedule = dependencies.setTimeout ?? globalThis.setTimeout
  const cancel = dependencies.clearTimeout ?? globalThis.clearTimeout
  const encoder = new TextEncoder()

  function start(input: ProviderRunInput): ProviderRunHandle {
    runs.get(input.conversationId)?.controller.abort()
    const controller = new AbortController()
    const token = Symbol(`conversation-${input.conversationId}`)
    runs.set(input.conversationId, { controller, token })

    const done = Promise.resolve().then(async () => {
      let content = input.assistant.content
      let reasoningContent = input.assistant.reasoningContent
      let checkpointedBytes = encoder.encode(content + reasoningContent).byteLength
      let checkpointChain = Promise.resolve<MessageRecord | null>(null)
      let timer: ReturnType<typeof setTimeout> | null = null

      const isCurrent = () => runs.get(input.conversationId)?.token === token

      const queueCheckpoint = () => {
        if (!isCurrent()) return
        if (timer !== null) {
          cancel(timer)
          timer = null
        }
        const nextContent = content
        const nextReasoning = reasoningContent
        checkpointedBytes = encoder.encode(nextContent + nextReasoning).byteLength
        checkpointChain = checkpointChain.then(() =>
          dependencies.checkpoint(input.assistant.id, nextContent, nextReasoning)
        )
      }

      const armCheckpoint = () => {
        const bytes = encoder.encode(content + reasoningContent).byteLength
        if (bytes - checkpointedBytes >= CHECKPOINT_BYTES) {
          queueCheckpoint()
          return
        }
        if (timer === null) timer = schedule(queueCheckpoint, CHECKPOINT_INTERVAL_MS)
      }

      const publishDelta = (delta: ProviderDelta) => {
        if (!isCurrent()) return
        if (delta.kind === 'content') content += delta.delta
        else reasoningContent += delta.delta
        void dependencies.publish({
          type: delta.kind === 'content' ? 'stream.delta' : 'stream.reasoning',
          conversationId: input.conversationId,
          messageId: input.assistant.id,
          content: delta.delta,
        })
        armCheckpoint()
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
            onDone: () => undefined,
          }
        )
        if (!isCurrent()) return
        if (timer !== null) cancel(timer)
        await checkpointChain
        const message = await dependencies.finalize(input.assistant.id, {
          status: 'completed',
          content,
          reasoningContent,
        })
        if (isCurrent()) {
          await dependencies.publish({
            type: 'stream.done',
            conversationId: input.conversationId,
            message,
          })
        }
      } catch (error) {
        if (!isCurrent()) return
        if (timer !== null) cancel(timer)
        await checkpointChain.catch(() => null)
        if (controller.signal.aborted || isAbort(error)) {
          const message = await dependencies.finalize(input.assistant.id, {
            status: 'stopped',
            content,
            reasoningContent,
          })
          if (isCurrent()) {
            await dependencies.publish({
              type: 'stream.stopped',
              conversationId: input.conversationId,
              message,
            })
          }
          return
        }

        const shape = errorShape(error)
        const message = await dependencies.finalize(input.assistant.id, {
          status: 'error',
          content,
          reasoningContent,
          errorCode: shape.code,
          errorMessage: shape.message,
        })
        if (isCurrent()) {
          await dependencies.publish({
            type: 'stream.error',
            conversationId: input.conversationId,
            message,
            error: shape,
          })
        }
      } finally {
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
