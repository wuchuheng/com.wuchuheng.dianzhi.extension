# Dianzhi Side Panel Smooth Chat Scroll Design

Status: approved via collaborative brainstorming (2026-08-26). Makes the Side Panel
chat follow new provider content smoothly instead of snapping, and raises the bottom
guard to 150px.

## 1. Goal

The Side Panel chat's history grows as the provider streams a reply, one line at a
time. Today the view follows the bottom with an **instant** `scrollTop = scrollHeight`
on every message update. When the user is pinned near the latest message, each new line
shifts the whole visible history up by exactly one line height in a single frame — a
sudden visual jump.

Two requirements:

1. **Smooth transition**: content-growth while pinned should glide, not snap — the same
   rate-adaptive feel the content-script popover already has for its animated panel
   height.
2. **Bottom guard = 150px**: within 150px of the bottom the view counts as pinned and
   auto-scrolls to the bottom **smoothly** while a message is generating; scrolling
   farther up pauses following so the user can read history.

Scope is the **Side Panel** (`src/sidepanel/`). The content-script popover's scroll
behavior (instant follow while streaming, smooth on discrete updates, 50px guard) is
left untouched.

## 2. Decisions

| Decision          | Choice                                                                                           | Rationale                                                                                             |
| ----------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Target surface    | Side Panel chat only                                                                             | The popover already animates smoothly; the user's reference is its feel, not its surface              |
| Mechanism         | Reuse the popover's easing: generalize `createStreamingHeightController` into a numeric controller and drive `scrollTop` with it | The Side Panel has a fixed `100dvh` layout — the panel height cannot grow, so the animated dimension is the scroll position |
| Follow style      | Rate-adaptive glide for **all** content growth while pinned (streaming or discrete)              | One animation model; the rate estimator naturally speeds up under token-stream growth and glides briskly on a burst |
| View transitions  | Entering chat / switching tools anchors **instantly**; no animation                              | Expected behavior for a mode switch; avoids a long glide across a full changed history                |
| Bottom guard      | `SCROLL_FOLLOW_THRESHOLD = 150` (was `SCROLL_PIN_THRESHOLD = 80`)                                 | Explicit requirement                                                                                  |
| Reduced motion    | Jump to the new bottom directly (no rAF glide)                                                    | `prefers-reduced-motion`; CSS cannot stop a rAF-driven `scrollTop` loop                               |

## 3. Architecture

No protocol, background, offscreen, content-messaging, or manifest changes. Purely the
Side Panel view plus a shared, pure animation primitive.

### 3.1 Generalize the controller (`src/dianzhi/ui/streaming-value-controller.ts`)

Move `src/content/views/streaming-height-controller.ts` to `src/dianzhi/ui/` and rename
it to `streaming-value-controller.ts`. It is pure math (no DOM/`@/content` imports), so
the shared `src/dianzhi/ui/` location is correct and the Side Panel can import it.

- `createStreamingHeightController(initialHeight, { minHeight, maxHeight, minimumSpeed, maximumSpeed, rateMemoryMs })`
  → `createStreamingValueController(initialValue, { min, max, minimumSpeed, maximumSpeed, rateMemoryMs })`.
  The `minHeight`/`maxHeight` option keys become `min`/`max` because the scalar is now
  a scroll position, not a height. Defaults stay: `min?: 0`, `max?: Infinity`,
  `minimumSpeed = 80`, `maximumSpeed = 1600`, `rateMemoryMs = 260`.

Behavior is unchanged: `observeTarget(nextTarget, now)` records a decayed recent growth
rate; `advance(now)` moves towards the target at a rate clamped to
`[minimumSpeed, maximumSpeed]` and chosen from the recent growth rate; `jumpToTarget()`
and `isSettled()`/`getValue()` round it out.

Consumers:
- `src/content/views/use-streaming-height-controller.ts` — update the import and the two
  `createStreamingHeightController(...)` calls to `createStreamingValueController(...)`
  with `min`/`max` keys. Behavior-neutral.
- `tests/unit/content/views/streaming-height-controller.spec.ts` — move to
  `tests/unit/dianzhi/ui/streaming-value-controller.spec.ts`, update import and option
  keys; all assertions stay.

### 3.2 `src/sidepanel/scroll-follow.ts` (new, replaces `scroll-pin.ts`)

One small module owning the threshold, the near-bottom predicate, and the follow hook —
mirroring the content script's `src/content/views/scroll-guard.ts` shape.

```ts
export const SCROLL_FOLLOW_THRESHOLD = 150

export function isNearBottom(container: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <=
    SCROLL_FOLLOW_THRESHOLD
  )
}

export interface ScrollFollowOptions {
  reducedMotion: boolean
  /** Conversation messages; a fresh reference (every snapshot update) re-runs follow. */
  messages: readonly unknown[] | null | undefined
  /** `${conversationId}:${activeToolId}` used to detect entering the chat / switching tools. */
  viewKey: string
}

export function useScrollFollow(
  containerRef: RefObject<HTMLDivElement | null>,
  options: ScrollFollowOptions
): () => void
```

