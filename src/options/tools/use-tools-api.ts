import { useMemo } from 'react'
import { toolsCommand } from '@/events/config'
import type { ToolUpdatePatch } from '@/dianzhi/domain/protocol'
import type { ToolRecord } from '@/offscreen/database/config-store'

export interface ToolsApi {
  list(includeRemoved?: boolean): Promise<ToolRecord[]>
  create(name: string, prompt: string): Promise<ToolRecord[]>
  update(id: number, patch: ToolUpdatePatch): Promise<ToolRecord[]>
  reorder(orderedIds: number[]): Promise<ToolRecord[]>
  softRemove(id: number): Promise<ToolRecord[]>
  restore(id: number): Promise<ToolRecord[]>
  delete(id: number): Promise<ToolRecord[]>
}

function freshRequestId(): string {
  return `tools-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/**
 * The production tools API: dispatches `toolsCommand` background events and
 * resolves with the refreshed tool-row list (the background handler re-reads
 * the list after every mutation, so callers re-render from a single round
 * trip).
 */
export function useToolsApi(): ToolsApi {
  return useMemo(
    () => ({
      list: (includeRemoved) =>
        toolsCommand.dispatch({
          type: 'tools.list',
          requestId: freshRequestId(),
          payload: includeRemoved === undefined ? {} : { includeRemoved },
        }) as Promise<ToolRecord[]>,
      create: (name, prompt) =>
        toolsCommand.dispatch({
          type: 'tools.create',
          requestId: freshRequestId(),
          payload: { name, prompt },
        }) as Promise<ToolRecord[]>,
      update: (id, patch) =>
        toolsCommand.dispatch({
          type: 'tools.update',
          requestId: freshRequestId(),
          payload: { id, patch },
        }) as Promise<ToolRecord[]>,
      reorder: (orderedIds) =>
        toolsCommand.dispatch({
          type: 'tools.reorder',
          requestId: freshRequestId(),
          payload: { orderedIds },
        }) as Promise<ToolRecord[]>,
      softRemove: (id) =>
        toolsCommand.dispatch({
          type: 'tools.softRemove',
          requestId: freshRequestId(),
          payload: { id },
        }) as Promise<ToolRecord[]>,
      restore: (id) =>
        toolsCommand.dispatch({
          type: 'tools.restore',
          requestId: freshRequestId(),
          payload: { id },
        }) as Promise<ToolRecord[]>,
      delete: (id) =>
        toolsCommand.dispatch({
          type: 'tools.delete',
          requestId: freshRequestId(),
          payload: { id },
        }) as Promise<ToolRecord[]>,
    }),
    []
  )
}
