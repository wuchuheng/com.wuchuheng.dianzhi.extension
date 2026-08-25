import type { BuiltinToolId } from './types'
import translate from './presetPrompts/translate-preset-prompt.md?raw'
import synonyms from './presetPrompts/thesaurus.md?raw'
import context from './presetPrompts/context.md?raw'
import dictionary from './presetPrompts/dictionary.md?raw'
import english from './presetPrompts/translation-in-english.md?raw'

export const PRESET_ID_RESERVED_MAX = 1024
export const CUSTOM_TOOL_ID_START = 1025

export const BUILTIN_PROMPTS: Readonly<Record<BuiltinToolId, string>> = {
  context,
  synonyms,
  translate,
  dictionary,
  english,
}

export const BUILTIN_TOOL_NAMES: Readonly<Record<BuiltinToolId, string>> = {
  context: '语境',
  synonyms: '同义词',
  translate: '翻译',
  dictionary: '词典',
  english: '英英释义',
}

export const PRESET_TOOL_IDS: Readonly<Record<BuiltinToolId, number>> = {
  context: 1,
  synonyms: 2,
  translate: 3,
  dictionary: 4,
  english: 5,
}

export const BUILTIN_TOOL_IDS: readonly BuiltinToolId[] = [
  'context',
  'synonyms',
  'translate',
  'dictionary',
  'english',
]
