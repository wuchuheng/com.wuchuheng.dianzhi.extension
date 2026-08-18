import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { DianzhiErrorShape } from '@/dianzhi/domain/errors'
import { OPTIONS_TOOL_TEST_PORT_NAME, type ToolTestUpdate } from '@/dianzhi/domain/protocol'
import type { ProviderSettings } from '@/dianzhi/domain/types'
import { INITIAL_TOOL_TEST_STATE, reduceToolTestState, type ToolTestState } from './tool-test-state'

export interface UseToolTestDependencies {
  connect?: typeof chrome.runtime.connect
}

export interface UseToolTestResult {
  state: ToolTestState
  run(input: { prompt: string; provider: ProviderSettings }): void
  stop(): void
  reset(): void
}

const CLOSED_PORT_ERROR: DianzhiErrorShape = {
  code: 'TEST_PORT_CLOSED',
  message: 'The background test connection is closed. Reopen Options to run another test.',
}

/**
 * Opens a lazily connected options tool-test port, filters background updates
 * by the current request ID, and exposes a non-persistent tool test run.
 * @param dependencies - Optional connect override for deterministic tests.
 * @returns The non-persistent pane state and the run/stop/reset controls.
 */
export function useToolTest(dependencies: UseToolTestDependencies = {}): UseToolTestResult {
  const [state, dispatch] = useReducer(reduceToolTestState, INITIAL_TOOL_TEST_STATE)
  const portRef = useRef<chrome.runtime.Port | null>(null)
  const requestIdRef = useRef<string | null>(null)
  const connect = dependencies.connect ?? chrome.runtime.connect

  useEffect(() => {
    return () => {
      portRef.current?.disconnect()
      portRef.current = null
      requestIdRef.current = null
    }
  }, [])

  const ensurePort = useCallback((): chrome.runtime.Port | null => {
    const existing = portRef.current
    if (existing) return existing
    let port: chrome.runtime.Port
    try {
      port = connect({ name: OPTIONS_TOOL_TEST_PORT_NAME })
    } catch {
      return null
    }
    portRef.current = port
    port.onMessage.addListener((value: unknown) => {
      if (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as { requestId?: unknown }).requestId === 'string' &&
        (value as { requestId: string }).requestId === requestIdRef.current
      ) {
        dispatch(value as ToolTestUpdate)
      }
    })
    port.onDisconnect.addListener(() => {
      if (portRef.current === port) portRef.current = null
    })
    return port
  }, [connect])

  const run = useCallback(
    (input: { prompt: string; provider: ProviderSettings }) => {
      const requestId = crypto.randomUUID()
      requestIdRef.current = requestId
      const port = ensurePort()
      if (!port) {
        // Announce the run first (the validating branch resets any previous
        // run), then surface the connection failure so the pane never strands
        // in validating with an error that the request-ID guard would drop.
        dispatch({ type: 'test.validating', requestId })
        dispatch({ type: 'test.error', requestId, error: CLOSED_PORT_ERROR })
        return
      }
      dispatch({ type: 'test.validating', requestId })
      try {
        port.postMessage({ type: 'tool.test', requestId, payload: input })
      } catch {
        dispatch({ type: 'test.error', requestId, error: CLOSED_PORT_ERROR })
      }
    },
    [ensurePort]
  )

  const stop = useCallback(() => {
    const port = portRef.current
    if (!port) return
    try {
      port.postMessage({
        type: 'tool.test.stop',
        requestId: crypto.randomUUID(),
        payload: {},
      })
    } catch {
      // Best-effort stop: a dead port means the background already stopped the run.
    }
  }, [])

  const reset = useCallback(() => {
    requestIdRef.current = null
    dispatch({ type: 'test.reset' })
  }, [])

  return { state, run, stop, reset }
}
