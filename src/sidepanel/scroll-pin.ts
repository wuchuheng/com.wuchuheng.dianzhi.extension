/**
 * Distance from the bottom edge (px) at which the conversation view still
 * counts as "pinned to the latest message". While pinned, new streamed
 * content keeps the view scrolled to the bottom; scrolling farther up
 * unpins so the user can read history without being yanked back down.
 */
export const SCROLL_PIN_THRESHOLD = 80

export function isNearBottom(container: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <= SCROLL_PIN_THRESHOLD
  )
}
