# Restore the Side Panel Ready Handshake

## Problem

Pressing `Ctrl+[` while the content-script UI is visible fails:

```
Side Panel toggle failed. DianzhiError: The Side Panel is not connected for the target window.
    at dispatch (sidePanel.ts:37:40)
    at command (index.ts:148:60)
    at deliverPanel (ui-session-coordinator.ts:230:34)
    at openPanelWithSnapshot (ui-session-coordinator.ts:251:5)
```

A second, subsequent error appears from the panel side:

```
Panel surface status report failed. DianzhiError: The Side Panel sender window cannot be resolved unambiguously.
    at resolvePanelBinding (ui-session-runtime.ts:90:13)
```

### Root cause 1: command dispatched before the panel port binds

`bg2sp.dispatch` (from `src/events/sidePanel/sidePanel.ts`) checks
`portsByWindow.get(windowId)` and rejects with `SIDE_PANEL_READY_TIMEOUT`
immediately when no port is bound. `chrome.sidePanel.open()` resolves before the
panel page finishes loading; the panel page only registers its typed-event port
after React boots and `sidePanelCommand.handle(...)` runs. So:

1. The gesture fix (`openPanelForGesture`) opens the panel at the message boundary (fire-and-forget).
2. `deliverPanel` sees `gestureOpenedTabs`, skips its own open, and immediately dispatches the command.
3. The panel page has not connected yet → `portsByWindow` has no entry → immediate rejection.

