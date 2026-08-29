# Routed CS-to-Side-Panel Stream Handoff Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route an active provider stream from Content Script to Side Panel without losing text or terminal status, then close Content only after Side Panel commits the synchronized conversation.

**Architecture:** Background owns an in-memory `DeliveryRoute` with a `to` field. Side Panel synchronization and all later `ConversationUpdate` values use the existing ordered conversation port; control-only commands remain separate. Conversation Manager returns a live-authoritative snapshot, and failed handoff restores the Content route and resynchronizes Content without restarting the provider.

**Tech Stack:** TypeScript, React, Chrome Extension Manifest V3 APIs, Vitest, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-29-lossless-cs-side-panel-stream-handoff-design.md`

## Global Constraints

- Background remains the sole broker and routing authority.
- Provider and conversation code emit ordinary `ConversationUpdate` values and never choose a UI.
- Handoff readiness, `conversation.sync`, and later stream events share `sidePanelConversationUpdate`.
- Content remains visible and receives updates until the Side Panel conversation port is ready.
- Content closes only after the panel commits and acknowledges the synchronized reducer state.
- A failed handoff routes back to Content and sends it a fresh authoritative `conversation.sync`.
- A successful handoff persists `sidePanelAppeared = true`, `contentUIAppeared = false`, `latestUI = 'sidePanel'`, and no `contentRestore`.
- Do not change provider behavior, database schema, scrolling, animation, Markdown, or toolbar styling.
- Preserve unrelated `manifest.config.ts` and `docs/chrome-web-store-listing.zh-CN.md` changes.

---

### Task 0: Remove the superseded partial implementation

**Files:**

- Restore to `HEAD`: `src/dianzhi/domain/ui-session-protocol.ts`
- Restore to `HEAD`: `src/events/config.ts`
- Restore to `HEAD`: `src/background/index.ts`
- Restore to `HEAD`: `src/background/ui-session-runtime.ts`
- Restore to `HEAD`: `src/background/ui-session-coordinator.ts`
- Restore to `HEAD`: `src/sidepanel/App.tsx`
- Restore to `HEAD`: `tests/unit/events/side-panel-event.spec.ts`
- Restore to `HEAD`: `tests/unit/background/ui-session-runtime.spec.ts`
- Restore to `HEAD`: `tests/unit/background/ui-session-coordinator.spec.ts`
- Restore to `HEAD`: `tests/unit/sidepanel/App.spec.tsx`

**Interfaces:**

- Consumes: the committed two-port implementation at `HEAD`.
- Produces: a clean product-code baseline with `sidePanelCommand` and `sidePanelConversationUpdate`, while retaining all documentation and unrelated user changes.

- [ ] **Step 1: Reverse only the uncommitted superseded product/test diffs**

Use the current `git diff` to apply the inverse patch only to the ten listed files. Do not restore `manifest.config.ts`, the store listing, planning notes, or committed specification.

- [ ] **Step 2: Verify the restored focused baseline**

Run:

```bash
pnpm exec vitest run tests/unit/events/side-panel-event.spec.ts tests/unit/background/ui-session-runtime.spec.ts tests/unit/background/ui-session-coordinator.spec.ts tests/unit/sidepanel/App.spec.tsx
```

Expected: the original focused suites pass and `rg "sidePanelDelivery|panelHandoffs" src tests` returns no matches.

---

### Task 1: Preserve the newest live snapshot

**Files:**

- Modify: `src/background/conversation-manager.ts`
- Test: `tests/unit/background/conversation-manager.spec.ts`

**Interfaces:**

- Consumes: persisted selection snapshots and `liveSnapshots` maintained by `publish()`.
- Produces: existing `loadSelectionSession(selectionSessionId)` with live-authoritative reconciliation and clone isolation.

- [ ] **Step 1: Write a failing live-over-persisted regression test**

Create a selection snapshot whose stored assistant message is `streaming` with content `stored`. Publish a later `stream.delta` containing ` live`, then call `loadSelectionSession(10)` while the database still returns `stored`. Assert the returned assistant content is `stored live`, its live status is preserved, and mutating the returned object does not mutate the next returned snapshot.

The production mutation caught by this test is `loadSelectionSession` replacing an existing `liveSnapshots` entry with the older database result.

- [ ] **Step 2: Run the focused test and verify RED**

```bash
pnpm exec vitest run tests/unit/background/conversation-manager.spec.ts
```

Expected: returned content is the stale persisted value.

- [ ] **Step 3: Reconcile the stored selection with live state**

In `loadSelectionSession`, build the persisted snapshot, look up its active conversation ID in `liveSnapshots`, and return a clone of the live value when present. Only seed `liveSnapshots` from persisted state when no live value exists.

Do not add a second public manager method or modify provider execution.

- [ ] **Step 4: Run the focused test and verify GREEN**

```bash
pnpm exec vitest run tests/unit/background/conversation-manager.spec.ts
```

Expected: all manager tests pass, including live content/status precedence and clone isolation.

---

### Task 2: Make the conversation port the ordered render boundary

**Files:**

- Modify: `src/background/index.ts`
- Modify: `src/sidepanel/App.tsx`
- Test: `tests/unit/events/side-panel-event.spec.ts`
- Test: `tests/unit/sidepanel/App.spec.tsx`

**Interfaces:**

- Consumes: existing `sidePanelCommand`, `sidePanelConversationUpdate`, and `ConversationUpdate`.
- Produces: Side Panel dependency methods `ready(windowId)` and `publish(windowId, update)` backed by `sidePanelConversationUpdate`; synchronized React commit acknowledgement from the Side Panel update handler.

- [ ] **Step 1: Write failing ordered-delivery and commit-acknowledgement tests**

In `side-panel-event.spec.ts`, instantiate one `bg2sp<ConversationUpdate, true>` event, post `conversation.sync`, `stream.delta`, and `stream.done`, and assert all three request payloads are posted to the same fake port in that literal order.

In `App.spec.tsx`, emit those three updates through `sidePanelConversationUpdate`. Assert the `conversation.sync` callback promise resolves only after the synchronized message is present in the DOM, then assert the final content is visible and the generating indicator is absent after `stream.done`.

The production mutations caught are routing sync through the command port or acknowledging before React commits synchronized state.

- [ ] **Step 2: Run the focused tests and verify RED**

```bash
pnpm exec vitest run tests/unit/events/side-panel-event.spec.ts tests/unit/sidepanel/App.spec.tsx
```

Expected: the new UI test fails because current handoff rendering uses `sidePanelCommand` and the update handler acknowledges immediately after queuing reducer work.

- [ ] **Step 3: Commit Side Panel conversation updates synchronously before acknowledgement**

Use React DOM's `flushSync` at the external port callback boundary:

```ts
const updateHandle = sidePanelConversationUpdate.handle(binding, async (update) => {
  flushSync(() => dispatch(update))
  return true
})
```

Keep `sidePanelCommand` for `clear` and other control-only operations. Do not create a universal `SidePanelDelivery` union.

- [ ] **Step 4: Wire readiness to the conversation port**

In `src/background/index.ts`, keep command dispatch unchanged, keep live publication on `sidePanelConversationUpdate`, and change only:

```ts
ready: async (windowId) => sidePanelConversationUpdate.waitForWindow(windowId)
```

The coordinator in Task 3 will use `publish(windowId, { type: 'conversation.sync', snapshot })` for handoff and `conversation.toolChanged` for data-bearing tool changes.

- [ ] **Step 5: Run the focused tests and verify GREEN**

```bash
pnpm exec vitest run tests/unit/events/side-panel-event.spec.ts tests/unit/sidepanel/App.spec.tsx tests/unit/background/ui-session-runtime.spec.ts
```

Expected: ordered conversation delivery, DOM commit acknowledgement, and existing runtime port registration all pass.

---

### Task 3: Route handoff with `DeliveryRoute.to`

**Files:**

- Modify: `src/background/ui-session-coordinator.ts`
- Test: `tests/unit/background/ui-session-coordinator.spec.ts`

**Interfaces:**

- Consumes: live-authoritative `loadSelectionSession`, conversation-port `ready`, and acknowledged `sidePanel.publish`.
- Produces:

```ts
type DeliveryRoute = { to: 'contentScript' } | { to: 'sidePanel'; windowId: number }
```

and one owner router used by every `publish(tabId, update)` call.

- [ ] **Step 1: Write a failing midstream handoff test**

Use independently controlled `ready` and synchronized-render promises. Assert:

1. while `ready` is pending, `stream.delta` goes to Content and Content is not destroyed;
2. after `ready`, `conversation.sync` is the first Side Panel publication;
3. before sync acknowledgement, `stream.done` goes to Side Panel after sync and Content remains visible;
4. after acknowledgement, Content is destroyed and persisted state has only Side Panel visible, `latestUI = 'sidePanel'`, and no `contentRestore`;
5. a later update continues to Side Panel.

The production mutation caught is destroying Content or changing durable ownership before the acknowledged synchronization barrier.

- [ ] **Step 2: Write failing recovery and invalidation tests**

Cover ready failure, sync rejection, Content-destroy failure, panel close during pending sync, committed navigation, and tab removal. For a sync failure after the route changed to Side Panel, assert Background sends the newest `conversation.sync` to Content before returning the error. Resolve a late sync after panel close and assert it cannot destroy Content or commit Side Panel ownership.

- [ ] **Step 3: Run the coordinator test and verify RED**

```bash
pnpm exec vitest run tests/unit/background/ui-session-coordinator.spec.ts
```

Expected: Content is destroyed before readiness and no explicit `to` route or Content resynchronization exists.

- [ ] **Step 4: Add the Background delivery router**

Add `deliveryRoutes: Map<number, DeliveryRoute>`. Stable owner methods set the matching route. `publish` first checks this route, then falls back to current persisted surface state only when no explicit route exists.

Only Background mutates the map. Clear or restore it on initialization, panel close, committed navigation, and tab removal.

- [ ] **Step 5: Implement the ordered handoff**

The open path must execute this exact order:

```ts
await sidePanel.ready(state.windowId)
const snapshot = await loadSnapshot(state)
const synchronized = snapshot
  ? sidePanel.publish(state.windowId, { type: 'conversation.sync', snapshot })
  : sidePanel.command(state.windowId, { type: 'clear' })
