# Side Panel Smooth Chat Scroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Side Panel chat history follow new provider content smoothly (glide instead of snap) while near the bottom, with the bottom guard raised from 80px to 150px.

**Architecture:** Generalize the content popover's pure rate-adaptive easing controller (`createStreamingHeightController` → `createStreamingValueController`) and move it to `src/dianzhi/ui/`. A new `useScrollFollow` hook in `src/sidepanel/` drives the history's `scrollTop` toward the newest bottom every animation frame while pinned (within 150px), using that controller's growth-adaptive speed — the same feel as the popover's animated height. Entering chat / switching tools anchors instantly; reduced motion jumps. The Side Panel panel height stays fixed (`100dvh` flex column); only the scroll position is animated.

**Tech Stack:** TypeScript, React 19 (side panel + content popover), vitest + jsdom unit tests. No protocol, background, offscreen, or manifest changes.

**Spec:** `docs/superpowers/specs/2026-08-26-dianzhi-side-panel-smooth-chat-scroll-design.md` (approved 2026-08-26).

---

### Task 1: Generalize the streaming controller into `src/dianzhi/ui/`

**Files:**

- Rename: `src/content/views/streaming-height-controller.ts` → `src/dianzhi/ui/streaming-value-controller.ts`
- Modify: `src/content/views/use-streaming-height-controller.ts`
- Rename: `tests/unit/content/views/streaming-height-controller.spec.ts` → `tests/unit/dianzhi/ui/streaming-value-controller.spec.ts`
- Modify: `eslint.config.js`

- [ ] **Step 1: Move the spec and update it to the generalized names**

```bash
git mv tests/unit/content/views/streaming-height-controller.spec.ts \
        tests/unit/dianzhi/ui/streaming-value-controller.spec.ts
```

Rewrite `tests/unit/dianzhi/ui/streaming-value-controller.spec.ts` so its full content is:

```ts
import { describe, expect, it } from 'vitest'
import { createStreamingValueController } from '@/dianzhi/ui/streaming-value-controller'

describe('streaming value controller', () => {
  it('advances by equal distances between unchanged generation updates', () => {
    const controller = createStreamingValueController(200)

    controller.observeTarget(200, 0)
    controller.observeTarget(320, 100)
    controller.advance(100)
    const at150 = controller.advance(150)
    const at200 = controller.advance(200)

    expect(at150 - 200).toBeCloseTo(at200 - at150, 6)
  })

  it('uses a faster catch-up speed after faster recent growth', () => {
    const slow = createStreamingValueController(200)
    slow.observeTarget(200, 0)
    slow.observeTarget(220, 100)
    slow.advance(100)
    const slowValue = slow.advance(200)

    const fast = createStreamingValueController(200)
    fast.observeTarget(200, 0)
    fast.observeTarget(320, 100)
    fast.advance(100)
    const fastValue = fast.advance(200)

    expect(fastValue - 200).toBeGreaterThan(slowValue - 200)
  })

  it('never grows beyond the configured upper bound', () => {
    const controller = createStreamingValueController(200, { max: 280 })

    controller.observeTarget(600, 100)
    controller.advance(100)
    const value = controller.advance(2_000)

    expect(value).toBe(280)
  })

  it('keeps the initial reserved value when empty content is shorter', () => {
    const controller = createStreamingValueController(280, { min: 280, max: 560 })

    controller.observeTarget(120, 100)
    controller.advance(100)
    const value = controller.advance(2_000)

    expect(value).toBe(280)
  })

  it('seeds the current value without resetting the recorded growth rate', () => {
    const controller = createStreamingValueController(200)

    controller.observeTarget(220, 0)
    controller.observeTarget(320, 100)
    controller.setValue(80)

    expect(controller.getValue()).toBe(80)
    // Still hastened by the earlier 100px/100ms burst (rate ~1000px/s).
    expect(controller.advance(200)).toBeGreaterThan(80)
  })
})
```

- [ ] **Step 2: Run the moved spec to verify it fails**

