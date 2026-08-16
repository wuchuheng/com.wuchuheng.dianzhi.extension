export type BuiltinToolId = 'context' | 'synonyms' | 'translate'
export type PromptMode = 'preset' | 'custom'
export type ReasoningEffort = 'low' | 'medium' | 'high'
export type ThinkingParam = '' | 'enable_thinking'
export type TriggerMode = 'mouseup' | 'alt-mouseup'

export interface ProviderSettings {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  reasoningEnabled: boolean
  reasoningEffort: ReasoningEffort
  thinkingParam: ThinkingParam
  extraBody: string
}

export interface ToolDefinition {
  id: string
  name: string
  builtin: boolean
  enabled: boolean
  promptMode: PromptMode
  customPrompt: string
}

export interface UiSettings {
  defaultToolId: string
  contextTargetWords: number
  contextMaxWords: number
  contextMaxBlocks: number
}

export interface ShortcutSettings {
  triggerMode: TriggerMode
  tabLeft: string
  tabRight: string
  toggleChat: string
  dock: string
}

export interface DianzhiSettings {
  version: 1
  provider: ProviderSettings
  ui: UiSettings
  shortcuts: ShortcutSettings
  tools: ToolDefinition[]
}

export interface SettingsProblem {
  path: string
  message: string
}

export interface SettingsValidation {
  ok: boolean
  errors: SettingsProblem[]
  warnings: SettingsProblem[]
}

export interface TemplateValues {
  selected?: string | null
  context?: string | null
}
