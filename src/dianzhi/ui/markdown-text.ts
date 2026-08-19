/**
 * Converts the markdown subset rendered by `Markdown` (headings, lists,
 * blockquotes, `**bold**`, `` `code` ``) into plain text for clipboard
 * pasting. Kept in sync with Markdown.tsx: whatever the renderer displays,
 * this strips it down to the readable string.
 */
export function markdownToPlainText(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const out: string[] = []
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (!line.trim()) {
      // Collapse runs of blank lines into a single paragraph separator.
      if (out.length > 0 && out[out.length - 1] !== '') out.push('')
      continue
    }
    out.push(
      line
        .replace(/^(#{1,3})\s+/, '')
        .replace(/^>\s?/, '')
        .replace(/^[-*]\s+/, '')
        .replace(/^\d+\.\s+/, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
    )
  }
  while (out.length > 0 && out[0] === '') out.shift()
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}