Run: `pnpm exec vitest run tests/unit/dianzhi/ui/streaming-value-controller.spec.ts`
Expected: FAIL — `Cannot find module '@/dianzhi/ui/streaming-value-controller'` (5 tests).

- [ ] **Step 3: Move and generalize the controller module**

```bash
git mv src/content/views/streaming-height-controller.ts \
        src/dianzhi/ui/streaming-value-controller.ts
```

Rewrite `src/dianzhi/ui/streaming-value-controller.ts` so its full content is:

```ts
export interface StreamingValueControllerOptions {
  min?: number
  max?: number
  minimumSpeed?: number
  maximumSpeed?: number
  rateMemoryMs?: number
}

const DEFAULT_MAXIMUM_VALUE = Number.POSITIVE_INFINITY
const DEFAULT_MINIMUM_SPEED = 80
const DEFAULT_MAXIMUM_SPEED = 1600
const DEFAULT_RATE_MEMORY_MS = 260

/**
 * Interpolates a numeric value toward an observed target at a speed that tracks
 * recent target growth, so fast growth (a token stream) keeps up while slow
 * growth glides gently. Pure math — no DOM. Used for the content popover's
 * panel height and the Side Panel's chat scroll position.
 */
export function createStreamingValueController(
  initialValue: number,
  options: StreamingValueControllerOptions = {}
) {
  const max = options.max ?? DEFAULT_MAXIMUM_VALUE
  const min = Math.min(options.min ?? 0, max)
  const minimumSpeed = options.minimumSpeed ?? DEFAULT_MINIMUM_SPEED
  const maximumSpeed = options.maximumSpeed ?? DEFAULT_MAXIMUM_SPEED
  const rateMemoryMs = options.rateMemoryMs ?? DEFAULT_RATE_MEMORY_MS
  let value = Math.min(Math.max(initialValue, min), max)
  let target = value
  let recentGrowthRate = 0
  let lastObservedTarget = value
  let lastObservedAt: number | null = null
  let lastAdvancedAt: number | null = null

  function observeTarget(nextTarget: number, now: number) {
    target = Math.min(Math.max(nextTarget, min), max)
    if (lastObservedAt !== null && now > lastObservedAt) {
      const elapsed = now - lastObservedAt
      const growth = Math.max(0, target - lastObservedTarget)
      const decay = Math.exp(-elapsed / rateMemoryMs)
      const instantRate = (growth / elapsed) * 1_000
      recentGrowthRate = recentGrowthRate * decay + instantRate * (1 - decay)
    }
    lastObservedTarget = target
    lastObservedAt = now
  }

  function advance(now: number): number {
    if (lastAdvancedAt === null) {
      lastAdvancedAt = now
      return value
    }
    const elapsed = Math.max(0, now - lastAdvancedAt)
    lastAdvancedAt = now
    if (value === target) return value
    const speed = Math.min(Math.max(recentGrowthRate, minimumSpeed), maximumSpeed)
    const distance = Math.min(speed * (elapsed / 1_000), Math.abs(target - value))
    value += Math.sign(target - value) * distance
    return value
  }

  function jumpToTarget(): number {
    value = target
    return value
  }

  function setValue(nextValue: number) {
    value = Math.min(Math.max(nextValue, min), max)
    target = value
  }

  function isSettled() {
    return value === target
  }

  function getValue() {
    return value
  }

  return { advance, getValue, isSettled, jumpToTarget, observeTarget, setValue }
}
```

- [ ] **Step 4: Run the moved spec to verify it passes**

