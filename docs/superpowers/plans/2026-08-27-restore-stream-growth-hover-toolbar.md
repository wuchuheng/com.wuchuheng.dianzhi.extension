# Restore Stream Growth and Hover Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore synchronized continuous growth for the latest streaming assistant message and make compact message toolbars visible only on hover or keyboard focus.

**Architecture:** `MessageList` identifies the latest assistant response and conditionally wraps it in the existing `StreamingMessageGrowth`. The wrapper's committed height delta is handed to `useScrollFollow`, which applies that exact delta under the strict 150px guard. Toolbar layout remains structurally stable while CSS controls only opacity and pointer interaction.

**Tech Stack:** React 19, TypeScript, CSS, Vitest, jsdom

**Spec:** `docs/superpowers/specs/2026-08-27-dianzhi-restore-stream-growth-hover-toolbar-design.md`

## Global Constraints

- Work directly on `main` because the user explicitly requested it.
- Preserve unrelated modified planning files.
- Synchronize scrolling only when the pre-growth bottom distance is strictly less than 150px.
- Respect `prefers-reduced-motion`.
- Keep toolbar actions keyboard accessible through `:focus-within`.

---

### Task 1: Restore latest-message growth and synchronized scrolling

**Files:**

- Modify: `tests/unit/dianzhi/ui/MessageList.spec.tsx`
- Modify: `tests/unit/sidepanel/App.spec.tsx`
- Modify: `src/dianzhi/ui/MessageList.tsx`
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/scroll-follow.ts`
- Modify: `src/sidepanel/App.css`

**Interfaces:**

- Consumes: `StreamingMessageGrowth({ streaming, reducedMotion, onHeightDelta, children })`
- Produces: `MessageListProps.smoothStreamingGrowth`, `MessageListProps.reducedMotion`, `MessageListProps.onStreamingHeightDelta`, and `ScrollFollowBindings.onStreamingHeightDelta(delta)`

- [x] **Step 1: Write a failing MessageList test**

Render two assistant messages with `smoothStreamingGrowth` enabled and assert that only the latest one is inside `.dz-streaming-message-growth`.

- [x] **Step 2: Run the focused test and verify RED**

Run: `pnpm exec vitest run tests/unit/dianzhi/ui/MessageList.spec.tsx`

Expected: FAIL because `MessageList` currently ignores the smooth-growth contract.

- [x] **Step 3: Restore the minimal MessageList wrapper integration**

Add the three growth props, find the latest assistant id, and wrap only that message with `StreamingMessageGrowth`.

- [x] **Step 4: Add and verify the Side Panel integration test**

Assert that a streaming Side Panel response renders `.dz-streaming-message-growth`, then run `pnpm exec vitest run tests/unit/sidepanel/App.spec.tsx` and observe RED before wiring the props.

- [x] **Step 5: Restore direct height-delta scroll synchronization**

Return `onStreamingHeightDelta(delta)` from `useScrollFollow`; call `syncScrollForHeightGrowth` only while pinned, and pass the callback through `SidePanelView` to `MessageList`.

- [x] **Step 6: Run focused tests and verify GREEN**

Run: `pnpm exec vitest run tests/unit/dianzhi/ui/MessageList.spec.tsx tests/unit/sidepanel/scroll-follow.spec.ts tests/unit/sidepanel/App.spec.tsx`

Expected: all focused tests pass.

### Task 2: Compact and reveal the toolbar without layout shift

**Files:**

- Modify: `src/sidepanel/App.css`
- Verify: `tests/unit/dianzhi/ui/MessageList.spec.tsx`

**Interfaces:**

- Consumes: the existing `.dz-message-item > .dz-message-meta` sibling structure
- Produces: stable 24px toolbar space with hover/focus visibility

- [x] **Step 1: Confirm the structural regression test**

Run the existing test that asserts `.dz-message-meta` is the message item's last child. This protects the stable reserved row required by the CSS behavior.

- [x] **Step 2: Apply the visual behavior**

Set `.dz-messages` gap to `4px`; keep `.dz-message-meta` at `min-height: 24px`; default it to `opacity: 0` and `pointer-events: none`; reveal it from `.dz-message-item:hover` and `.dz-message-item:focus-within` using a 140ms opacity/transform transition. Do not use `visibility: hidden`, because that would remove the buttons from keyboard focus navigation. Keep the toolbar backgroundless.

- [x] **Step 3: Verify reduced motion and focused controls**

Add a reduced-motion rule that removes the toolbar transition and retain native buttons so tab focus activates `:focus-within`.

- [x] **Step 4: Run all gates**

Run: `pnpm run format:check`, `pnpm run lint`, `pnpm run test`, and `pnpm run build`.

Expected: all commands exit 0 with no test failures.
