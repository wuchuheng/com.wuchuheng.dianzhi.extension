/**
 * Event name helpers to avoid collisions across channels.
 */

export type EventChannel =
  | 'cs2cs'
  | 'cs2bg'
  | 'cs2ep'
  | 'bg2bg'
  | 'bg2cs'
  | 'bg2ep'
  | 'bg2sp'
  | 'ep2bg'

export function buildEventName(channel: EventChannel, name: string): string {
  const prefix = `${channel}:`
  if (name.startsWith(prefix)) return name
  return `${prefix}${name}`
}