Run: `pnpm exec vitest run tests/unit/dianzhi/ui/streaming-value-controller.spec.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Update the content popover hook**

In `src/content/views/use-streaming-height-controller.ts`:

1. Line 2 — change the import to:

```ts
import { createStreamingValueController } from '@/dianzhi/ui/streaming-value-controller'
```

2. The `controllerRef` initializer (currently lines 27–32) — change to:

```ts
const controllerRef = useRef(
  createStreamingValueController(minimumHeight, {
    min: minimumHeight,
    max: maximumHeight,
  })
)
```

3. Line 51 — `controllerRef.current.getHeight()` → `controllerRef.current.getValue()`.

4. The re-created controller in the previously-invisible branch (currently lines 57–60) — change to:

```ts
controllerRef.current = createStreamingValueController(targetHeight, {
  min: minimumHeight,
  max: maximumHeight,
})
```

- [ ] **Step 6: Update the eslint allow-list**

In `eslint.config.js`, inside `allowDefaultProject`:

- Remove `'tests/unit/content/views/streaming-height-controller.spec.ts'` (line 78).
- Add `'tests/unit/dianzhi/ui/streaming-value-controller.spec.ts'` right after
  `'tests/unit/dianzhi/ui/ToolTabs.spec.tsx'` (line 90).

- [ ] **Step 7: Verify**

Run: `pnpm exec tsc -b` → exit 0.
Run: `pnpm exec vitest run tests/unit/dianzhi/ui/streaming-value-controller.spec.ts tests/unit/content/views/App.spec.tsx tests/unit/content/views/useScrollGuard.spec.tsx` → all PASS (the popover is behavior-neutral).

- [ ] **Step 8: Commit**

```bash
git add src/dianzhi/ui/streaming-value-controller.ts \
        src/content/views/streaming-height-controller.ts \
        src/content/views/use-streaming-height-controller.ts \
        tests/unit/dianzhi/ui/streaming-value-controller.spec.ts \
        tests/unit/content/views/streaming-height-controller.spec.ts \
        eslint.config.js
git commit -m "refactor(ui): generalize streaming-height-controller into shared streaming-value-controller"
```

---

### Task 2: `src/sidepanel/scroll-follow.ts` with the 150px guard

**Files:**

- Create: `src/sidepanel/scroll-follow.ts`
- Test: `tests/unit/sidepanel/scroll-follow.spec.ts` (new)
- Modify: `eslint.config.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/sidepanel/scroll-follow.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { isNearBottom, SCROLL_FOLLOW_THRESHOLD } from '@/sidepanel/scroll-follow'

function container(
  overrides: Partial<{ scrollTop: number; scrollHeight: number; clientHeight: number }> = {}
) {
  return { scrollTop: 0, scrollHeight: 1000, clientHeight: 300, ...overrides }
}

