# Side Panel Port Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Side Panel shortcut or lifecycle report identify its exact, live Side Panel window without relying on optional Chrome `sender.documentId` metadata.

**Architecture:** The existing long-lived `bg2sp` command port will issue an opaque, random `panelInstanceId` when it binds its trusted `{ tabId, windowId }`. The Side Panel includes that ID and `origin: 'sidePanel'` in its `ui.surfaceStatus` and `shortcut.panelToggle` requests. Background resolves the source only through the live port mapping; it rejects unknown or disconnected IDs. Content Script requests explicitly use `origin: 'contentScript'` and continue deriving tab/window identity from Chrome’s trusted content-script sender.

**Tech Stack:** TypeScript, React, Chrome Extensions APIs, Vitest.

**Spec:** Approved in-chat design, 2026-08-28; extends `docs/superpowers/specs/2026-08-28-side-panel-ready-handshake-design.md`.

## Global Constraints

- Do not trust a caller-provided `tabId`, `windowId`, URL, or document ID.
- Preserve multiple-browser-window behavior: a shortcut closes only the Side Panel that received it.
- A stale or unknown `panelInstanceId` must fail with `INVALID_EVENT`; it must never be routed by URL fallback.
- Keep the existing content-side `Ctrl + [` restore/open behavior unchanged.
- Preserve the unrelated working-tree edit in `src/offscreen/main.ts`.

---

## File Structure

- `src/events/sidePanel/sidePanel.ts`: issue opaque IDs at port binding and expose live binding lookup.
- `src/dianzhi/domain/ui-session-protocol.ts`: make request origin and side-panel capability explicit; validate the mutually exclusive payload shapes.
- `src/sidepanel/App.tsx`: retain the command-port capability and include it in panel lifecycle and shortcut requests.
- `src/content/views/App.tsx`: mark its existing requests as `origin: 'contentScript'`.
- `src/background/ui-session-runtime.ts`: resolve panel requests by live capability instead of `runtime.getContexts` / `sender.documentId`.
- `tests/unit/events/side-panel-event.spec.ts`: cover capability lifecycle in the port primitive.
- `tests/unit/dianzhi/protocol.spec.ts`: cover accepted and rejected request payloads.
- `tests/unit/background/ui-session-runtime.spec.ts`: reproduce the real missing-`documentId`, multi-window case and prove exact-window routing.
- `tests/unit/content/views/content-session-routing.spec.tsx` and `tests/unit/sidepanel/App.spec.tsx`: assert each UI sends its own explicit request form.

## Task 1: Define the Origin and Capability Contract

**Files:**

- Modify: `src/dianzhi/domain/ui-session-protocol.ts`
- Test: `tests/unit/dianzhi/protocol.spec.ts`

**Interfaces:**

- Produces:

```ts
type PanelOrigin = 'contentScript' | 'sidePanel'

type PanelToggleRequest['payload'] =
  | { origin: 'contentScript'; contentUIAppeared: boolean }
  | { origin: 'sidePanel'; panelInstanceId: string }

type SurfaceStatusRequest['payload'] =
  | { origin: 'contentScript'; status: 'appeared' | 'destroyed'; selectionSessionId: number | null }
  | { origin: 'sidePanel'; status: 'appeared' | 'destroyed'; selectionSessionId: number | null; panelInstanceId: string }
```

- [ ] **Step 1: Write failing parser tests.**

Add cases which accept a content toggle with `origin` and visibility, and a panel toggle/status with a non-empty opaque ID. Add rejection cases for absent origin, a panel request without an ID, a content request with an ID, blank IDs, and caller-supplied `windowId`.

- [ ] **Step 2: Run the focused protocol test.**

Run: `pnpm vitest run tests/unit/dianzhi/protocol.spec.ts`

Expected: FAIL because the protocol currently accepts only `{ contentUIAppeared?: boolean }` and does not represent the origin/capability.

- [ ] **Step 3: Implement discriminated request payload parsing.**

Add `PanelOrigin`; make `parsePanelToggle` and `parseSurfaceStatus` accept only the exact origin-specific fields above. Keep `hasCallerBrowserIdentity` intact so browser identity remains background-owned.

- [ ] **Step 4: Re-run the focused protocol test.**

