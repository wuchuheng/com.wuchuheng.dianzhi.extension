/**
 * Formats a persisted ISO message timestamp for display in a chat bubble.
 * The database stores `createdAt`/`updatedAt` as ISO strings; render them as
 * a compact locale time (e.g. "14:05"). Unknown or malformed values fall
 * back to an empty string so a bad row never renders "Invalid Date".
 */
export function formatMessageTime(createdAt: string, locale?: string): string {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}
