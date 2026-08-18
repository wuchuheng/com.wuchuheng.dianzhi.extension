import type { DianzhiSettings, ToolDefinition } from '@/dianzhi/domain/types'

function copy(settings: DianzhiSettings): DianzhiSettings {
  return JSON.parse(JSON.stringify(settings)) as DianzhiSettings
}

export function addCustomTool(settings: DianzhiSettings): DianzhiSettings {
  const next = copy(settings)
  const tool: ToolDefinition = {
    id: `custom-${Date.now().toString(36)}`,
    name: '自定义工具',
    builtin: false,
    enabled: true,
    promptMode: 'custom',
    customPrompt: '请根据 {{context}} 解释 {{selected}}。',
  }
  next.tools.push(tool)
  return next
}

export function removeCustomTool(settings: DianzhiSettings, toolId: string): DianzhiSettings {
  const tool = settings.tools.find((item) => item.id === toolId)
  if (!tool || tool.builtin) return settings
  const next = copy(settings)
  next.tools = next.tools.filter((item) => item.id !== toolId)
  if (next.ui.defaultToolId === toolId)
    next.ui.defaultToolId = next.tools.find((item) => item.enabled)?.id ?? 'context'
  return next
}

export function moveTool(
  settings: DianzhiSettings,
  toolId: string,
  direction: -1 | 1
): DianzhiSettings {
  const index = settings.tools.findIndex((tool) => tool.id === toolId)
  const destination = index + direction
  if (index < 0 || destination < 0 || destination >= settings.tools.length) return settings
  const next = copy(settings)
  const [tool] = next.tools.splice(index, 1)
  if (tool) next.tools.splice(destination, 0, tool)
  return next
}

/**
 * Immutably moves `draggedId` to the drop position of `targetId`, either before
 * or after its current row. Returns the same settings reference for no-op drops.
 */
export function reorderToolsByTarget(
  settings: DianzhiSettings,
  draggedId: string,
  targetId: string,
  before: boolean
): DianzhiSettings {
  const from = settings.tools.findIndex((tool) => tool.id === draggedId)
  const target = settings.tools.findIndex((tool) => tool.id === targetId)
  if (from < 0 || target < 0 || from === target) return settings
  const next = copy(settings)
  const [moved] = next.tools.splice(from, 1)
  let insert = from < target ? target - 1 : target
  if (!before) insert += 1
  if (insert === from) return settings
  if (moved) next.tools.splice(insert, 0, moved)
  return next
}

/**
 * Patches one tool's enabled state. Disabling the current default tool repairs
 * it to the first remaining enabled tool, mirroring `removeCustomTool`.
 */
export function setToolEnabled(
  settings: DianzhiSettings,
  toolId: string,
  enabled: boolean
): DianzhiSettings {
  const tool = settings.tools.find((item) => item.id === toolId)
  if (!tool || tool.enabled === enabled) return settings
  const next = copy(settings)
  next.tools = next.tools.map((item) => (item.id === toolId ? { ...item, enabled } : item))
  if (!enabled && next.ui.defaultToolId === toolId) {
    next.ui.defaultToolId = next.tools.find((item) => item.enabled)?.id ?? 'context'
  }
  return next
}
