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