describe('Side Panel scroll follow', () => {
  it('exposes the 150px threshold used by the chat scroll follow', () => {
    expect(SCROLL_FOLLOW_THRESHOLD).toBe(150)
  })

  it('is pinned while the distance to the bottom is within the threshold', () => {
    expect(isNearBottom(container({ scrollTop: 700 }))).toBe(true) // gap 0
    expect(isNearBottom(container({ scrollTop: 850 }))).toBe(true) // gap 150
    expect(isNearBottom(container({ scrollTop: 880 }))).toBe(true) // gap 120
  })

  it('is unpinned once the distance to the bottom exceeds the threshold', () => {
    expect(isNearBottom(container({ scrollTop: 849 }))).toBe(false) // gap 151
    expect(isNearBottom(container({ scrollTop: 400 }))).toBe(false) // gap 600
  })

  it('treats a view shorter than its container as pinned', () => {
    expect(isNearBottom(container({ scrollHeight: 200 }))).toBe(true)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/sidepanel/scroll-follow.spec.ts`
Expected: FAIL — `Cannot find module '@/sidepanel/scroll-follow'` (4 tests).

- [ ] **Step 3: Create the module**

Create `src/sidepanel/scroll-follow.ts` with the following full content:

```ts
import { useCallback, useEffect, useLayoutEffect, useRef, type RefObject } from 'react'
import { createStreamingValueController } from '@/dianzhi/ui/streaming-value-controller'

/**
 * Distance from the bottom edge (px) at which the Side Panel conversation view
 * still counts as "pinned to the latest message". While pinned, new streamed
 * content glides the view to the latest bottom; scrolling farther up unpins so
 * the user can read history without being yanked back down.
 */
export const SCROLL_FOLLOW_THRESHOLD = 150

export function isNearBottom(container: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <= SCROLL_FOLLOW_THRESHOLD
  )
}

export interface ScrollFollowOptions {
  /** Jump straight to the bottom instead of gliding (`prefers-reduced-motion`). */
  reducedMotion: boolean
  /** Conversation messages; a fresh reference (every snapshot update) re-runs the follow. */
  messages: readonly unknown[] | null | undefined
  /** `${conversationId}:${activeToolId}` used to detect entering chat / switching tools. */
  viewKey: string
}

/**
 * Smoothly follows the latest message in the Side Panel history while the user
 * is near the bottom (within `SCROLL_FOLLOW_THRESHOLD` px). Content growth while
 * pinned glides the scroll position at a rate adapted to recent growth — the
 * same feel as the content popover's animated height. Scrolling farther up
 * pauses following so history reads stay put; entering chat or switching tools
 * (a `viewKey` change) anchors instantly. Reduced motion jumps instead of
 * gliding. Returns the `onScroll` handler that keeps the pinned state in sync
 * with the user's position.
 */
export function useScrollFollow(
  containerRef: RefObject<HTMLDivElement | null>,
  { reducedMotion, messages, viewKey }: ScrollFollowOptions
): () => void {
  const controllerRef = useRef(
    createStreamingValueController(0, { minimumSpeed: 480, maximumSpeed: 2400 })
  )
  const pinnedRef = useRef(true)
  const animationFrameRef = useRef<number | null>(null)
  const previousViewKeyRef = useRef(viewKey)

  const stopAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
  }, [])

  const onScroll = useCallback(() => {
    const container = containerRef.current
    if (container) pinnedRef.current = isNearBottom(container)
  }, [containerRef])

  // Entering chat or switching tools anchors at the latest message.
  useLayoutEffect(() => {
    if (previousViewKeyRef.current === viewKey) return
    previousViewKeyRef.current = viewKey
    pinnedRef.current = true
    const container = containerRef.current
    if (container) container.scrollTop = container.scrollHeight
  }, [containerRef, viewKey])

  // Follow new content while pinned: glide the scroll position toward the
  // newest bottom each frame at a speed that tracks recent content growth.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container || !pinnedRef.current || !messages || messages.length === 0) return
    const target = Math.max(0, container.scrollHeight - container.clientHeight)
    if (reducedMotion) {
      container.scrollTop = target
      return
    }
    const now = performance.now()
    // The controller's value can be stale (a view anchor or the user's wheel
    // moved the scroll position outside the animation loop), so seed the chase
    // at the current position before observing the new target.
    controllerRef.current.setValue(container.scrollTop)
    controllerRef.current.observeTarget(target, now)
    const animate = (frameNow: number) => {
      if (!pinnedRef.current) {
        stopAnimation()
        return
      }
      container.scrollTop = controllerRef.current.advance(frameNow)
      if (!controllerRef.current.isSettled()) {
        animationFrameRef.current = window.requestAnimationFrame(animate)
      }
    }
    animationFrameRef.current = window.requestAnimationFrame(animate)
    return stopAnimation
  }, [containerRef, messages, reducedMotion, stopAnimation])

  useEffect(() => stopAnimation, [stopAnimation])

  return onScroll
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/sidepanel/scroll-follow.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the spec to the eslint allow-list**

In `eslint.config.js`, inside `allowDefaultProject`, add `'tests/unit/sidepanel/scroll-follow.spec.ts'` right after `'tests/unit/sidepanel/App.spec.tsx'`.

- [ ] **Step 6: Commit**

```bash
git add src/sidepanel/scroll-follow.ts tests/unit/sidepanel/scroll-follow.spec.ts eslint.config.js
git commit -m "feat(sidepanel): add smooth scroll-follow hook with 150px bottom guard"
```

---

### Task 3: Wire `useScrollFollow` into `SidePanelView`

