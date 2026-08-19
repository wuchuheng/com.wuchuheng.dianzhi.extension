const LETTER_PATTERN = /\p{L}/gu
const LATIN_PATTERN = /\p{Script=Latin}/gu

export function isEnglishSelection(text: string): boolean {
  const normalized = text.trim()
  // if (!normalized || normalized.length > 300) return false
  const letters = normalized.match(LETTER_PATTERN)?.length ?? 0
  if (letters < 2) return false
  const latinLetters = normalized.match(LATIN_PATTERN)?.length ?? 0
  return latinLetters / letters >= 0.8
}