The pre-coordinator implementation (`e4dcf38`) did not have this race: it awaited
a `ready` handshake (resolved by the panel's port binding) with a 5-second
timeout before proceeding:

```ts
await dependencies.sidePanel.open(tabId)
...
await ready   // resolved by the panel page after binding, 5s timeout fallback
```

### Root cause 2: panel identity inferred from an ambiguous sender

The panel reports `ui.surfaceStatus` via `ep2bg` (`chrome.runtime.sendMessage`).
`resolvePanelBinding` recovers the owning window:

- preferred: match `sender.documentId` to a SIDE_PANEL context;
- fallback: the sender URL must match exactly one SIDE_PANEL context.

When `sender.documentId` is absent and two SIDE_PANEL contexts share the panel
URL (stale HMR context, or a panel open in another window), the fallback throws
instead of resolving. The authority that *is* unambiguous — the typed-event port
binding, which carries `{ tabId, windowId }` and drives `portsByWindow` — is
never consulted.

## Design

Two additive changes. Both live in the established `bg2sp` / coordinator
boundaries; no protocol shapes change, no panel-side or content-side code changes.

### Change 1: `bg2sp` gains a bounded ready wait

Extend `TargetedSidePanelEvent` (and the `bg2sp` factory) with:

```ts
export interface TargetedSidePanelEvent<Args, Return> {
  dispatch(args: Args, windowId: number): Promise<Return>
  /** Resolves once a port is bound for `windowId`, or rejects on timeout/disconnect. */
  waitForWindow(windowId: number, timeoutMs?: number): Promise<void>
  /** Windows with an actively bound panel port. */
  connectedWindows(): ReadonlySet<number>
  accept(port: chrome.runtime.Port): boolean
  handle(binding, callback): Cancel
}
```

Behavior:

- `waitForWindow` resolves immediately when a port is already bound;
- otherwise it registers a waiter keyed by `windowId`. When `accept` binds that
  window (the binding message handling), the waiter resolves; a disconnect or the
  timeout rejects it with `SIDE_PANEL_READY_TIMEOUT`.
- Default timeout `DEFAULT_SIDE_PANEL_READY_TIMEOUT_MS = 5_000`, matching the
  pre-coordinator constant.
- `connectedWindows()` returns the window IDs in `portsByWindow`, the same
  registry that already drives delivery.

`dispatch` keeps its fail-fast semantics; only `waitForWindow` blocks. Callers
that must not block (streaming publish) are unaffected.

### Change 2: coordinator awaits readiness only when it just opened

`deliverPanel` (in `src/background/ui-session-coordinator.ts`) gains an awaited
ready gate, gated on the same condition as the open:

```ts
if (input.open && !gestureOpenedTabs.delete(state.tabId)) {
  await dependencies.sidePanel.open(state.tabId)
}
...
await destroyContentInWindow(state.windowId)
if (input.open) {
  await dependencies.sidePanel.ready(state.windowId)
}
await dependencies.sidePanel.command(state.windowId, command)
```

- `open: true` paths (`openPanelWithSnapshot`, i.e. the `Ctrl+[` toggle) now wait
  for the panel port before delivering; the gesture-open race disappears.
- `open` undefined paths (`commandAppearedPanel`, tool shortcuts to an already
  appeared panel, publish) keep fast delivery/failure: `ready` is not called, so
  a genuinely closed panel still fails fast.

The coordinator's `sidePanel` dependency interface gains
`ready(windowId: number, timeoutMs?: number): Promise<void>`, wired in
`src/background/index.ts` to `sidePanelCommand.waitForWindow`.

### Change 3: ambiguous panel sender falls back to the port binding

`resolvePanelBinding` (in `src/background/ui-session-runtime.ts`) gains an
optional authority:

```ts
export async function resolvePanelBinding(
  chromeApi: typeof chrome,
  sender: chrome.runtime.MessageSender,
  panelWindows?: ReadonlySet<number>
): Promise<PanelBinding>
```

The URL fallback logic becomes:

1. When the sender URL matches exactly one SIDE_PANEL context, use it (today).
2. When it matches several and `panelWindows` is available, narrow to contexts
   whose `windowId` has a live port binding; if exactly one survives, use it.
3. Otherwise fail with the current ambiguous-sender error.

Rationale: the panel reports `surfaceStatus` only after it has bound its
typed-event port, so a live port binding is strict evidence of ownership while a
URL-only match over multiple contexts is not. Stale HMR contexts and
second-window panels without a live port are excluded by the narrowing step;
two genuinely-live panels still reject as ambiguous (correct, since the identity
is truly unknown).

`runPanelRequest` passes `sidePanelCommand.connectedWindows()` into
`resolvePanelBinding`.

### Out of scope

- Content-script and sidebar changes: none.
- `dispatch` semantics, `publish`, close flows: unchanged.
- The existing document-id resolution path: still preferred.

## Testing

Transport (`tests/unit/events/side-panel-event.spec.ts`):

- `waitForWindow` resolves immediately when the port is already bound.
- `waitForWindow` resolves once the port binds within the wait.
- `waitForWindow` rejects with `SIDE_PANEL_READY_TIMEOUT` on timeout.
- `waitForWindow` rejects with `SIDE_PANEL_READY_TIMEOUT` when the port disconnects during the wait.
- `connectedWindows` reflects bound windows only.

Coordinator (`tests/unit/background/ui-session-coordinator.spec.ts`):

- The test harness `sidePanel` mock gains `ready: vi.fn(async () => undefined)`.
- `open: true` deliver awaits `sidePanel.ready` before `sidePanel.command`
  (assert invocation order).
- `open` undefined deliver (already-appeared panel / tool shortcut) does not call `ready`.
- `ready` rejection propagates instead of dispatching the command.

Resolver (`tests/unit/background/ui-session-runtime.spec.ts`):

- no documentId + multiple URL matches + `panelWindows` contains exactly one →
  resolves to it;
- no documentId + multiple URL matches + `panelWindows` empty or both → ambiguous
  reject (existing behavior preserved);
- documentId path unchanged.

## Verification

- `pnpm run typecheck`
- `pnpm run test` (transport, coordinator, runtime suites)
- `pnpm run lint`
- `pnpm run build`
- Manual: `Ctrl+[` from the content UI toggles to the Side Panel and renders the
  conversation; the Side Panel's surface-status report succeeds; toggling back
  and forth remains stable.