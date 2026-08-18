import { DianzhiError, type DianzhiErrorShape } from '@/dianzhi/domain/errors'
import {
  OPTIONS_TOOL_TEST_PORT_NAME,
  parseOptionsTestCommand,
  type ToolTestCommand,
  type ToolTestUpdate,
} from '@/dianzhi/domain/protocol'
import { streamChat as defaultStreamChat } from '@/dianzhi/provider/client'
import type { ProviderDelta } from '@/dianzhi/provider/sse'
import { logWarn, Scope } from '@/events/logger'

interface ActiveRun {
  controller: AbortController
  token: symbol
}

export interface OptionsToolTestRunnerDependencies {
  streamChat?: typeof defaultStreamChat
  now?: () => number
  isExtensionUrl?: (url: string) => boolean
}

/**
 * Compile-time boundary guard: the Options tool-test path deliberately has no
 * conversation-persistence or settings dependency. If any member outside this
 * exact surface (such as checkpoint or finalize) is added to
 * OptionsToolTestRunnerDependencies — required or optional — this exported
 * sentinel no longer conforms to its derived mapped type (the `-?` removes
 * optional modifiers, forcing every member) and `pnpm run typecheck` fails.
 */
export const optionsToolTestRunnerDependencySurface: {
  [K in keyof OptionsToolTestRunnerDependencies]-?: K
} = {
  streamChat: 'streamChat',
  now: 'now',
  isExtensionUrl: 'isExtensionUrl',
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

function errorShape(error: unknown): DianzhiErrorShape {
  if (error instanceof DianzhiError) return error.toJSON()
  return { code: 'PROVIDER_STREAM_ERROR', message: 'The tool test run failed.' }
}

/**
 * Streams abortable tool tests into the Options page without any conversation
 * persistence. One controller is owned per connected port, so a new test, an
 * explicit stop, or a port disconnect aborts the previous run.
 */
export function createOptionsToolTestRunner(dependencies: OptionsToolTestRunnerDependencies = {}) {
  const runs = new Map<chrome.runtime.Port, ActiveRun>()
  const runStream = dependencies.streamChat ?? defaultStreamChat
  const now = dependencies.now ?? (() => Date.now())
  const isExtensionUrl =
    dependencies.isExtensionUrl ?? ((url: string) => url.startsWith(chrome.runtime.getURL('')))

  function isCurrent(port: chrome.runtime.Port, token: symbol): boolean {
    return runs.get(port)?.token === token
  }

  function post(port: chrome.runtime.Port, active: ActiveRun, update: ToolTestUpdate): void {
    if (!isCurrent(port, active.token)) return
    try {
      port.postMessage(update)
    } catch {
      logWarn(Scope.BACKGROUND, 'Options tool-test port postMessage failed; aborting run.')
      active.controller.abort()
    }
  }

  function connect(port: chrome.runtime.Port): void {
    if (port.name !== OPTIONS_TOOL_TEST_PORT_NAME) return
    const senderUrl = port.sender?.url
    if (!senderUrl || !isExtensionUrl(senderUrl)) {
      port.disconnect()
      return
    }
    port.onMessage.addListener((message: unknown) => {
      const parsed = parseOptionsTestCommand(message)
      if (parsed.ok) handle(port, parsed.value)
    })
    port.onDisconnect.addListener(() => {
      runs.get(port)?.controller.abort()
      runs.delete(port)
    })
  }

  function handle(port: chrome.runtime.Port, command: ToolTestCommand): void {
    runs.get(port)?.controller.abort()
    if (command.type === 'tool.test.stop') return
    const active: ActiveRun = {
      controller: new AbortController(),
      token: Symbol('options-tool-test'),
    }
    runs.set(port, active)
    void runTest(port, command, active).catch(() => undefined)
  }

  async function runTest(
    port: chrome.runtime.Port,
    command: ToolTestCommand,
    active: ActiveRun
  ): Promise<void> {
    const requestId = command.requestId
    const startedAt = now()
    let content = ''
    let reasoningContent = ''
    let firstTokenMs: number | null = null

    post(port, active, { type: 'test.validating', requestId })
    try {
      const { provider } = command.payload
      if (!provider.apiKey.trim() || !provider.model.trim()) {
        throw new DianzhiError({
          code: 'PROVIDER_NOT_CONFIGURED',
          message: 'Configure an API key and model before running a tool test.',
        })
      }
      post(port, active, { type: 'test.started', requestId })
      await runStream(
        {
          provider,
          messages: [{ role: 'user', content: command.payload.prompt }],
          signal: active.controller.signal,
        },
        {
          fetch: (request, init) => globalThis.fetch(request, init),
          onDelta: (delta: ProviderDelta) => {
            if (!isCurrent(port, active.token)) return
            if (firstTokenMs === null) firstTokenMs = now() - startedAt
            if (delta.kind === 'content') content += delta.delta
            else reasoningContent += delta.delta
            post(port, active, {
              type: 'test.delta',
              requestId,
              kind: delta.kind,
              delta: delta.delta,
            })
          },
          onDone: () => undefined,
        }
      )
      if (!isCurrent(port, active.token)) return
      post(port, active, {
        type: 'test.done',
        requestId,
        content,
        reasoningContent,
        firstTokenMs,
        totalMs: now() - startedAt,
      })
    } catch (error) {
      if (!isCurrent(port, active.token)) return
      const totalMs = now() - startedAt
      if (active.controller.signal.aborted || isAbort(error)) {
        post(port, active, {
          type: 'test.stopped',
          requestId,
          content,
          reasoningContent,
          firstTokenMs,
          totalMs,
        })
        return
      }
      post(port, active, { type: 'test.error', requestId, error: errorShape(error) })
    } finally {
      if (runs.get(port) === active) runs.delete(port)
    }
  }

  return { connect }
}

export type OptionsToolTestRunner = ReturnType<typeof createOptionsToolTestRunner>
