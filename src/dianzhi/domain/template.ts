import type { TemplateValues } from './types'

/**
 * Replaces supported prompt variables in one pass so substituted text is never interpreted as a token.
 * @param prompt - Prompt containing Dianzhi template variables.
 * @param values - Selected text and contextual passage.
 * @returns The prompt with supported variables replaced.
 */
export function fillTemplate(prompt: string, values: TemplateValues): string {
  const selected = values.selected == null ? '' : String(values.selected)
  const context = values.context == null ? '' : String(values.context)

  return prompt.replace(/{{selected}}|{{context}}/g, (token) =>
    token === '{{selected}}' ? selected : context
  )
}