**Files:**

- Modify: `src/sidepanel/App.tsx`
- Delete: `src/sidepanel/scroll-pin.ts`
- Modify: `tests/unit/sidepanel/App.spec.tsx`

- [ ] **Step 1: Write the failing hook-integration tests**

In `tests/unit/sidepanel/App.spec.tsx`:

1. Update the protocol import (line 4) to:

```ts
import type { ConversationSnapshot, MessageRecord } from '@/dianzhi/domain/protocol'
```

2. Add this helper after the `installChrome` function (around line 59):

```ts
function stubMatchMedia(matches: boolean) {
  window.matchMedia = vi.fn(
    () =>
      ({
        matches,
        media: '',
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }) as unknown as MediaQueryList
  ) as unknown as typeof window.matchMedia
}
```

3. In the top-level `beforeEach` (after `installChrome()`, around line 73), add:

```ts
stubMatchMedia(false)
```

4. Append this new `describe` block at the end of the file:

```tsx
describe('Side Panel smooth chat scroll', () => {
  let frameCallback: ((now: number) => void) | null
  let nextFrameId: number

  const message = (sequence: number, content: string): MessageRecord => ({
    id: sequence,
    conversationId: 22,
    sequence,
    role: 'assistant',
    content,
    reasoningContent: '',
    status: 'streaming',
    errorCode: null,
    errorMessage: null,
    createdAt: '2026-08-22T00:00:00.000Z',
    updatedAt: '2026-08-22T00:00:00.000Z',
  })

  const history = () => {
    const element = host?.querySelector<HTMLDivElement>('.dz-panel-history')
    if (!element) throw new Error('.dz-panel-history not found')
    return element
  }

  const defineMetrics = () => {
    const element = history()
    Object.defineProperty(element, 'clientHeight', { value: 300, configurable: true })
    Object.defineProperty(element, 'scrollHeight', { value: 1000, configurable: true })
    Object.defineProperty(element, 'scrollTop', { value: 0, writable: true, configurable: true })
    return element
  }

  const grow = (scrollHeight: number) => {
    const element = history()
    Object.defineProperty(element, 'scrollHeight', { value: scrollHeight, configurable: true })
    return element
  }

  const userScroll = (scrollTop: number) => {
    const element = history()
    element.scrollTop = scrollTop
    element.dispatchEvent(new Event('scroll'))
  }

  const syncMessages = async (messages: MessageRecord[]) => {
    const next = snapshot()
    next.messages = messages
    await act(async () => {
      port.emitMessage({ type: 'conversation.sync', snapshot: next })
      await Promise.resolve()
    })
  }

  const driveFrames = (count = 300) => {
    let now = 1_000
    for (let i = 0; i < count && frameCallback !== null; i++) {
      const cb = frameCallback
      frameCallback = null
      cb(now)
      now += 33
    }
  }

  const openEmptyHistory = async () => {
    await renderApp()
    await act(async () => {
      port.emitMessage({ type: 'conversation.sync', snapshot: snapshot() })
      await Promise.resolve()
    })
  }

  beforeEach(() => {
    frameCallback = null
    nextFrameId = 0
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      frameCallback = cb
      return ++nextFrameId
    })
    vi.stubGlobal('cancelAnimationFrame', () => {
      frameCallback = null
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('glides to the newest bottom while pinned as a reply streams', async () => {
    await openEmptyHistory()
    defineMetrics()

    await syncMessages([message(1, 'first line')])
    expect(frameCallback).not.toBeNull()
    driveFrames()
    expect(history().scrollTop).toBe(700)

    grow(1300)
    await syncMessages([message(1, 'first line\nsecond line'), message(2, 'third line')])
    expect(frameCallback).not.toBeNull()
    driveFrames()
    expect(history().scrollTop).toBe(1000)
  })

  it('keeps following when the user is within 150px of the bottom', async () => {
    await openEmptyHistory()
    defineMetrics()
    await syncMessages([message(1, 'first line')])

    // 120px from the bottom: inside the new 150px guard, outside the old 80px.
    userScroll(700 - 120)
    grow(1200)
    await syncMessages([message(1, 'first line'), message(2, 'grown')])
    expect(frameCallback).not.toBeNull()
    driveFrames()
    expect(history().scrollTop).toBe(900)
  })

  it('pauses following beyond the guard and resumes within it', async () => {
    await openEmptyHistory()
    defineMetrics()
    await syncMessages([message(1, 'first line')])

    // 600px above the bottom: far outside the guard, following pauses.
    userScroll(1000 - 300 - 600)
    grow(1200)
    await syncMessages([message(1, 'first line'), message(2, 'grown')])
    expect(frameCallback).toBeNull()
    expect(history().scrollTop).toBe(1000 - 300 - 600)

    // Back inside the guard: following resumes on the next update.
    userScroll(1200 - 300 - 50)
    grow(1400)
    await syncMessages([message(1, 'first line'), message(2, 'grown again')])
    expect(frameCallback).not.toBeNull()
    driveFrames()
    expect(history().scrollTop).toBe(1100)
  })

  it('jumps straight to the bottom under reduced motion', async () => {
    stubMatchMedia(true)
    await openEmptyHistory()
    defineMetrics()

    await syncMessages([message(1, 'first line')])
    expect(frameCallback).toBeNull()
    expect(history().scrollTop).toBe(700)
  })

  it('anchors instantly when the conversation switches', async () => {
    await openEmptyHistory()
    defineMetrics()
    history().scrollTop = 123
    await syncMessages([message(1, 'first line')])
    driveFrames()
    expect(history().scrollTop).toBe(700)

    const other = snapshot()
    other.conversation.id = 23
    other.messages = [message(1, 'other context')]
    await act(async () => {
      port.emitMessage({ type: 'conversation.sync', snapshot: other })
      await Promise.resolve()
    })
    expect(history().scrollTop).toBe(1000)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/sidepanel/App.spec.tsx`