deliveryRoutes.set(state.tabId, { to: 'sidePanel', windowId: state.windowId })
await synchronized
assertHandoffStillCurrent(state)
await destroyCurrentContent(state)
await markPanelOwner(state, snapshot, expectedUrl)
```

There must be no `await` between creating `synchronized` and setting the route. Remove Content destruction from generic Side Panel delivery.

Send tool snapshots through `sidePanel.publish(windowId, { type: 'conversation.toolChanged', snapshot })` rather than `sidePanel.command({ type: 'selectTool' })`.

- [ ] **Step 6: Implement failure recovery**

When Content still exists, set `{ to: 'contentScript' }`, load the newest authoritative snapshot, and send `{ type: 'conversation.sync', snapshot }` to Content. Preserve the original failure after recovery. A panel close or page/tab invalidation must make `assertHandoffStillCurrent` reject a late acknowledgement.

Content destruction for the active handoff tab is required for success; do not mark it destroyed when delivery failed.

- [ ] **Step 7: Run coordinator and manager tests and verify GREEN**

```bash
pnpm exec vitest run tests/unit/background/ui-session-coordinator.spec.ts tests/unit/background/conversation-manager.spec.ts
```

Expected: all routing, ordering, recovery, lifecycle, and existing ownership tests pass.

---

### Task 4: Verify the complete extension

**Files:** Verify all files changed by Tasks 1-3.

**Interfaces:** Produces release evidence for the approved specification.

- [ ] **Step 1: Run formatting, typecheck, and lint**

```bash
pnpm run format:check
pnpm run typecheck
pnpm run lint
```

Expected: all exit 0 without new warnings.

- [ ] **Step 2: Run the complete test suite**

```bash
pnpm run test
```

Expected: all tests pass.

- [ ] **Step 3: Build the production extension**

```bash
pnpm run build
```

Expected: SQLite vendoring, TypeScript, and Vite production build exit 0. Do not edit generated `dist/` files.

- [ ] **Step 4: Verify the real Chrome handoff**

Reload the built unpacked extension. Start one long response, press `Ctrl + [`, and verify continuous text, no duplicate suffix, terminal completed status, one provider request, CS closure only after Side Panel rendering, and no Background/Side Panel console errors. Force a readiness/sync failure and verify Content remains visible and catches up to the final status.

- [ ] **Step 5: Inspect scope**

```bash
git diff --check
git status --short
git diff -- src/background/conversation-manager.ts src/background/index.ts src/background/ui-session-coordinator.ts src/sidepanel/App.tsx tests/unit/background/conversation-manager.spec.ts tests/unit/background/ui-session-coordinator.spec.ts tests/unit/events/side-panel-event.spec.ts tests/unit/sidepanel/App.spec.tsx
```

Expected: only the approved handoff implementation, tests, planning records, and pre-existing unrelated user changes remain.
