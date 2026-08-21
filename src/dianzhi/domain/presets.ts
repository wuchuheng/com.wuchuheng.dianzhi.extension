import type { BuiltinToolId } from './types'
import translate from './presetPrompts/translate-preset-prompt.md?raw'
import synonyms from './presetPrompts/thesaurus.md?raw'
import context from './presetPrompts/context.md?raw'
import dictionary from './presetPrompts/dictionary.md?raw'

export const BUILTIN_PROMPTS: Readonly<Record<BuiltinToolId, string>> = {
  context,
  synonyms,
  translate,
  dictionary,
}

export const BUILTIN_TOOL_NAMES: Readonly<Record<BuiltinToolId, string>> = {
  context: '语境',
  synonyms: '同义词',
  translate: '翻译',
  dictionary: '词典',
}

export const PRESET_TOOL_IDS: Readonly<Record<BuiltinToolId, number>> = {
  context: 1,
  synonyms: 2,
  translate: 3,
  dictionary: 4,
}

export const BUILTIN_TOOL_IDS: readonly BuiltinToolId[] = [
  'context',
  'synonyms',
  'translate',
  'dictionary',
]