Expected: FAIL — the 5 new cases fail on the current instant-snap code:

- `glides…`: old code never schedules an animation frame (`frameCallback` stays null).
- `keeps following within 150px…`: the old 80px guard treats a 120px gap as unpinned, so no follow.
- `pauses following…`: after resuming within the guard the old code snaps instead of gliding, so no frame is scheduled.
- `jumps straight to the bottom under reduced motion`: the old code snaps to `scrollHeight` (1000), not the clamped bottom (700).
- `anchors instantly…`: the old code snaps to `scrollHeight` (1000) on the first update instead of settling at the bottom (700).

The existing 3 dock/composer tests must still pass.

- [ ] **Step 3: Wire `SidePanelView` to the hook**

In `src/sidepanel/App.tsx`:

1. Line 19 — replace

```ts
import { isNearBottom } from './scroll-pin'
```

with

```ts
import { useScrollFollow } from './scroll-follow'
```

2. Replace the whole per-view scroll block (from `const historyRef = useRef...` through the `onHistoryScroll` callback, currently lines 53–87) with:

```tsx
const historyRef = useRef<HTMLDivElement | null>(null)
const composerRef = useRef<HTMLTextAreaElement | null>(null)
const hasSnapshot = snapshot !== null
const viewKey = `${snapshot?.conversation.id ?? ''}:${snapshot?.activeToolId ?? ''}`

useEffect(() => {
  // Focus the chat input once a conversation is attached; `streaming` flips
  // stay in the deps so focus returns to the input right after a send.
  if (!hasSnapshot) return
  composerRef.current?.focus()
}, [viewKey, streaming, hasSnapshot])

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const onHistoryScroll = useScrollFollow(historyRef, {
  reducedMotion,
  messages: snapshot?.messages,
  viewKey,
})
```

(`viewKey`, `historyRef`, `composerRef`, `hasSnapshot`, and the focus effect are unchanged in purpose; `pinnedRef`, `previousViewKey`, the old `messages` snap-sync effect, and the old `onHistoryScroll` are gone.)

