import type { BuiltinToolId } from './types'

export const BUILTIN_PROMPTS: Readonly<Record<BuiltinToolId, string>> = {
  context:
    'Explain {{selected}} as used in {{context}}. Answer in Chinese in exactly two short paragraphs, under 150 Chinese characters, and bold the core meaning and referent.',
  synonyms:
    'Using {{context}}, give 2-4 replaceable synonyms for {{selected}}. Use lemma titles, UK and US phonetics, collocations with Chinese translations, examples, and a concise nuance comparison.',
  translate:
    'Translate only {{selected}} into Chinese using {{context}} for disambiguation. Return a precise translation and a short context-calibration explanation with bold anchors.',
}

export const BUILTIN_TOOL_IDS: readonly BuiltinToolId[] = ['context', 'synonyms', 'translate']
