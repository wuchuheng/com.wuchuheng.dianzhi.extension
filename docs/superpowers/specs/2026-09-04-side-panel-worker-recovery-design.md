# Side Panel Service-Worker Recovery Design

## Problem

After a live conversation has moved from the Content Script UI to Chrome's native Side Panel,
the Side Panel can remain visibly open while the Manifest V3 Background service worker is
suspended and later restarted. The visible page and the Background-owned session no longer share
a working transport:

- both Side Panel ports belonged to the terminated worker;
- the Side Panel creates each port only once and does not reconnect after `onDisconnect`;
- coordinator initialization restores persisted `sidePanelAppeared` intent but not the process-local
  active-tab mapping or delivery route;
- Background message and Chrome lifecycle listeners can run before reconciliation, coordinator
  initialization, and conversation recovery finish;
- the Side Panel reports itself connected before Background acknowledges either port binding.

A follow-up command still succeeds over one-shot messaging. Conversation Manager creates the
assistant row, applies `stream.started` to its authoritative live snapshot, and returns that snapshot
to the caller. The send button therefore changes to the pending/stop state. Provider deltas and the
terminal update continue to update Background memory and SQLite, but live publication cannot find
the Side Panel route and falls back toward the already-destroyed Content UI. Delivery failures are
absorbed so provider execution can finish. A later Stop command returns the newest authoritative
snapshot, causing the accumulated reply and terminal state to appear suddenly.

The provider parser, provider runner, SQLite store, React reducer, message renderer, and scrolling
logic behave correctly when updates reach them. The defect is the lifecycle contract connecting
the Side Panel page to Background ownership and delivery.

## Scope

This design guarantees transparent recovery when Chrome suspends or restarts the MV3 Background
worker while the same Side Panel document remains open.

A complete browser restart, extension reload, extension update, disable/enable cycle, or Side Panel
document replacement starts a new UI lifetime. Persisted conversation history may be restored, but
an interrupted provider connection is recovered as `stopped`; the original network stream is not
resumed.

## Required invariants

1. Background remains authoritative for conversations, provider runs, tab identity, UI ownership,
   and delivery routing.
2. No stateful command or Chrome lifecycle mutation executes against partially restored Background
   state.
3. A visibly open Side Panel automatically restores its transport after worker suspension without
   requiring the user to close, reopen, click Stop, or switch tabs.
4. Port presence alone does not mean the panel is ready. Ready means Background restoration,
   identity validation, authoritative snapshot rendering, and route installation all succeeded.
5. The Side Panel composer cannot begin a follow-up until its current session is ready to receive
   the resulting live updates.
6. Snapshot recovery and subsequent conversation updates use the existing ordered
   `sidePanelConversationUpdate` port.
7. An update-port disconnect does not transfer delivery to Content after Content has been destroyed.
   Background retains Side Panel ownership and catches the panel up from its authoritative snapshot.
8. A transient transport disconnect is distinct from a genuine Side Panel close or page unmount.
9. Reconnection never restarts a provider request and never duplicates persisted user or assistant
   messages.
10. Logs contain lifecycle metadata only. They never contain prompts, generated text, API keys, or
    credentials.

## Considered approaches

### A. Reconnect the existing ports as one logical session — selected

Retain the command and conversation-update ports, but give them a shared panel session identity,
join their lifecycle in Background, and add binding acknowledgement, automatic reconnection,
startup gating, authoritative replay, and send readiness.

This keeps the existing ordered conversation channel and minimizes protocol churn while repairing
the missing lifecycle boundary.

### B. Replace both ports with one universal port

A single port could carry control commands, conversation updates, identity, acknowledgements, and
recovery. Its invariants are simple, but it requires a broad event-system migration unrelated to
the observed defect and increases regression risk for working tool, close, and handoff behavior.

### C. Repair the route only when a command arrives

Background could resynchronize before follow-up and Stop commands. This is insufficient: terminal
events can remain stale while the user is idle, the first deltas can race command-time repair, and
another command would continue to conceal transport failure. This approach is rejected.

## Architecture

### Background startup barrier

`src/background/index.ts` creates one `runtimeReady` promise for the ordered startup sequence:

1. reconcile stored UI sessions with live Chrome tabs;
2. initialize the UI-session coordinator;
3. initialize Conversation Manager's process-local runtime;
4. mark the runtime ready.

