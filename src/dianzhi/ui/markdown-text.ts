/**
 * Converts the markdown subset rendered by `Markdown` (headings, lists,
 * blockquotes, tables, `**bold**`, `` `code` ``) into plain text for
 * clipboard pasting. Kept in sync with Markdown.tsx: whatever the renderer
 * displays, this strips it down to the readable string.
 */
function stripInline(line: string): string {
  return line
    .replace(/^(#{1,3})\s+/, '')
    .replace(/^>\s?/, '')
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+\.\s+/, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
}

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
    const table = /^\|([^|].*)\|\s*$/.exec(line)
    if (table) {
      const body = table[1] ?? ''
      // Separator row (dashes/colons only): drop it from the clipboard text.
      if (/^\s*:?-+:?\s*(\|\s*:?-+:?\s*)+$/.test(body)) continue
      out.push(
        stripInline(
          body
            .split(/(?<!\\)\|/)
            .map((cell) => cell.trim().replace(/\\\|/g, '|'))
            .join(' | ')
        )
      )
      continue
    }
    out.push(stripInline(line))
  }
  while (out.length > 0 && out[0] === '') out.shift()
  while (out.length > 0 && out[out.length - 1] === '') out.pop()
  return out.join('\n')
}
