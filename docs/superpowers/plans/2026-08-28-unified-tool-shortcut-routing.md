# Unified Tool Shortcut Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route tool shortcuts from either Content Script or Side Panel through one semantic request, without relying on Side Panel `sender.documentId`.

**Architecture:** Replace `shortcut.selectTool` and `shortcut.cycleTool` with one `shortcut.tool` request. Its discriminated `payload` uses `origin` to establish the caller, `action` to choose the operation, and `value` for the action argument. A Side Panel adds its live `panelInstanceId`; Background resolves only that opaque ID to its trusted port binding. Content Script keeps using Chrome's trusted tab sender.

**Tech Stack:** TypeScript, React, Chrome Extensions APIs, Vitest.

**Spec:** Approved in-chat design, 2026-08-28; extends `docs/superpowers/plans/2026-08-28-side-panel-port-identity.md`.

## Global Constraints

- Do not accept caller-provided `tabId`, `windowId`, URL, or document ID.
- `action` names semantic operations (`select`, `cycle`), never physical key combinations.
- Side Panel requests with missing, stale, or unknown `panelInstanceId` must fail as `INVALID_EVENT` before the coordinator is called.
- Preserve Content Script tool shortcuts and existing coordinator `selectTool()` / `cycleTool()` behavior.
- Delete the obsolete separate shortcut event definitions and handlers; do not keep URL/document-ID fallbacks.

---

## File Structure

- `src/dianzhi/domain/ui-session-protocol.ts`: define `ToolShortcutRequest` and parse its four valid variants.
- `src/events/config.ts`: replace the four Content/Side Panel select/cycle event exports with two origin-specific `shortcut.tool` event exports.
- `src/content/views/App.tsx`: emit Content-origin semantic tool requests.
- `src/sidepanel/App.tsx`: emit Side Panel-origin semantic tool requests with its existing live port capability.
- `src/background/index.ts`: register the two unified event handlers.
- `src/background/ui-session-runtime.ts`: resolve by origin, then dispatch the semantic action to the existing coordinator methods.
- `tests/unit/dianzhi/protocol.spec.ts`, `tests/unit/background/ui-session-runtime.spec.ts`, `tests/unit/content/views/content-session-routing.spec.tsx`, `tests/unit/sidepanel/App.spec.tsx`: lock the contract and the no-document-ID regression.

## Task 1: Replace the Tool Shortcut Protocol

**Files:**

- Modify: `src/dianzhi/domain/ui-session-protocol.ts`
- Test: `tests/unit/dianzhi/protocol.spec.ts`

**Produces:**

```ts
type ToolShortcutRequest = {
  requestId: string
  type: 'shortcut.tool'
  payload:
    | { origin: 'contentScript'; action: 'select'; value: number }
    | { origin: 'contentScript'; action: 'cycle'; value: 'left' | 'right' }
    | { origin: 'sidePanel'; panelInstanceId: string; action: 'select'; value: number }
    | { origin: 'sidePanel'; panelInstanceId: string; action: 'cycle'; value: 'left' | 'right' }
}
```

- [ ] Write parser tests accepting each valid variant and rejecting unknown origins/actions, zero/non-number select values, invalid cycle values, missing panel IDs, extra fields, and browser identity fields.
- [ ] Run `pnpm vitest run tests/unit/dianzhi/protocol.spec.ts`; confirm the new cases fail because `shortcut.tool` does not exist.
- [ ] Replace `SelectToolShortcutRequest`, `CycleToolShortcutRequest`, and `parseToolShortcut()` with `ToolShortcutRequest` and `parseToolShortcutRequest()` that constructs only the four exact variants.
- [ ] Re-run `pnpm vitest run tests/unit/dianzhi/protocol.spec.ts`; confirm it passes.

## Task 2: Replace the Event Surface and UI Dispatchers

**Files:**

- Modify: `src/events/config.ts`
- Modify: `src/content/views/App.tsx`
- Modify: `src/sidepanel/App.tsx`
- Test: `tests/unit/content/views/content-session-routing.spec.tsx`
- Test: `tests/unit/sidepanel/App.spec.tsx`

**Produces:**

```ts
export const contentToolShortcut = events.cs2bg<ToolShortcutRequest, ToolShortcutResult>(
  'dianzhi:shortcut-tool'
)
export const panelToolShortcut = events.ep2bg<ToolShortcutRequest, ToolShortcutResult>(
  'dianzhi:shortcut-tool'
)
```

- [ ] Write UI tests asserting that Content dispatches `{ origin: 'contentScript', action: 'select', value: 2 }` and `{ origin: 'contentScript', action: 'cycle', value: 'left' }`.
- [ ] Add Side Panel assertions for the same actions with `{ origin: 'sidePanel', panelInstanceId }`.
- [ ] Run the two focused UI suites and confirm failures against the old separate events/payloads.
- [ ] Replace the four event imports/dispatches. Retain the existing keyboard detection; map numeric shortcuts to `action: 'select'` and arrows to `action: 'cycle'`.
- [ ] Re-run the focused UI suites and confirm they pass.

## Task 3: Route the Unified Request in Background

**Files:**

- Modify: `src/background/index.ts`
- Modify: `src/background/ui-session-runtime.ts`
- Test: `tests/unit/background/ui-session-runtime.spec.ts`

**Consumes:** `ToolShortcutRequest` from Task 1 and `sidePanelCommand.bindingFor(panelInstanceId)` from the committed live-port identity implementation.

- [ ] Write a two-window regression test with a Side Panel sender lacking `documentId` and a valid `panelInstanceId`. Assert both `{ action: 'select' }` and `{ action: 'cycle' }` reach the coordinator with the tab/window belonging to that capability.
- [ ] Add a stale-ID case and assert Background rejects it before either coordinator method runs.
- [ ] Run `pnpm vitest run tests/unit/background/ui-session-runtime.spec.ts`; confirm the new tests fail because the old handlers use `resolvePanelBinding()`.
- [ ] Register `contentToolShortcut` and `panelToolShortcut`. Parse the unified request once. For Content, use `runContentRequest()` and its Chrome sender source. For Side Panel, use `runPanelRequest()` with `bindingForRequest()` resolving `panelInstanceId`.
- [ ] In one `switch (request.payload.action)`, call `coordinator.selectTool()` for `select` and `coordinator.cycleTool()` for `cycle`; narrow the payload before passing `{ index: value }` or `{ direction: value }` to the existing coordinator API.
- [ ] Remove obsolete select/cycle UI-session handler registration and their runtime handler interface methods.
- [ ] Re-run `pnpm vitest run tests/unit/background/ui-session-runtime.spec.ts`; confirm it passes.

## Task 4: Verify the Complete Change

**Files:**

- Modify only files above if verification exposes a defect.

- [ ] Run:

```bash
pnpm run typecheck
pnpm vitest run
pnpm run build
git diff --check
```

- [ ] Reload the unpacked extension. With two Chrome windows and a Side Panel in each, verify `Ctrl + Shift + number` selects the tool and `Ctrl + Left/Right` cycles it only in the focused Side Panel.
- [ ] Confirm Background emits no “sender window cannot be resolved unambiguously” errors for `shortcut.tool`.
- [ ] Confirm the same two shortcuts still work from CS UI.

## Plan Self-Review

- The request is discriminated by `origin` and `action`; Background does not infer intent from optional fields.
- `panelInstanceId` is present only where it is required to establish a Side Panel window binding.
- The plan removes, rather than duplicates, the old four tool event paths.
- Regression tests cover both semantic actions, absent `documentId`, stale identity, and both UI origins.