Chrome listeners and message listeners must still be registered synchronously at module evaluation
so wake-up events are not missed. Their stateful bodies await `runtimeReady` before calling the
coordinator or manager. Side Panel ports are accepted synchronously, but their bindings remain
provisional until the same promise settles.

The content panel-open path has a user-gesture constraint. Its synchronous `chrome.sidePanel.open()`
side effect remains before the first await; only state lookup, ownership decisions, and later
handoff work wait for runtime readiness.

If startup fails, queued operations fail with a stable Background-unavailable error. They must not
run against empty maps or report false success.

### One logical Side Panel session

On mount, `src/sidepanel/App.tsx` creates one opaque `panelSessionId`. Both
`sidePanelCommand.handle()` and `sidePanelConversationUpdate.handle()` use this same identity rather
than generating independent identities.

Background maintains a process-local session registry keyed by `panelSessionId`. A session records:

```ts
type PanelSession = {
  panelSessionId: string
  windowId: number
  reportedTabId: number
  commandConnected: boolean
  updateConnected: boolean
  generation: number
  status: 'binding' | 'synchronizing' | 'ready' | 'recovering' | 'closed'
}
```

The binding remains a capability, not durable truth. Background validates the panel document and
window, queries the current active tab for that window, and checks the current page URL before
restoring a route. `reportedTabId` is useful for initial consistency checks but never overrides a
newer `tabs.onActivated` result.

A session is command-ready only when both ports for the same ID and window are bound. The update
port alone is the readiness boundary for live conversation delivery; command-port loss disables
panel-originated actions but does not interrupt an otherwise working live stream.

### Reconnect controller

The Side Panel owns a small connection controller for the lifetime of its document. It:

- binds both typed ports with the shared session ID;
- listens for unexpected disconnects;
- marks the React panel disconnected/recovering immediately;
- reconnects with bounded exponential delay while the document is mounted;
- cancels pending retry timers during intentional cleanup;
- stops retrying when the extension context has been invalidated;
- reports genuine `destroyed` only on page cleanup, not on a transient port disconnect.

Opening a port is not used as a keepalive strategy. Reconnection restores capability after Chrome
ends a worker lifetime; normal worker suspension remains allowed.

### Binding acknowledgement and readiness

Port binding gains an explicit acknowledgement. A successful low-level bind only means Background
accepted the port and associated it with the logical session. It does not immediately dispatch
`panel.connected`.

The logical session becomes ready through this sequence:

1. Both ports bind with the same session ID, window, and generation.
2. Background waits for `runtimeReady`.
3. Background resolves and validates the window's current active tab and normalized page URL.
4. Coordinator records live panel presence and active-tab ownership for that window.
5. Conversation Manager loads the newest authoritative selection snapshot, preferring its
   `liveSnapshots` state over an older SQLite checkpoint. If the new worker finds a persisted
   `streaming` assistant with no live run, it finalizes that row as `stopped` before returning the
   snapshot, matching the existing conversation-load recovery behavior.
6. Background posts `conversation.sync` on `sidePanelConversationUpdate` and retains its render
   acknowledgement promise.
7. Without yielding, Background installs the transient Side Panel delivery route. Later deltas and
   terminal events enter the same FIFO behind the sync.
8. Side Panel applies the sync with `flushSync` and acknowledges only after the reducer state is
   committed.
9. Background verifies the session generation, port identity, active tab, page URL, and route.
10. Background marks the logical session ready and sends a ready acknowledgement to the panel.
11. Side Panel dispatches `panel.connected` and enables commands and the composer.

If there is no selection session for the active tab, Background sends `clear` and can still mark the
transport ready. Ready describes transport correctness, not the presence of a conversation.

### Recovering delivery state

The coordinator distinguishes three transient route states:

```ts
type DeliveryRoute =
  | { to: 'contentScript' }
  | { to: 'sidePanel'; windowId: number; panelSessionId: string }
  | { to: 'sidePanelRecovering'; windowId: number; panelSessionId: string }
```

When the active update port disconnects, Background changes the matching route to
`sidePanelRecovering` synchronously and invalidates the old session generation. It does not mark the
panel destroyed and does not route to Content.

For a transport-only disconnect while Background remains alive, Conversation Manager continues
applying every provider event to `liveSnapshots` and finalizing terminal state in SQLite. Publishing
to a recovering Side Panel is considered retained for replay, not delivered to another UI. Per-token
failures are not logged; one disconnect and one recovery outcome provide the useful operational
evidence.

