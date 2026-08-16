import type { ToolConversationRef } from '@/dianzhi/domain/protocol'

export function nextToolId(
  tools: readonly ToolConversationRef[],
  activeToolId: string,
  direction: -1 | 1
): string | null {
  if (tools.length === 0) return null
  const activeIndex = Math.max(
    0,
    tools.findIndex(({ tool }) => tool.id === activeToolId)
  )
  const nextIndex = (activeIndex + direction + tools.length) % tools.length
  return tools[nextIndex]?.tool.id ?? null
}
