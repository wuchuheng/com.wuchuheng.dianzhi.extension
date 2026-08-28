# Content UI Selection Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Restore the last Content UI with the exact prior text selection after the user closes it, while preserving Side Panel as the restoration target whenever Side Panel is the latest UI.

**Architecture:** Add a serializable DOM selection bookmark to the typed selection route and CS-only tab restore state. Background stores and returns it only while `latestUI === 'contentScript'`; Content validates and reconstructs the range before re-highlighting. The existing coordinator remains authoritative for UI ownership and page identity.

**Tech Stack:** TypeScript, React, Chrome extension messaging, Vitest, DOM `Range`/`TreeWalker`.

**Spec:** `docs/superpowers/specs/2026-08-28-dianzhi-content-ui-selection-restore-design.md`

## Global Constraints

- Preserve the existing `latestUI` state machine and Side Panel semantics.
- Never infer browser identity from Content payloads.
- Never select a best-effort ambiguous text match.
- Do not create a new selection session or provider run during restore.
- Do not include full selected text or page context in logs.
- Keep the unrelated `src/offscreen/main.ts` worktree change untouched.

### Task 1: Define bookmark and restore algorithms

**Files:**

- Create: `src/content/selection/bookmark.ts`
- Create: `src/content/selection/restore.ts`
- Test: `tests/unit/content-selection-restore.spec.ts`

**Interfaces:**

- Produce `SelectionBookmark`, `createSelectionBookmark`, `restoreSelectionRange`, and bookmark validation helpers for Content and protocol layers.

- [ ] Write failing tests for exact path restore, context-guarded unique fallback, ambiguous-match rejection, and invalid bookmark rejection.
- [ ] Run `pnpm vitest run tests/unit/content-selection-restore.spec.ts` and confirm failure because the helpers do not exist.
- [ ] Implement DOM-path serialization, text/context guards, exact Range reconstruction, and unique fallback search.
- [ ] Run the focused test until all cases pass.

### Task 2: Extend typed protocol and coordinator state

**Files:**

- Modify: `src/dianzhi/domain/ui-session-protocol.ts`
- Modify: `src/background/ui-session-coordinator.ts`
- Test: existing coordinator/protocol unit tests plus focused additions

**Interfaces:**

- Consume `SelectionBookmark` from the Content selection module.
- Produce `ContentRestore`, optional selection-route bookmark/anchor payload, and optional Content restore data in `PanelToggleResult`.

- [ ] Add failing protocol/coordinator tests for CS-only storage, Side Panel handoff clearing, and restore-result delivery.
- [ ] Run the focused tests and confirm the new assertions fail.
- [ ] Add strict runtime parsing for bookmark paths, offsets, text guards, and anchor geometry; reject malformed records.
- [ ] Add `contentRestore` to `TabSessionState`, stored-state validation, cloning, navigation reset, and persistence.
- [ ] Store the bookmark only when Content becomes the owner; clear it when Side Panel becomes owner, on new selection, navigation, tab removal, or invalid storage.
- [ ] Return it only from the “neither appeared; latest Content” panel-toggle branch.
- [ ] Run coordinator and protocol tests until green.

### Task 3: Wire Content lifecycle and visual restoration

**Files:**

- Modify: `src/content/selection/controller.ts`
- Modify: `src/content/views/App.tsx`
- Modify: `src/content/views/App.css` if recovery copy needs existing styling support
- Test: Content App/controller tests

**Interfaces:**

- Consume `contentRestore` from `PanelToggleResult` and expose controller bookmark capture/restore operations.
- Produce one `destroyed` status report from every shared CS close path and a validated reselected range on restore.

- [ ] Add failing tests for close-button/Escape/outside-click destruction reports, successful rehighlight, and failed-restore recovery copy.
- [ ] Run the focused Content tests and confirm failure.
- [ ] Capture the bookmark at selection time and include it with the selection route request.
- [ ] Make the shared `closePopover` report `destroyed` while preserving the local bookmark for a later restore.
- [ ] Replace fallback-only restoration with live Range → DOM bookmark → unique context search; update the anchor from the reconstructed range.
- [ ] Show the specified recovery message without applying an incorrect highlight when restoration is not unique.
- [ ] Run focused Content tests until green.

### Task 4: Regression and runtime verification

**Files:**

- Modify: relevant existing tests only where assertions encode the old contract

- [ ] Run all unit tests, typecheck, targeted ESLint, and `git diff --check`.
- [ ] Fix only regressions caused by this feature; keep unrelated failures separate.
- [ ] Verify in real Chrome: close CS with button, Escape, and outside click; restore via `Ctrl + [`; verify exact highlight; hand off to Side Panel; close Side Panel; verify the next shortcut restores Side Panel.
- [ ] Review the final diff and confirm no full text/context is logged and no unrelated file is staged.