If the worker itself terminates during provider generation, its fetch, live run, and in-memory
snapshot do not survive. The replacement worker loads the latest SQLite checkpoint, finalizes the
orphaned `streaming` assistant as `stopped`, and synchronizes that honest terminal state. It does not
claim that missing post-checkpoint tokens were retained and does not restart the provider request.

When a replacement update port binds, the authoritative sync includes all events accumulated while
disconnected. Installing the live route immediately after posting that sync closes the recovery
gap using the same FIFO rule as the existing Content-to-panel handoff.

A genuine native panel close or Side Panel page cleanup transitions the session to `closed`, clears
the panel route, and follows existing `latestUI` restoration semantics. A late bind or acknowledgement
from an invalidated generation cannot restore ownership.

### Active-tab changes

The native Side Panel is window-scoped and can survive tab changes. `tabs.onActivated` therefore
updates the logical session's active-tab identity after `runtimeReady`, validates the new page,
loads that tab's authoritative snapshot, and performs the same ordered sync-before-route sequence.

Panel-originated lifecycle, tool, toggle, follow-up, retry, and Stop requests resolve their target
from the live session window and current active tab. They do not trust the tab captured when the
Side Panel first mounted.

### Conversation command admission

`extensionConversationCommand` is used only by the Side Panel, so its request gains the shared
`panelSessionId` alongside the existing `ConversationCommand`. Background validates that capability
and waits for the matching logical session to become ready before Conversation Manager creates a
follow-up or retry run.

If recovery cannot finish within the bounded wait, Background rejects with
`SIDE_PANEL_SESSION_NOT_READY`. No user message, assistant row, or provider request is created.

The Side Panel also disables Send, Stop, Retry, and tool mutations while disconnected. A submitted
draft is cleared only after Background accepts the command and returns a snapshot. Failure preserves
the draft and displays an actionable connection error. This closes both the transport race and the
misleading ready-button state.

## Error handling and observability

New stable outcomes are limited to lifecycle boundaries:

- `SIDE_PANEL_SESSION_NOT_READY`: the visible panel has not completed binding and synchronization;
- existing `SIDE_PANEL_READY_TIMEOUT`: initial/open handoff did not bind in time;
- existing `SIDE_PANEL_DELIVERY_FAILED`: an acknowledged ready session failed during delivery;
- existing Background initialization error mapping for migration/database restoration failure.

Metadata-only logs cover:

- worker restoration started, completed, or failed;
- panel session binding, synchronizing, ready, disconnected, reconnecting, or closed;
- active-tab rebinding;
- authoritative replay started, acknowledged, invalidated, or failed;
- command rejected because the session was not ready.

Context may include operation, stable code, panel session ID, generation, tab ID, window ID,
conversation ID, message ID, and elapsed time. It must not include selected text, prompts, response
content, reasoning content, API keys, headers, or provider response bodies.

## Files and boundaries

- `src/background/index.ts`: own `runtimeReady`, gate stateful handlers, and wire panel-session
  lifecycle callbacks.
- `src/background/conversation-manager.ts`: give selection-session loading the same orphaned-stream
  recovery semantics as direct conversation loading, while retaining live-snapshot precedence.
- `src/background/ui-session-runtime.ts`: join port bindings into logical sessions, resolve the live
  active tab, serialize attach/detach work after startup, and gate Chrome lifecycle callbacks.
- `src/background/ui-session-coordinator.ts`: attach/recover/close panel sessions, add recovering
  routes, execute ordered replay, and invalidate stale generations.
- `src/events/sidePanel/sidePanel.ts`: support caller-provided shared session identity, binding
  acknowledgement, disconnect notification, and reconnect-safe replacement.
- `src/events/config.ts` and `src/dianzhi/domain/protocol.ts`: type and validate the authenticated
  Side Panel conversation-command envelope and stable error code.
- `src/sidepanel/App.tsx`: own the connection controller, expose real readiness, preserve drafts on
  rejected sends, and include session identity with commands.
- `src/sidepanel/panel-state.ts` and `src/dianzhi/ui/Composer.tsx`: represent recovering/ready UI and
  disable mutation without confusing transport recovery with provider streaming.
- Focused tests under `tests/unit/events`, `tests/unit/background`, and `tests/unit/sidepanel`.
- New real-extension coverage under the configured `tests/e2e` directory.

