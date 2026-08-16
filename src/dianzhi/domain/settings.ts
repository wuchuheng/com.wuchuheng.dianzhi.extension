import { BUILTIN_PROMPTS, BUILTIN_TOOL_IDS } from './presets'
import type {
  BuiltinToolId,
  DianzhiSettings,
  SettingsProblem,
  SettingsValidation,
  ToolDefinition,
} from './types'

export const DEFAULT_SETTINGS: DianzhiSettings = {
  version: 1,
  provider: {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.7,
    reasoningEnabled: false,
    reasoningEffort: 'medium',
    thinkingParam: '',
    extraBody: '',
  },
  ui: {
    defaultToolId: 'context',
    contextTargetWords: 100,
    contextMaxWords: 500,
    contextMaxBlocks: 6,
  },
  shortcuts: {
    triggerMode: 'mouseup',
    tabLeft: 'Control+ArrowLeft',
    tabRight: 'Control+ArrowRight',
    toggleChat: 'Control+Enter',
    dock: 'Control+bracketleft',
  },
  tools: [
    {
      id: 'context',
      name: '语境',
      builtin: true,
      enabled: true,
      promptMode: 'preset',
      customPrompt: '',
    },
    {
      id: 'synonyms',
      name: '同义词',
      builtin: true,
      enabled: true,
      promptMode: 'preset',
      customPrompt: '',
    },
    {
      id: 'translate',
      name: '翻译',
      builtin: true,
      enabled: true,
      promptMode: 'preset',
      customPrompt: '',
    },
  ],
}

const SHORTCUT_PATTERN =
  /^(?:(?:Control|Alt|Shift|Meta)\+)*(?:ArrowLeft|ArrowRight|Enter|bracketleft|[A-Za-z0-9-]+)$/

function cloneSettings(settings: DianzhiSettings): DianzhiSettings {
  return JSON.parse(JSON.stringify(settings)) as DianzhiSettings
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeRecord(target: Record<string, unknown>, source: Record<string, unknown>): void {
  for (const [key, sourceValue] of Object.entries(source)) {
    if (sourceValue === undefined) continue
    const targetValue = target[key]

    if (isRecord(targetValue)) {
      if (isRecord(sourceValue)) mergeRecord(targetValue, sourceValue)
    } else if (Array.isArray(targetValue)) {
      if (Array.isArray(sourceValue)) {
        target[key] = JSON.parse(JSON.stringify(sourceValue)) as unknown
      }
    } else if (typeof sourceValue === typeof targetValue) {
      target[key] = JSON.parse(JSON.stringify(sourceValue)) as unknown
    }
  }
}

function isToolDefinition(value: unknown): value is ToolDefinition {
  if (!isRecord(value)) return false
  return (
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.builtin === 'boolean' &&
    typeof value.enabled === 'boolean' &&
    (value.promptMode === 'preset' || value.promptMode === 'custom') &&
    typeof value.customPrompt === 'string'
  )
}

/**
 * Merges persisted settings into current defaults and repairs an unavailable default tool.
 * @param raw - Untrusted value read from extension storage.
 * @returns A detached settings object safe for form mutation.
 */
export function mergeSettings(raw: unknown): DianzhiSettings {
  const merged = cloneSettings(DEFAULT_SETTINGS)
  if (isRecord(raw)) mergeRecord(merged as unknown as Record<string, unknown>, raw)

  merged.version = 1
  const tools =
    Array.isArray(merged.tools) && merged.tools.every(isToolDefinition)
      ? merged.tools
      : cloneSettings(DEFAULT_SETTINGS).tools
  merged.tools = tools
  if (!tools.some((tool) => tool.id === merged.ui.defaultToolId && tool.enabled)) {
    merged.ui.defaultToolId = tools.find((tool) => tool.enabled)?.id ?? 'context'
  }

  return merged
}

function addProblem(problems: SettingsProblem[], path: string, message: string): void {
  problems.push({ path, message })
}

/**
 * Validates a complete settings snapshot before storage or provider use.
 * @param settings - Merged settings snapshot.
 * @returns Blocking errors and non-blocking warnings with stable field paths.
 */
export function validateSettings(settings: DianzhiSettings): SettingsValidation {
  const errors: SettingsProblem[] = []
  const warnings: SettingsProblem[] = []

  try {
    const url = new URL(settings.provider.baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol')
  } catch {
    addProblem(errors, 'provider.baseUrl', 'API address must use HTTP or HTTPS.')
  }
  if (!settings.provider.apiKey.trim()) {
    addProblem(warnings, 'provider.apiKey', 'API key is not configured.')
  }
  if (!settings.provider.model.trim()) {
    addProblem(errors, 'provider.model', 'Model is required.')
  }
  if (
    !Number.isFinite(settings.provider.temperature) ||
    settings.provider.temperature < 0 ||
    settings.provider.temperature > 2
  ) {
    addProblem(errors, 'provider.temperature', 'Temperature must be between 0 and 2.')
  }
  if (settings.provider.extraBody.trim()) {
    try {
      const parsed = JSON.parse(settings.provider.extraBody) as unknown
      if (!isRecord(parsed)) throw new Error('object')
    } catch {
      addProblem(errors, 'provider.extraBody', 'Extra request fields must be a JSON object.')
    }
  }
  if (!['', 'enable_thinking'].includes(settings.provider.thinkingParam)) {
    addProblem(errors, 'provider.thinkingParam', 'Thinking parameter mode is invalid.')
  }

  for (const [key, value] of Object.entries(settings.shortcuts)) {
    if (key === 'triggerMode') continue
    if (!SHORTCUT_PATTERN.test(value)) {
      addProblem(errors, `shortcuts.${key}`, 'Shortcut format is invalid.')
    }
  }
  if (!['mouseup', 'alt-mouseup'].includes(settings.shortcuts.triggerMode)) {
    addProblem(errors, 'shortcuts.triggerMode', 'Selection trigger mode is invalid.')
  }

  const seen = new Set<string>()
  for (const tool of settings.tools) {
    if (!tool.id || seen.has(tool.id)) {
      addProblem(errors, `tools.${tool.id || 'unknown'}.id`, 'Tool IDs must be present and unique.')
    }
    seen.add(tool.id)
    if (!tool.name.trim()) addProblem(errors, `tools.${tool.id}.name`, 'Tool name is required.')
    if (tool.promptMode === 'custom' && !tool.customPrompt.trim()) {
      addProblem(errors, `tools.${tool.id}.customPrompt`, 'Custom prompt is required.')
    }
  }
  for (const builtinId of BUILTIN_TOOL_IDS) {
    if (!settings.tools.some((tool) => tool.id === builtinId && tool.builtin)) {
      addProblem(errors, `tools.${builtinId}`, 'Built-in tools cannot be deleted.')
    }
  }
  if (!settings.tools.some((tool) => tool.enabled)) {
    addProblem(errors, 'tools', 'At least one tool must be enabled.')
  }

  return { ok: errors.length === 0, errors, warnings }
}

/**
 * Resolves the prompt snapshot used when a conversation is created.
 * @param tool - Tool definition from merged settings.
 * @returns The selected custom prompt or immutable built-in preset.
 */
export function effectivePrompt(tool: ToolDefinition): string {
  if (tool.promptMode === 'custom' && tool.customPrompt.trim()) return tool.customPrompt
  if (tool.builtin && BUILTIN_TOOL_IDS.includes(tool.id as BuiltinToolId)) {
    return BUILTIN_PROMPTS[tool.id as BuiltinToolId]
  }
  return tool.customPrompt
}