`src/sidepanel/scroll-pin.ts` is deleted; `SidePanelView` is its only consumer.

### 3.3 `useScrollFollow` behavior

State: a `pinnedRef` (starts `true`), a `useRef`-held controller instance built with
scroll-appropriate speed bounds
(`createStreamingValueController(0, { minimumSpeed: 480, maximumSpeed: 2400 })` — chosen
so a one-off discrete burst (~one sent message) glides in well under a second while a
fast token stream still keeps up; tuning is validated during implementation), and a
single rAF handle.

- **User scroll** → returned `onScroll` updates `pinnedRef = isNearBottom(container)`.
- **Entering chat / switching tools** (`viewKey` changed) → instantly set
  `scrollTop = scrollHeight`, `pinnedRef = true`.
- **Fresh `messages` while pinned** (`scrollHeight > clientHeight`) →
  `observeTarget(max(0, scrollHeight - clientHeight), now)`, then a `requestAnimationFrame`
  loop sets `container.scrollTop = advance(now)` until `isSettled()`. Each frame checks
  `pinnedRef` first and cancels if the user scrolls away mid-animation. A later snapshot
  re-runs the effect: the previous frame is cancelled, the target is re-observed (rate
  memory persists in the controller), and the new chase starts from the current position.
- **Reduced motion** → `scrollTop = target` directly, no loop.

The rAF handle is cleared on unmount. With `messages` empty or the view unpinned, the
effect does nothing — history stays exactly where the user left it.

## 4. Behavior matrix

| State                                             | Result                                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Pinned (<150px from bottom), stream adds a line   | View glides down smoothly at a rate matching recent content growth                            |
| Pinned, discrete burst (own message / completion) | Fast glide to the new bottom (recent-rate estimator saturates toward the max speed)           |
| Entering chat / switching tools                   | Instant anchor to the latest message, no animation                                             |
| User scrolls >150px above the bottom              | Following pauses; new content does not move the viewport                                      |
| User returns within 150px of the bottom           | Following resumes on the next update                                                          |
| Reduced motion                                    | Jump straight to the new bottom                                                               |
| Content shorter than the container                | Treated as pinned; target clamped to 0                                                        |

## 5. Tests

- **`tests/unit/dianzhi/ui/streaming-value-controller.spec.ts`** (moved + renamed): the
  existing four controller cases unchanged except import and `min`/`max` option keys.
- **`tests/unit/sidepanel/scroll-follow.spec.ts`** (new): `SCROLL_FOLLOW_THRESHOLD ===
  150`; `isNearBottom` is pinned at gap 0 and 150, unpinned at gap 151 and beyond; a view
  shorter than its container counts as pinned.
- **`tests/unit/sidepanel/App.spec.tsx`** (extend, same `createRoot` + `act` style,
  stubbed `requestAnimationFrame`/`cancelAnimationFrame` and defined
  `scrollTop`/`scrollHeight`/`clientHeight`):
  - a streaming snapshot while pinned glides `scrollTop` toward the new bottom and settles
    at it across driven frames;
  - a user scroll 300px above the bottom is preserved across a subsequent streaming
    update;
  - returning within 150px resumes following on the next update;
  - reduced-motion mode jumps directly to the bottom;
  - a `viewKey` change (new conversation) anchors instantly.
- Existing suite must stay green: `pnpm run test`; lint and type gates for the moved
  module: `pnpm run lint`, `pnpm run build` (or `pnpm run typecheck`).

## 6. Files changed

| Path                                                              | Change                                                                        |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `src/dianzhi/ui/streaming-value-controller.ts`                    | **moved + renamed** from `src/content/views/streaming-height-controller.ts`; `min`/`max` options |
| `src/content/views/use-streaming-height-controller.ts`            | updated import + option keys (behavior-neutral)                               |
| `src/sidepanel/scroll-follow.ts`                                  | **new**: `SCROLL_FOLLOW_THRESHOLD = 150`, `isNearBottom`, `useScrollFollow`   |
| `src/sidepanel/scroll-pin.ts`                                     | **deleted** (superseded by `scroll-follow.ts`)                                 |
| `src/sidepanel/App.tsx`                                           | drop inline pin/scroll effects; wire `onHistoryScroll = useScrollFollow(...)` |
| `tests/unit/dianzhi/ui/streaming-value-controller.spec.ts`        | **moved + renamed** from `tests/unit/content/views/streaming-height-controller.spec.ts` |
| `tests/unit/sidepanel/scroll-follow.spec.ts`                      | **new** threshold + predicate tests                                           |
| `tests/unit/sidepanel/App.spec.tsx`                               | extended smooth-follow + guard cases                                           |
| `docs/superpowers/specs/2026-08-26-dianzhi-side-panel-smooth-chat-scroll-design.md` | this document                                                     |

## 7. Non-goals

- No change to the content-script popover's scroll behavior or its 50px guard (its pure
  controller is only relocated, never re-tuned).
- No animated panel-height growth in the Side Panel (the layout is a fixed `100dvh` flex
  column by design).
- No protocol, storage, background, offscreen, or manifest changes.