- [ ] **Step 4: Delete the superseded pin module**

```bash
git rm src/sidepanel/scroll-pin.ts
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/sidepanel/App.spec.tsx tests/unit/sidepanel/scroll-follow.spec.ts`
Expected: PASS (3 + 4 + 5 new scroll cases).

- [ ] **Step 6: Verify the full suite + types**

Run: `pnpm exec tsc -b` → exit 0.
Run: `pnpm exec vitest run` → all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/sidepanel/App.tsx src/sidepanel/scroll-pin.ts tests/unit/sidepanel/App.spec.tsx
git commit -m "feat(sidepanel): smooth-scroll chat follow while pinned near the bottom"
```

---

### Task 4: Gates and final verification

**Files:** none expected.

- [ ] **Step 1: Format check**

Run: `pnpm run format:check`
Expected: PASS. If only feature files need fixes, run prettier on them and re-check.

- [ ] **Step 2: Lint + type check**

Run: `pnpm exec tsc -b` → exit 0.
Run: `pnpm run lint`. The repo-wide gate passed as of `16de01e`; verify by classification that any errors are **not** in files this feature changed: `src/dianzhi/ui/streaming-value-controller.ts`, `src/content/views/use-streaming-height-controller.ts`, `src/sidepanel/scroll-follow.ts`, `src/sidepanel/App.tsx`, `tests/unit/dianzhi/ui/streaming-value-controller.spec.ts`, `tests/unit/sidepanel/scroll-follow.spec.ts`, `tests/unit/sidepanel/App.spec.tsx`, `eslint.config.js`. Report the classification; do not fix unrelated files.

- [ ] **Step 3: Unit tests**

Run: `pnpm run test`
Expected: all PASS (all spec files).

- [ ] **Step 4: Production build**

Run: `pnpm run build`
Expected: completes (vendors SQLite, `tsc -b`, vite build). Do not hand-edit `dist/`.

- [ ] **Step 5: Drift check**

Run `/drift-check` and resolve any findings that point at this feature.

- [ ] **Step 6: Commit any fixes (only if a gate above needed a fix to a feature file)**

```bash
git add -A
git commit -m "chore: post-gate fixes for side panel smooth chat scroll"
```

---

## Self-Review Notes

- **Spec coverage:** §3.1 controller generalization ⇢ Task 1; §3.2/§3.3 `scroll-follow.ts` + `useScrollFollow` + 150px guard ⇢ Task 2; wiring + App.spec behavior matrix ⇢ Task 3; §5 tests across Tasks 1–3; §6 files all touched. The popover's own scroll behavior and 50px guard are untouched (Task 1 is behavior-neutral).
- **Placeholder scan:** no TBD/TODO; every step has full code or exact commands.
- **Type consistency:** `createStreamingValueController` + options `min`/`max` + `setValue`/`getValue`/`observeTarget`/`advance`/`jumpToTarget`/`isSettled` are used identically in Task 1 (module + spec), Task 2 (hook), and the content hook update. `SCROLL_FOLLOW_THRESHOLD`/`isNearBottom`/`useScrollFollow`/`ScrollFollowOptions` are consistent between Task 2 and Task 3. Test helper names (`defineMetrics`, `grow`, `userScroll`, `syncMessages`, `driveFrames`, `openEmptyHistory`, `history()`) are self-consistent within Task 3.
- **jsdom constraints encoded in the plan:** `window.matchMedia` is undefined in this jsdom (probed) so Task 3 stubs it for every App.spec render; `rAF`/`cAF` exist and are stubbed per-test so the glide is driven deterministically; `scrollTop`/`clientHeight`/`scrollHeight` are instance-defined because jsdom has no layout.
- **Known tuning knob:** the scroll controller's speed bounds (`minimumSpeed: 480`, `maximumSpeed: 2400` px/s) set the glide feel; if real-world usage feels too sluggish under a multi-second gap or laggy on slow tokens, adjust those two constants and re-run the App.spec glide values.
