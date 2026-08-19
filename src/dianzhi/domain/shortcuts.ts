/**
 * Shortcut matching and display helpers, shared by the content popover and
 * the Side Panel page.
 *
 * Shortcut strings are stored in the configured form, e.g. `Control+Enter` or
 * `Control+bracketleft`. The final token is matched against `KeyboardEvent.key`
 * (e.g. `Enter`) or `KeyboardEvent.code` (e.g. `BracketLeft`), so both named
 * keys and physical key codes trigger. The configured form is translated into
 * a compact label for tooltips.
 */

const KEY_LABELS: Record<string, string> = {
  Control: 'Ctrl',
  Alt: 'Alt',
  Shift: 'Shift',
  Meta: '⌘',
  Enter: 'Enter',
  Escape: 'Esc',
  bracketleft: '[',
  bracketright: ']',
  ArrowLeft: '←',
  ArrowRight: '→',
  ArrowUp: '↑',
  ArrowDown: '↓',
}

/**
 * Matches a keyboard event against a configured shortcut string.
 * @param event - The keyboard event to test.
 * @param shortcut - Configured shortcut in `Modifier+Key` form, e.g. `Control+Enter`.
 * @returns True when every modifier matches and the final key equals the event key.
 */
export function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.split('+')
  const key = parts[parts.length - 1]?.toLowerCase()
  if (!key) return false
  return (
    event.ctrlKey === parts.includes('Control') &&
    event.altKey === parts.includes('Alt') &&
    event.shiftKey === parts.includes('Shift') &&
    event.metaKey === parts.includes('Meta') &&
    (event.key.toLowerCase() === key || event.code.toLowerCase() === key)
  )
}

/**
 * Renders a configured shortcut string as a compact display label.
 * @param shortcut - Configured shortcut in `Modifier+Key` form.
 * @returns A human-readable label such as `Ctrl+Enter`, `Ctrl+[` or `Esc`.
 */
export function formatShortcut(shortcut: string): string {
  return shortcut
    .split('+')
    .map((part) => KEY_LABELS[part] ?? part)
    .join('+')
}