Run: `pnpm vitest run tests/unit/dianzhi/protocol.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit the contract change.**

```bash
git add src/dianzhi/domain/ui-session-protocol.ts tests/unit/dianzhi/protocol.spec.ts
git commit -m "feat(ui): identify panel requests by live capability"
```

## Task 2: Bind an Opaque Capability to the Existing Command Port

**Files:**

- Modify: `src/events/sidePanel/sidePanel.ts`
- Test: `tests/unit/events/side-panel-event.spec.ts`

**Interfaces:**

- Consumes: `Binding = { tabId: number; windowId: number }`.
- Produces:

```ts
type SidePanelPortHandle = { cancel: Cancel; panelInstanceId: string }

interface TargetedSidePanelEvent<Args, Return> {
  handle(binding: Binding, callback: (args: Args) => Promise<Return>): SidePanelPortHandle
  bindingFor(panelInstanceId: string): Binding | null
}
```

- [ ] **Step 1: Write failing port-lifecycle tests.**

Assert that `handle()` returns a non-empty ID, that `bindingFor(id)` resolves the exact binding after Background accepts the binding message, and that it returns `null` after the port disconnects or a replacement port takes over the same window.

- [ ] **Step 2: Run the focused event test.**

Run: `pnpm vitest run tests/unit/events/side-panel-event.spec.ts`

Expected: FAIL because ports currently retain only a window-to-port mapping.

- [ ] **Step 3: Implement capability issuance and cleanup.**

Generate an opaque per-port ID with `crypto.randomUUID()`. Include it in the initial binding handshake, retain `panelInstanceId -> Binding` only while its accepted port remains live, and remove it on disconnect/replacement. Do not expose the port itself outside the event primitive.

- [ ] **Step 4: Re-run the focused event test.**

Run: `pnpm vitest run tests/unit/events/side-panel-event.spec.ts`

Expected: PASS.

- [ ] **Step 5: Commit the event primitive.**

```bash
git add src/events/sidePanel/sidePanel.ts tests/unit/events/side-panel-event.spec.ts
git commit -m "feat(side-panel): bind live port capabilities"
```

## Task 3: Route Requests by Their Declared, Verified Origin

**Files:**

- Modify: `src/background/ui-session-runtime.ts`
- Test: `tests/unit/background/ui-session-runtime.spec.ts`

**Interfaces:**

- Consumes: `PanelToggleRequest` and `SurfaceStatusRequest` from Task 1; `bindingFor(panelInstanceId)` from Task 2.
- Produces: panel requests whose `UiEventSource` is created from the binding returned by the live capability lookup.

- [ ] **Step 1: Write the failing missing-`documentId` regression test.**

Create two Side Panel contexts and two live command-port bindings. Call `onPanelPanelToggle` and `onPanelSurfaceStatus` with a Side Panel sender that has no `documentId`, but include the first panel’s `panelInstanceId`. Assert that the coordinator receives the first panel’s `{ tabId, windowId }`. Add an unknown-ID case that rejects before the coordinator runs.

- [ ] **Step 2: Run the focused runtime test.**

Run: `pnpm vitest run tests/unit/background/ui-session-runtime.spec.ts`

Expected: FAIL because `runPanelRequest` still calls `resolvePanelBinding()` and rejects ambiguous sender contexts.

- [ ] **Step 3: Replace the unsafe panel request resolution path.**

For panel-origin surface-status and toggle handlers, parse first, resolve `panelInstanceId` through `sidePanelCommand.bindingFor()`, and build the source with `panelSourceFromBinding()`. Keep `resolvePanelBinding()` only for any legacy panel-origin requests that cannot yet carry a capability; do not use URL fallback for the new shortcut/status paths.

- [ ] **Step 4: Keep the user-gesture rule content-only.**

Ensure `openPanelForGesture()` remains called only by the Content Script toggle handler. A Side Panel shortcut must call `togglePanel()` directly, letting the coordinator close that panel rather than opening another one.

- [ ] **Step 5: Re-run the focused runtime test.**

Run: `pnpm vitest run tests/unit/background/ui-session-runtime.spec.ts`

Expected: PASS, including existing content-origin toggle coverage.

- [ ] **Step 6: Commit the Background routing fix.**

```bash
git add src/background/ui-session-runtime.ts tests/unit/background/ui-session-runtime.spec.ts
git commit -m "fix(background): route panel requests through live ports"
```

## Task 4: Send the Correct Origin from Each UI

**Files:**

- Modify: `src/sidepanel/App.tsx`
- Modify: `src/content/views/App.tsx`
- Test: `tests/unit/sidepanel/App.spec.tsx`
- Test: `tests/unit/content/views/content-session-routing.spec.tsx`

**Interfaces:**

- Consumes: `SidePanelPortHandle.panelInstanceId` from Task 2 and the Task 1 payload shapes.

- [ ] **Step 1: Write failing UI dispatch tests.**

Assert Content sends `{ origin: 'contentScript', contentUIAppeared: state.visible }` for `Ctrl + [`. Assert Side Panel sends `{ origin: 'sidePanel', panelInstanceId }` for `Ctrl + [` / close shortcut and includes the same fields in its appeared/destroyed lifecycle reports.

- [ ] **Step 2: Run the focused UI tests.**

Run: `pnpm vitest run tests/unit/content/views/content-session-routing.spec.tsx tests/unit/sidepanel/App.spec.tsx`

Expected: FAIL because the current Side Panel sends `{}` and reports status without a capability.

- [ ] **Step 3: Retain the command-port handle in Side Panel React state.**

Use the command port’s returned `panelInstanceId` only after its binding is installed. Pass it to `reportSurface()` and the shortcut dispatcher. Do not report `appeared` or `destroyed` if no live ID exists; preserve current cleanup ordering by reporting before disconnecting the port.

- [ ] **Step 4: Mark Content requests explicitly.**

Add `origin: 'contentScript'` to Content toggle and status dispatches; preserve its trusted Chrome sender resolution and current visibility observation.

- [ ] **Step 5: Re-run the focused UI tests.**

Run: `pnpm vitest run tests/unit/content/views/content-session-routing.spec.tsx tests/unit/sidepanel/App.spec.tsx`

Expected: PASS.

- [ ] **Step 6: Commit the UI dispatch changes.**

```bash
git add src/sidepanel/App.tsx src/content/views/App.tsx tests/unit/sidepanel/App.spec.tsx tests/unit/content/views/content-session-routing.spec.tsx
git commit -m "fix(ui): identify shortcut origin explicitly"
```

## Task 5: Integrate and Verify the Regression

**Files:**

- Modify only if verification finds a defect in the files above.

- [ ] **Step 1: Run the complete UI-session test group.**

Run:

```bash
pnpm vitest run tests/unit/events/side-panel-event.spec.ts tests/unit/dianzhi/protocol.spec.ts tests/unit/background/ui-session-runtime.spec.ts tests/unit/background/ui-session-coordinator.spec.ts tests/unit/content/views/content-session-routing.spec.tsx tests/unit/sidepanel/App.spec.tsx
```

Expected: PASS.

- [ ] **Step 2: Run project verification.**

Run:

```bash
pnpm vitest run
pnpm run build
git diff --check
```

Expected: all test suites and build pass; `git diff --check` has no output.

- [ ] **Step 3: Manually verify in Chrome.**

With two Chrome windows and a Side Panel open in each:

1. Focus the first Side Panel and press `Ctrl + [`.
2. Confirm only the first Side Panel closes.
3. Confirm Background has no “sender window cannot be resolved unambiguously” error.
4. Close a CS UI, press `Ctrl + [` on the page, and confirm CS UI restores without opening an empty Side Panel.
5. Repeat the Side Panel shortcut in the second window.

- [ ] **Step 4: Commit integration verification fixes if required.**

```bash
git add <only-files-changed-by-verification>
git commit -m "test(ui): cover multi-window panel shortcut routing"
```

## Plan Self-Review

- Contract coverage: Tasks 1 and 4 define and emit origin/capability payloads.
- Trust boundary: Task 2 binds the capability to a live port; Task 3 rejects unknown/stale IDs and does not trust browser IDs from payloads.
- Regression coverage: Task 3 specifically reproduces an absent `sender.documentId` with multiple open Side Panels.
- Existing behavior: Task 3 keeps user-gesture opening content-only; Task 5 verifies CS UI restore remains intact.
- Scope: no database, selection-restoration, Side Panel layout, or unrelated offscreen changes are included.
