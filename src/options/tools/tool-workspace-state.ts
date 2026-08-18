import type { ToolDefinition } from '@/dianzhi/domain/types'

/**
 * Resolves the active tool selection: returns `activeToolId` when it still
 * exists, otherwise the default tool, the first tool, or null when no tool
 * can be selected.
 */
export function repairActiveTool(
  tools: readonly ToolDefinition[],
  activeToolId: number | null,
  defaultToolId: number
): number | null {
  if (activeToolId !== null && tools.some((tool) => tool.id === activeToolId)) return activeToolId
  if (tools.some((tool) => tool.id === defaultToolId)) return defaultToolId
  return tools[0]?.id ?? null
}

/**
 * Computes the reordered id list after a drag-drop of `draggedId` at the
 * position of `targetId`, mirroring the previous settings-draft reorder
 * semantics (splice-then-insert, `before` chooses the row boundary).
 * @returns The new ordering to persist, or null for a no-op drop.
 */
export function orderedIdsOnDrop(
  ids: readonly number[],
  draggedId: number,
  targetId: number,
  before: boolean
): number[] | null {
  const from = ids.indexOf(draggedId)
  const target = ids.indexOf(targetId)
  if (from < 0 || target < 0 || from === target) return null
  const next = [...ids]
  const [moved] = next.splice(from, 1)
  let insert = from < target ? target - 1 : target
  if (!before) insert += 1
  if (insert === from) return null
  next.splice(insert, 0, moved)
  return next
}
