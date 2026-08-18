import type { ToolDefinition } from '@/dianzhi/domain/types'

/**
 * Resolves the active tool selection: returns `activeToolId` when it still
 * exists, otherwise the default tool, the first tool, or null when no tool
 * can be selected.
 */
export function repairActiveTool(
  tools: readonly ToolDefinition[],
  activeToolId: string | null,
  defaultToolId: string
): string | null {
  if (activeToolId !== null && tools.some((tool) => tool.id === activeToolId)) return activeToolId
  if (tools.some((tool) => tool.id === defaultToolId)) return defaultToolId
  return tools[0]?.id ?? null
}