Provider request parsing, provider SSE semantics, database schema, terminal persistence ordering,
Markdown, scroll animation, toolbar visuals, Options, Popup, and Content selection extraction remain
unchanged.

## Testing strategy

### Transport tests

- both ports use the same caller-provided session ID;
- binding is not reported ready before Background acknowledgement;
- unexpected disconnect reports recovering and creates replacement ports;
- intentional cleanup disconnects without reconnecting or sending a false destroyed report;
- replacement bindings invalidate old ports and late acknowledgements;
- retries are bounded and stop when the extension context is invalid.

### Startup and runtime tests

- commands, port activation, tab events, and panel events wait for `runtimeReady`;
- provisional ports can bind before startup completes without mutating uninitialized coordinator
  state;
- startup failure rejects queued stateful work with a stable error;
- the synchronous gesture-open side effect still occurs before the first await;
- current active-tab identity replaces a stale mount-time tab binding.

### Coordinator tests

- initialization followed by panel attach reconstructs panel presence, active tab, and route;
- update-port disconnect changes the route to recovering without falling back to Content;
- deltas and terminal events received during recovery appear in the replayed snapshot;
- a new Background worker converts a persisted orphaned `streaming` row to `stopped` before panel
  replay;
- sync is posted, the live route is installed without yielding, and later updates remain FIFO;
- command-port-only loss disables commands while allowing an existing update stream to continue;
- native close, page cleanup, navigation, tab removal, and session replacement invalidate late work;
- multi-window sessions remain isolated.

### Side Panel tests

- initial state is connecting rather than falsely connected;
- Send/Stop/Retry/tool controls are unavailable until synchronization completes;
- a disconnect displays recovery state and preserves the current rendered snapshot and draft;
- a reconnect applies the authoritative snapshot and restores controls;
- a rejected follow-up preserves the draft and does not create a pending assistant row;
- a completed snapshot received during recovery changes the icon from pending/stop to send.

### Integrated regression test

Use the real Conversation Manager, coordinator, session runtime, and fake provider stream:

1. start a selection in Content;
2. hand it to Side Panel and acknowledge rendering;
3. simulate Background termination by discarding process-local coordinator/session/port state;
4. initialize a new Background instance from `chrome.storage.session` and SQLite;
5. simulate automatic Side Panel port reconnection;
6. submit a follow-up after ready acknowledgement;
7. emit multiple SSE deltas and a terminal event;
8. assert continuous visible text, terminal `completed`, one user row, one assistant row, and one
   provider request;
9. repeat with a transport-only disconnect during the follow-up and verify authoritative replay
   catches up;
10. repeat with complete Background replacement during the follow-up and verify the persisted
    checkpoint is shown as `stopped` without starting another provider request.

### Real Chromium acceptance

Add or restore an unpacked-extension Playwright harness with a local deterministic mock SSE server.
The acceptance flow must:

1. create a conversation in Content;
2. switch to Side Panel during a long response and finish the warm handoff;
3. force or simulate service-worker termination using the Chromium extension target/CDP lifecycle;
4. wait for the still-open Side Panel to report ready again;
5. send a follow-up;
6. verify each delayed chunk becomes visible before the next chunk and the button returns from Stop
   to Send after the terminal event;
7. separately terminate the worker during another follow-up and verify the reconnected panel shows
   the recoverable checkpoint as `stopped` without clicking Stop;
8. verify no duplicate messages, no restarted provider request, and no Background/Side Panel
   console errors.

## Verification gates

- focused RED/GREEN lifecycle suites;
- `pnpm run typecheck`;
- `pnpm run test`;
- changed-file ESLint and Prettier checks;
- repository format/lint status reported separately if unrelated baseline drift remains;
- `pnpm run build`;
- `pnpm run test:e2e` with the unpacked extension and mock SSE service;
- manual Chrome confirmation when automated service-worker termination is not reliable on the
  installed Chromium build.

## Out of scope

- keeping the service worker permanently alive;
- resuming the original provider network request after full browser or extension restart;
- persisting transient ports, routes, retry timers, or session capabilities;
- broadcasting every update to both Content and Side Panel;
- changing provider request/SSE contracts or the SQLite schema;
- adding conversation archives, new-chat behavior, or an injected webpage sidebar;
- unrelated repository-wide formatting cleanup.
