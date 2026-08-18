import { BUILTIN_PROMPTS, BUILTIN_TOOL_IDS, BUILTIN_TOOL_NAMES, PRESET_TOOL_IDS } from './presets'
import type { ToolRecord } from '@/offscreen/database/config-store'
import type {
  DianzhiSettings,
  SettingsProblem,
  SettingsRowData,
  SettingsValidation,
  ToolDefinition,
} from './types'

export const DEFAULT_ROW: SettingsRowData = {
  version: 2,
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
    expand: 'Control+Shift+Enter',
    close: 'Escape',
  },
}

export const DEFAULT_TOOLS: readonly ToolDefinition[] = BUILTIN_TOOL_IDS.map((id, index) => ({
  id: PRESET_TOOL_IDS[id],
  name: BUILTIN_TOOL_NAMES[id],
  builtin: true,
  enabled: true,
  isDefault: index === 0,
  promptMode: 'preset',
  customPrompt: '',
}))

export const DEFAULT_SETTINGS: DianzhiSettings = {
  ...DEFAULT_ROW,
  ui: { ...DEFAULT_ROW.ui, defaultToolId: DEFAULT_TOOLS[0].id },
  tools: [...DEFAULT_TOOLS],
}

const SHORTCUT_PATTERN =
  /^(?:(?:Control|Alt|Shift|Meta)\+)*(?:ArrowLeft|ArrowRight|Enter|bracketleft|[A-Za-z0-9-]+)$/

function cloneSettings(settings: SettingsRowData): SettingsRowData {
  return JSON.parse(JSON.stringify(settings)) as SettingsRowData
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

/**
 * Merges persisted settings into current defaults and returns a version-2 row
 * document. Tools are deliberately absent here: they live beside the row and
 * are composed in via {@link composeSettings}.
 * @param raw - Untrusted value read from extension storage.
 * @returns A detached `SettingsRowData` (provider/shortcuts/ui) with version forced to 2.
 */
export function mergeSettings(raw: unknown): SettingsRowData {
  const merged = cloneSettings(DEFAULT_ROW)
  if (isRecord(raw)) mergeRecord(merged as unknown as Record<string, unknown>, raw)
  merged.version = 2
  return merged
}

/**
 * Composes a runtime settings snapshot from a row document and its tool list.
 * @param row - Version-2 provider/shortcuts/ui defaults and overrides.
 * @param tools - Active tool definitions, in display order.
 * @returns The composed v2 snapshot with the default tool id resolved.
 */
export function composeSettings(
  row: SettingsRowData,
  tools: readonly ToolDefinition[]
): DianzhiSettings {
  const active = tools.find((tool) => tool.isDefault) ?? tools.find((tool) => tool.enabled)
  return {
    ...row,
    ui: { ...row.ui, defaultToolId: active?.id ?? 1 },
    tools: [...tools],
  }
}

/**
 * Converts a persisted `tools` row into the composed tool definition shape.
 * Presets keep their immutable built-in prompt unless the stored prompt was
 * edited, in which case the tool behaves as a custom-prompt tool.
 * @param record - Tool row read from the config store.
 * @returns A `ToolDefinition` for runtime composition.
 */
export function toToolDefinition(record: ToolRecord): ToolDefinition {
  const preset = BUILTIN_TOOL_IDS.find((id) => PRESET_TOOL_IDS[id] === record.id)
  const promptMode =
    record.isPreset && preset !== undefined && record.prompt === BUILTIN_PROMPTS[preset]
      ? 'preset'
      : 'custom'
  return {
    id: record.id,
    name: record.name,
    builtin: record.isPreset,
    enabled: record.enabled,
    isDefault: record.isDefault,
    promptMode,
    customPrompt: record.prompt,
  }
}

/**
 * Strips the composed snapshot back to its persistable row document: no
 * `tools`, no derived `ui.defaultToolId`, version pinned to 2.
 * @param settings - Composed settings snapshot (e.g. an Options draft).
 * @returns The row payload accepted by `settings.save`.
 */
export function rowDataFromSettings(settings: DianzhiSettings): SettingsRowData {
  const { tools: _tools, ui, ...row } = settings
  const { defaultToolId: _defaultToolId, ...uiRest } = ui
  return { ...row, version: 2, ui: uiRest }
}

function addProblem(problems: SettingsProblem[], path: string, message: string): void {
  problems.push({ path, message })
}

/**
 * Validates a complete composed settings snapshot before storage or provider use.
 * @param settings - Composed settings snapshot.
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

  const seen = new Set<number>()
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
    const presetId = PRESET_TOOL_IDS[builtinId]
    if (!settings.tools.some((tool) => tool.id === presetId && tool.builtin)) {
      addProblem(errors, `tools.${presetId}`, 'Built-in tools cannot be deleted.')
    }
  }
  if (!settings.tools.some((tool) => tool.enabled)) {
    addProblem(errors, 'tools', 'At least one tool must be enabled.')
  }

  return { ok: errors.length === 0, errors, warnings }
}

/**
 * Resolves the prompt snapshot used when a conversation is created.
 * @param tool - Tool definition from a composed settings snapshot.
 * @returns The selected custom prompt or immutable built-in preset.
 */
export function effectivePrompt(tool: ToolDefinition): string {
  if (tool.promptMode === 'custom' && tool.customPrompt.trim()) return tool.customPrompt
  const builtinId = BUILTIN_TOOL_IDS.find((id) => PRESET_TOOL_IDS[id] === tool.id)
  if (tool.builtin && builtinId !== undefined) return BUILTIN_PROMPTS[builtinId]
  return tool.customPrompt
}
