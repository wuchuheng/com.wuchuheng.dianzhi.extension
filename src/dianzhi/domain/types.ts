export type BuiltinToolId = 'context' | 'synonyms' | 'translate' | 'dictionary'
export type PromptMode = 'preset' | 'custom'
export type ReasoningEffort = 'auto' | 'low' | 'medium' | 'high'
export type TriggerMode = 'mouseup' | 'alt-mouseup'

export interface ProviderSettings {
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  reasoningEnabled: boolean
  reasoningEffort: ReasoningEffort
  extraBody: string
}

export interface ToolDefinition {
  id: number
  name: string
  builtin: boolean
  enabled: boolean
  isDefault: boolean
  promptMode: PromptMode
  customPrompt: string
}

export interface UiSettings {
  defaultToolId: number
  contextTargetWords: number
  contextMaxWords: number
  contextMaxBlocks: number
}

export type UiConfig = Omit<UiSettings, 'defaultToolId'>

export interface ShortcutSettings {
  triggerMode: TriggerMode
  tabLeft: string
  tabRight: string
  toggleChat: string
  dock: string
  expand: string
  close: string
}

export interface SettingsRowData {
  version: 2
  provider: ProviderSettings
  shortcuts: ShortcutSettings
  ui: UiConfig
}

export type DianzhiSettings = SettingsRowData & {
  ui: UiSettings
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
