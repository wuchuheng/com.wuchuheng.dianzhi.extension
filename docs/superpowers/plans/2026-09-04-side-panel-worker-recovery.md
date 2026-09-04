# Side Panel Service-Worker Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make an already-open native Side Panel reconnect, resynchronize, and stream follow-up replies correctly after a Manifest V3 Background service-worker restart.

**Architecture:** Keep the existing command and ordered conversation-update ports, but bind them with one logical panel session ID. Gate stateful Background work on startup restoration, reconstruct the active-tab delivery route from live port capability, replay an authoritative snapshot before admitting panel commands, and represent temporary update-port loss as a recovering Side Panel route rather than falling back to destroyed Content.

**Tech Stack:** TypeScript 5.8, React 19, Chrome Extension Manifest V3 APIs, Vitest 4, Playwright 1.58, OPFS SQLite through `web-sqlite-js`.

**Spec:** `docs/superpowers/specs/2026-09-04-side-panel-worker-recovery-design.md`

## Global Constraints

- Background remains authoritative for conversations, provider runs, tab identity, UI ownership, and delivery routing.
- Chrome listeners must register synchronously; stateful bodies wait for runtime restoration.
- The `chrome.sidePanel.open()` call required by a user gesture must occur before the first asynchronous wait.
- Snapshot recovery and later deltas use `sidePanelConversationUpdate` in FIFO order.
- Transport loss never falls back to Content after successful handoff destroyed Content.
- Reconnection never restarts a provider request or duplicates a message.
- Worker termination during generation recovers the persisted checkpoint as `stopped`; it does not resume the original fetch.
- No schema migration or provider/SSE contract change is allowed.
- Lifecycle logs contain metadata only—never selected text, prompts, generated content, reasoning, credentials, headers, or API keys.
- Do not fold the repository's unrelated pre-existing formatting drift into this repair.

---

## File structure

- `src/background/conversation-manager.ts`: centralize orphaned-stream recovery so both conversation and selection-session loads return terminal snapshots after worker replacement.
- `src/events/sidePanel/sidePanel.ts`: provide shared caller-supplied identity, bind acknowledgement, lifecycle observation, and reconnecting client handles.
- `src/background/side-panel-session-registry.ts`: new pure process-local state machine joining command/update channels into one generation-checked panel session.
- `src/background/ui-session-coordinator.ts`: attach/recover logical panel sessions and retain a `sidePanelRecovering` route while delivery is temporarily unavailable.
- `src/background/ui-session-runtime.ts`: wait for Background readiness, convert transport lifecycle into coordinator operations, and resolve current active tabs.
- `src/background/index.ts`: own `runtimeReady`, wire transport/session lifecycle, and authenticate Side Panel conversation commands.
- `src/dianzhi/domain/protocol.ts`, `src/dianzhi/domain/ui-session-protocol.ts`, `src/dianzhi/domain/errors.ts`, `src/events/config.ts`: define validated session-bearing command and ready-control contracts.
- `src/sidepanel/panel-state.ts`, `src/sidepanel/App.tsx`: show true connection readiness, reconnect automatically, preserve drafts, and gate mutations.
- Existing focused tests are extended beside their production units; `tests/unit/background/side-panel-worker-recovery.spec.ts` supplies the cross-unit regression.
- `tests/e2e/side-panel-worker-recovery.spec.ts` and `tests/e2e/support/extension-fixture.ts`: real unpacked-extension lifecycle acceptance.

---

### Task 1: Recover orphaned selection-session streams

**Files:**

- Modify: `src/background/conversation-manager.ts:210-270`
- Test: `tests/unit/background/conversation-manager.spec.ts`

**Interfaces:**

- Consumes: existing `database.request('finalizeAssistant', ...)` and `StoredConversationSnapshot`.
- Produces: `recoverOrphanedMessages(messages: MessageRecord[]): Promise<MessageRecord[]>`, used by both `loadSnapshot()` and `loadSelectionSession()`.

- [x] **Step 1: Write the failing selection-session recovery test**

Add a test whose stored active conversation contains one assistant row with `status: 'streaming'`. Call `manager.loadSelectionSession(10)` and assert:

```ts
expect(database.request).toHaveBeenCalledWith('finalizeAssistant', {
  messageId: 7,
  input: {
    status: 'stopped',
    content: 'persisted checkpoint',
    reasoningContent: '',
    estimatedThroughputTps: null,
    errorCode: null,
    errorMessage: 'The background service restarted during generation.',
  },
})
expect(result.messages[0]).toMatchObject({ id: 7, status: 'stopped' })
```

- [x] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm vitest --run tests/unit/background/conversation-manager.spec.ts
```

Expected: FAIL because `loadSelectionSession()` currently returns the stored `streaming` row without finalizing it.

- [x] **Step 3: Centralize minimal orphan recovery**

Extract the existing recovery mapping from `loadSnapshot()`:

```ts
async function recoverOrphanedMessages(messages: MessageRecord[]): Promise<MessageRecord[]> {
  return Promise.all(
    messages.map((message) =>
      message.status === 'streaming'
        ? dependencies.database.request('finalizeAssistant', {
            messageId: message.id,
            input: {
              status: 'stopped',
              content: message.content,
              reasoningContent: message.reasoningContent,
              estimatedThroughputTps: null,
              errorCode: null,
              errorMessage: 'The background service restarted during generation.',
            },
          })
        : Promise.resolve(message)
    )
  )
}
```

Use it only when no matching `liveSnapshots` entry exists. Apply it in both direct conversation loading and selection-session loading before caching/returning the snapshot.

- [x] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
pnpm vitest --run tests/unit/background/conversation-manager.spec.ts
```

Expected: all Conversation Manager tests pass; an existing live snapshot still wins without calling `finalizeAssistant`.

- [x] **Step 5: Commit the recovery unit**

```bash
git add src/background/conversation-manager.ts tests/unit/background/conversation-manager.spec.ts
git commit -m "fix(conversation): recover orphaned panel streams"
```

---

### Task 2: Add reconnectable shared-identity Side Panel ports

**Files:**

- Modify: `src/events/sidePanel/sidePanel.ts:1-243`
- Test: `tests/unit/events/side-panel-event.spec.ts`

**Interfaces:**

- Consumes: existing `TargetedSidePanelEvent<Args, Return>` request/acknowledgement behavior.
- Produces:

```ts
export type SidePanelPortStatus = 'connecting' | 'bound' | 'disconnected'

export interface SidePanelPortLifecycle {
  type: 'bound' | 'disconnected'
  panelSessionId: string
  binding: { tabId: number; windowId: number }
}

export interface SidePanelHandleOptions {
  panelSessionId?: string
  reconnect?: boolean
  retryDelaysMs?: readonly number[]
  onStatus?(status: SidePanelPortStatus): void
}

handle(binding, callback, options?: SidePanelHandleOptions): {
  cancel: Cancel
  panelSessionId: string
}

observeLifecycle(listener: (event: SidePanelPortLifecycle) => void): Cancel
```

- [x] **Step 1: Write failing transport identity and bind-acknowledgement tests**

Extend the fake port so `chrome.runtime.connect()` can return successive ports. Assert that:

```ts
const handle = event.handle(binding, callback, {
  panelSessionId: 'panel-session-19',
  onStatus,
})
expect(firstPort.postMessage).toHaveBeenCalledWith({
  type: 'bind',
  tabId: 9,
  windowId: 19,
  panelSessionId: 'panel-session-19',
})
expect(onStatus).not.toHaveBeenCalledWith('bound')
firstPort.emitMessage({ type: 'bound', panelSessionId: 'panel-session-19' })
expect(onStatus).toHaveBeenLastCalledWith('bound')
expect(handle.panelSessionId).toBe('panel-session-19')
```

On the Background half, assert `observeLifecycle()` receives matching `bound` and `disconnected` events and that the server posts the binding acknowledgement only after validating/storing the binding.

- [x] **Step 2: Write the failing reconnect/cancel tests**

With fake timers and `retryDelaysMs: [100, 250]`, disconnect the first port and assert `disconnected`, then advance 100 ms and assert a second `runtime.connect()` call with the same session ID. Call `cancel()`, disconnect again, advance all timers, and assert no third connection and no retry.

- [x] **Step 3: Run transport tests and verify RED**

Run:

```bash
pnpm vitest --run tests/unit/events/side-panel-event.spec.ts
```

Expected: FAIL because `handle()` generates its own ID, has no bind acknowledgement/status, and never reconnects.

- [x] **Step 4: Implement the typed bind protocol and lifecycle observer**

Replace the untagged bind shape with discriminated messages:

```ts
type BindingMessage = Binding & { type: 'bind'; panelSessionId: string }
type BoundMessage = { type: 'bound'; panelSessionId: string }
```

Maintain a set of lifecycle listeners. On valid bind, replace any old window/session port, store both indexes, post `BoundMessage`, resolve window waiters, and emit `bound`. On disconnect, remove only indexes still pointing to that port, reject its pending deliveries, and emit `disconnected` with the removed binding.

- [x] **Step 5: Implement reconnecting client handles**

Create a connection attempt function inside `handle()` that installs fresh message/disconnect listeners for each port. On unexpected disconnect, call `onStatus('disconnected')` and schedule the next attempt using the bounded delay sequence; after the final listed delay, continue using its capped last value while the document remains mounted. Treat a thrown `chrome.runtime.connect()` or `runtime.lastError` indicating an invalidated extension context as terminal. `cancel()` sets `disposed = true`, clears the timer, removes listeners, and intentionally disconnects without scheduling another attempt.

- [x] **Step 6: Run transport tests and verify GREEN**

Run:

```bash
pnpm vitest --run tests/unit/events/side-panel-event.spec.ts
```

Expected: all original FIFO/ack/window tests and new lifecycle tests pass.

- [x] **Step 7: Commit the transport unit**

```bash
git add src/events/sidePanel/sidePanel.ts tests/unit/events/side-panel-event.spec.ts
git commit -m "feat(sidepanel): reconnect typed event ports"
```

---

### Task 3: Join both ports into a generation-safe logical session

**Files:**

- Create: `src/background/side-panel-session-registry.ts`
- Create: `tests/unit/background/side-panel-session-registry.spec.ts`

**Interfaces:**

- Consumes: `SidePanelPortLifecycle` from Task 2.
- Produces:

```ts
export type SidePanelChannel = 'command' | 'update'

export interface ReadyPanelSession {
  panelSessionId: string
  tabId: number
  windowId: number
  generation: number
}

export interface SidePanelSessionRegistry {
  apply(channel: SidePanelChannel, event: SidePanelPortLifecycle): void
  beginSynchronization(
    panelSessionId: string,
    currentBinding: { tabId: number; windowId: number }
  ): ReadyPanelSession | null
  completeSynchronization(panelSessionId: string, generation: number): boolean
  readyBinding(panelSessionId: string): ReadyPanelSession | null
  waitUntilReady(panelSessionId: string, timeoutMs?: number): Promise<ReadyPanelSession>
  sessionsForWindow(windowId: number): readonly ReadyPanelSession[]
  removeWindow(windowId: number): void
  observe(listener: (change: PanelSessionChange) => void): Cancel
}
```

`PanelSessionChange` is a discriminated union with `channels-ready`, `update-disconnected`,
`command-disconnected`, and `removed` variants. Every change includes session ID, window ID, and
generation.

- [x] **Step 1: Write failing pure state-machine tests**

Cover these exact transitions:

```text
none -> command bound -> update bound -> channels-ready
channels-ready -> beginSynchronization -> completeSynchronization -> readyBinding succeeds
ready -> command disconnect -> readyBinding null, command-disconnected emitted
ready -> update disconnect -> generation increments, readyBinding null, update-disconnected emitted
old completeSynchronization(oldGeneration) -> false
replacement command+update binds -> channels-ready with a newer generation
removeWindow -> waiters reject and sessions disappear
```

Also assert mismatched window/tab bindings under one session ID never become ready.

- [x] **Step 2: Run the registry test and verify RED**

Run:

```bash
pnpm vitest --run tests/unit/background/side-panel-session-registry.spec.ts
```

Expected: FAIL because the module does not exist.

- [x] **Step 3: Implement the minimal registry**

Use one internal record per session:

```ts
type SessionRecord = {
  panelSessionId: string
  binding: { tabId: number; windowId: number }
  commandConnected: boolean
  updateConnected: boolean
  generation: number
  phase: 'binding' | 'synchronizing' | 'ready' | 'recovering'
}
```

Increment `generation` whenever a connected channel disconnects or a binding is replaced. Resolve
ready waiters only from `completeSynchronization()` for the current generation. Reject window
removal waiters with `SIDE_PANEL_SESSION_NOT_READY` and safe `{ panelSessionId, windowId }` context.
`beginSynchronization()` accepts the live active-tab binding resolved by Background and replaces the
mount-time tab in the returned/current record only when the window and generation still match.

- [x] **Step 4: Run the registry test and verify GREEN**

Run:

```bash
pnpm vitest --run tests/unit/background/side-panel-session-registry.spec.ts
```

Expected: all transition, stale-generation, waiter, and multi-window tests pass.

- [x] **Step 5: Commit the registry unit**

```bash
git add src/background/side-panel-session-registry.ts tests/unit/background/side-panel-session-registry.spec.ts
git commit -m "feat(background): track logical panel sessions"
```

---

### Task 4: Add recovering routes and ordered panel attachment

**Files:**

- Modify: `src/background/ui-session-coordinator.ts:80-1094`
- Modify: `src/background/ui-session-runtime.ts:45-930`
- Test: `tests/unit/background/ui-session-coordinator.spec.ts`
- Test: `tests/unit/background/ui-session-runtime.spec.ts`

**Interfaces:**

- Consumes: `ReadyPanelSession` and the existing authoritative `loadSelectionSession()` gateway.
- Produces these coordinator methods:

```ts
attachPanelSession(session: ReadyPanelSession): Promise<void>
disconnectPanelSession(input: {
  panelSessionId: string
  windowId: number
  generation: number
  channel: 'command' | 'update'
}): Promise<void>
```

The transient route becomes:

```ts
type DeliveryRoute =
  | { to: 'contentScript' }
  | { to: 'sidePanel'; windowId: number; panelSessionId?: string }
  | { to: 'sidePanelRecovering'; windowId: number; panelSessionId: string }
```

The optional session ID on a warm-handoff route preserves the existing pre-session handoff tests;
every recovered stable route includes it.

- [x] **Step 1: Write failing coordinator recovery tests**

Add tests proving:

1. Initializing stored `{ sidePanelAppeared: true, contentUIAppeared: false }` does not publish until
   `attachPanelSession()` supplies live capability.
2. Attach loads the active selection snapshot, posts `conversation.sync`, installs the Side Panel
   route before awaiting the sync acknowledgement, and then publishes a racing delta behind it.
3. Update disconnect changes only the matching session's route to `sidePanelRecovering`.
4. `publish()` on `sidePanelRecovering` returns `true` without calling Side Panel or Content.
5. Reattach publishes the newest snapshot and restores live routing.
6. Command-only disconnect leaves the live update route intact.
7. Native close/navigation/tab removal invalidates a late attach acknowledgement.

- [x] **Step 2: Run coordinator tests and verify RED**

Run:

```bash
pnpm vitest --run tests/unit/background/ui-session-coordinator.spec.ts
```

Expected: FAIL because attach/disconnect methods and recovering routes do not exist.

- [x] **Step 3: Implement attach and disconnect behavior**

Serialize attach through `runForTab()`. Validate the live tab URL, set panel window/active-tab
presence, and distinguish:

```ts
const shouldRecoverOwner = state.sidePanelAppeared && !state.contentUIAppeared
```

For a recovered owner, load the authoritative snapshot, post `conversation.sync`, set the live route
without an intervening `await`, await render acknowledgement, revalidate session/page/route, and
persist. For an initial warm handoff with Content still visible, record live panel presence but leave
the existing handoff sequence responsible for synchronization and ownership transfer.

Update disconnect sets `sidePanelRecovering` only when session/window/generation still match. Command
disconnect does not change a working update route. `publish()` treats recovering as retained for
authoritative replay and returns `true`, preventing legacy Content fallback.

- [x] **Step 4: Add readiness-aware runtime lifecycle wiring tests**

Pass a deferred `runtimeReady` and the Task 3 registry into `registerUiSessionRuntime()`. Assert:

- transport events are observed immediately but `attachPanelSession()` is not called before ready;
- both channel binds trigger one attach after ready;
- successful attach plus current-generation completion emits one logical ready outcome;
- update/command disconnect call `disconnectPanelSession()` with the correct channel;
- `tabs.onActivated` waits for ready and uses `tabs.query({ active: true, windowId })` identity;
- `sidePanel.onClosed` removes the registry window and calls coordinator close after ready.

- [x] **Step 5: Implement runtime lifecycle wiring**

Extend `registerUiSessionRuntime()` dependencies with:

```ts
runtimeReady: Promise<void>
panelSessions: SidePanelSessionRegistry
onPanelSessionReady(session: ReadyPanelSession): Promise<void>
```

Subscribe to each port event's `observeLifecycle()`, feed the registry, and respond to registry
changes. On `channels-ready`, wait for runtime readiness, query the active tab for the session
window, call `attachPanelSession()` with current identity, complete only the captured generation,
and invoke `onPanelSessionReady()`. Log one metadata-only outcome per transition.

- [x] **Step 6: Run coordinator/runtime tests and verify GREEN**

Run:

```bash
pnpm vitest --run tests/unit/background/ui-session-coordinator.spec.ts tests/unit/background/ui-session-runtime.spec.ts tests/unit/background/side-panel-session-registry.spec.ts
```

Expected: all old warm-handoff behavior and new cold-recovery lifecycle tests pass.

- [x] **Step 7: Commit the routing unit**

```bash
git add src/background/ui-session-coordinator.ts src/background/ui-session-runtime.ts tests/unit/background/ui-session-coordinator.spec.ts tests/unit/background/ui-session-runtime.spec.ts
git commit -m "fix(background): rebuild panel routes after wake"
```

---

### Task 5: Gate Background commands on restored, ready sessions

**Files:**

- Modify: `src/dianzhi/domain/errors.ts:1-20`
- Modify: `src/dianzhi/domain/protocol.ts:61-247`
- Modify: `src/dianzhi/domain/ui-session-protocol.ts`
- Modify: `src/events/config.ts:9-88`
- Modify: `src/background/index.ts:1-342`
- Modify: `src/background/conversation-manager.ts:379-468`
- Test: `tests/unit/dianzhi/protocol.spec.ts`
- Test: `tests/unit/background/ui-session-runtime.spec.ts`
- Test: `tests/unit/background/conversation-manager.spec.ts`

**Interfaces:**

- Consumes: Task 3 `waitUntilReady()` and Task 4 runtime callback.
- Produces:

```ts
export interface SidePanelConversationRequest {
  panelSessionId: string
  command: ConversationCommand
}

export function parseSidePanelConversationRequest(
  value: unknown
): ParseResult<SidePanelConversationRequest>

// Add an optional trusted tab authorization only for the extension/Side Panel path.
manager.handle(
  command: ConversationCommand,
  sender: chrome.runtime.MessageSender,
  source: 'content' | 'extension',
  authorizedTabId?: number
): Promise<ConversationCommandResult>

export type SidePanelCommand =
  | { type: 'clear' }
  | { type: 'render' | 'selectTool'; snapshot: ConversationSnapshot }
  | { type: 'session.ready'; panelSessionId: string }
```

Add `SIDE_PANEL_SESSION_NOT_READY` to `DianzhiErrorCode`.

- [x] **Step 1: Write failing protocol tests**

Assert the parser accepts:

```ts
{
  panelSessionId: 'panel-session-19',
  command: {
    type: 'conversation.followup',
    requestId: 'followup-1',
    payload: { conversationId: 22, content: 'Why?' },
  },
}
```

Reject blank session IDs, missing commands, invalid nested commands, caller-supplied tab IDs, and
extra shapes that bypass `parseConversationCommand()`.

- [x] **Step 2: Run protocol tests and verify RED**

Run:

```bash
pnpm vitest --run tests/unit/dianzhi/protocol.spec.ts
```

Expected: FAIL because the request type/parser do not exist.

- [x] **Step 3: Implement request/control protocol**

Parse the outer record and non-empty session ID, then delegate the nested value to
`parseConversationCommand()`. Change only `extensionConversationCommand` to use
`SidePanelConversationRequest`; Content retains the original command type.

- [x] **Step 4: Write failing Background startup/admission tests**

Extract or export a small command adapter from `index.ts` if importing the entrypoint is impractical:

```ts
export function createSidePanelConversationHandler(input: {
  runtimeReady: Promise<void>
  panelSessions: SidePanelSessionRegistry
  manager: ConversationManager
})
```

Assert manager handling waits for both `runtimeReady` and `waitUntilReady(panelSessionId)`, passes the
ready session's current `tabId` as `authorizedTabId`, and does not call manager when the wait rejects.
Assert a cold Content toggle still calls synchronous gesture-open before awaiting runtime readiness.

- [x] **Step 5: Implement one Background readiness promise and gated handlers**

Replace the detached bootstrap with an assigned promise:

```ts
const runtimeReady = (async () => {
  await reconcileUiSessionState(/* existing dependencies */)
  await coordinator.initialize()
  await manager.initialize()
  log(Scope.BACKGROUND, 'Dianzhi UI session runtime is ready')
})()
```

Register listeners synchronously. Await this promise inside conversation, settings/tools operations
that depend on restored storage, coordinator lifecycle bodies, and panel-session activation. Preserve
the content toggle's synchronous `openPanelForGesture()` hook before its stateful body waits.

Create one `SidePanelSessionRegistry`, feed it from Task 4 wiring, and dispatch
`{ type: 'session.ready', panelSessionId }` only after coordinator attachment and registry generation
completion both succeed.

- [x] **Step 6: Gate the Side Panel conversation handler**

Parse the session envelope, await runtime readiness and the matching ready session, then pass only
`request.command` plus the ready session's current tab ID to Conversation Manager. Make Conversation
Manager validate every loaded snapshot against `authorizedTabId` for the extension source, just as it
already validates `sender.tab.id` for Content. A timeout or tab mismatch rejects before database
append or provider start.

- [x] **Step 7: Run protocol/runtime/manager tests and verify GREEN**

Run:

```bash
pnpm vitest --run tests/unit/dianzhi/protocol.spec.ts tests/unit/background/ui-session-runtime.spec.ts tests/unit/background/conversation-manager.spec.ts
```

Expected: all parsers, startup ordering, user-gesture, capability, and command-admission tests pass.

- [x] **Step 8: Commit the Background admission unit**

```bash
git add src/dianzhi/domain/errors.ts src/dianzhi/domain/protocol.ts src/dianzhi/domain/ui-session-protocol.ts src/events/config.ts src/background/index.ts src/background/conversation-manager.ts tests/unit/dianzhi/protocol.spec.ts tests/unit/background/ui-session-runtime.spec.ts tests/unit/background/conversation-manager.spec.ts
git commit -m "fix(background): gate panel commands on recovery"
```

---

### Task 6: Expose real readiness in the Side Panel UI

**Files:**

- Modify: `src/sidepanel/panel-state.ts:1-51`
- Modify: `src/sidepanel/App.tsx:164-390`
- Modify: `src/dianzhi/ui/Composer.tsx:3-69`
- Test: `tests/unit/sidepanel/App.spec.tsx`
- Test: `tests/unit/dianzhi/ui/Composer.spec.tsx`

**Interfaces:**

- Consumes: Task 2 `SidePanelHandleOptions`, Task 5 `SidePanelConversationRequest`, and
  `{ type: 'session.ready'; panelSessionId }`.
- Produces: truthful `PanelState.connected`, mutation gating, and draft-preserving command behavior.

- [x] **Step 1: Write failing connection-readiness UI tests**

Update event mocks so handle options expose `onStatus`. Assert:

- initial state is disconnected/connecting and the composer is disabled;
- both handles receive the same supplied `panelSessionId`;
- low-level `bound` statuses alone do not enable the composer;
- a matching `session.ready` command dispatches `panel.connected` and enables Send;
- `disconnected` from either channel dispatches `panel.disconnected` and disables mutation while
  leaving the current snapshot and draft visible;
- a ready message for a stale/different session ID is ignored.

- [x] **Step 2: Write failing draft and command-envelope tests**

Type `Why?`, click Send, and hold the command promise pending. Assert the textarea retains `Why?` and
the call is:

```ts
expect(conversationDispatch).toHaveBeenCalledWith({
  panelSessionId: sharedSessionId,
  command: {
    type: 'conversation.followup',
    requestId: expect.any(String),
    payload: { conversationId: 22, content: 'Why?' },
  },
})
```

Resolve success and assert the draft clears. Reject with `SIDE_PANEL_SESSION_NOT_READY` and assert the
draft remains, no local pending assistant is invented, and an actionable connection error is shown.

- [x] **Step 3: Run Side Panel tests and verify RED**

Run:

```bash
pnpm vitest --run tests/unit/sidepanel/App.spec.tsx tests/unit/dianzhi/ui/Composer.spec.tsx
```

Expected: FAIL because initial connection is optimistic, identity differs per port, and send clears
the draft before command acceptance.

- [x] **Step 4: Implement truthful connection state**

Set `INITIAL_PANEL_STATE.connected = false`. Create one session ID per App mount and pass it to both
port handles with `reconnect: true`. Dispatch disconnected on unexpected loss. In the command-port
callback, apply `session.ready` only when its ID matches; keep `render`, `selectTool`, and `clear`
behavior unchanged. Report `appeared` with the shared ID after low-level binding and report
`destroyed` only during effect cleanup.

- [x] **Step 5: Gate mutations and preserve drafts**

Pass `disabled={!state.connected}` to `Composer`. Make the App command helper return its promise and
wrap `{ panelSessionId, command }`. For follow-up, capture the submitted content and clear the matching
draft only after an accepted response; on rejection preserve it and surface the structured error.
Stop, Retry, tool selection, and panel mutations return early while disconnected.

Keep the textarea editable during an active provider stream when connected, preserving the approved
next-draft behavior; the existing `streaming` prop still changes only the merged Send/Stop button.

- [x] **Step 6: Run Side Panel tests and verify GREEN**

Run:

```bash
pnpm vitest --run tests/unit/sidepanel/App.spec.tsx tests/unit/dianzhi/ui/Composer.spec.tsx
```

Expected: all connection, draft, pending icon, toolbar, scroll, provider setup, and shortcut tests
pass.

- [x] **Step 7: Commit the UI readiness unit**

```bash
git add src/sidepanel/panel-state.ts src/sidepanel/App.tsx src/dianzhi/ui/Composer.tsx tests/unit/sidepanel/App.spec.tsx tests/unit/dianzhi/ui/Composer.spec.tsx
git commit -m "fix(sidepanel): wait for recovered session readiness"
```

---

### Task 7: Prove the complete restart-follow-up regression

**Files:**

- Create: `tests/unit/background/side-panel-worker-recovery.spec.ts`
- Modify if required for test construction only: `src/background/index.ts`
- Test: all files from Tasks 1-6

**Interfaces:**

- Consumes: real Conversation Manager, coordinator, session registry, and Side Panel event factories
  behind injected fake Chrome/database/provider dependencies.
- Produces: one deterministic regression test for the complete reported sequence.

- [ ] **Step 1: Build the first Background lifetime in the test**

Create stored state for tab 9/window 19 with Content visible. Start a selection, hand it to the update
port, acknowledge `conversation.sync`, and assert final stored ownership is Side Panel with Content
destroyed.

- [ ] **Step 2: Replace process-local state and reconnect the same panel session**

Dispose the first runtime/ports, retain fake `storage.session` and database rows, create fresh manager,
coordinator, registry, and events, then bind command/update ports using the original panel session ID.
Resolve startup and acknowledge replay. Assert the registry becomes ready and the reconstructed route
targets Side Panel.

- [ ] **Step 3: Send a follow-up through the authenticated command adapter**

Invoke:

```ts
await handlePanelConversation({
  panelSessionId: 'panel-session-19',
  command: {
    type: 'conversation.followup',
    requestId: 'followup-after-wake',
    payload: { conversationId: 22, content: 'Explain further.' },
  },
})
```

Emit two provider deltas and `stream.done`. Acknowledge each update and assert exact order:

```ts
expect(deliveredTypes).toEqual([
  'conversation.sync',
  'stream.started',
  'stream.delta',
  'stream.delta',
  'stream.done',
])
```

Assert one provider start, one new user row, one new assistant row, combined response text, and terminal
`completed` status without a Stop command.

- [ ] **Step 4: Cover disconnect during generation**

After the first delta, disconnect only the update port. Emit another delta and terminal update; assert
there is no Content dispatch. Reconnect, acknowledge authoritative sync, and assert its assistant row
contains all text with `completed` status.

- [ ] **Step 5: Cover complete worker replacement during generation**

Persist a checkpoint, replace the Background lifetime, reconnect, and assert the replayed assistant is
`stopped` with the restart message. Assert no second provider request starts.

- [ ] **Step 6: Run the integrated test and focused recovery suite**

Run:

```bash
pnpm vitest --run tests/unit/background/side-panel-worker-recovery.spec.ts tests/unit/background/conversation-manager.spec.ts tests/unit/background/ui-session-coordinator.spec.ts tests/unit/background/ui-session-runtime.spec.ts tests/unit/background/side-panel-session-registry.spec.ts tests/unit/events/side-panel-event.spec.ts tests/unit/sidepanel/App.spec.tsx
```

Expected: all tests pass with no unhandled promise rejection.

- [ ] **Step 7: Commit the integrated regression**

```bash
git add tests/unit/background/side-panel-worker-recovery.spec.ts src/background/index.ts
git commit -m "test(sidepanel): cover followup after worker restart"
```

---

### Task 8: Add real Chromium lifecycle acceptance and finish verification

**Files:**

- Create: `tests/e2e/support/extension-fixture.ts`
- Create: `tests/e2e/side-panel-worker-recovery.spec.ts`
- Modify: `README.md:56-66`
- Modify: `docs/superpowers/specs/2026-09-04-side-panel-worker-recovery-design.md` only if runtime evidence requires a documented correction
- Modify: `task_plan.md`
- Modify: `findings.md`
- Modify: `progress.md`

**Interfaces:**

- Consumes: production `dist/`, Playwright persistent Chromium context, local HTTPS selection page,
  and deterministic delayed mock `/chat/completions` SSE.
- Produces: a runnable `pnpm run test:e2e` path matching the README claim.

- [ ] **Step 1: Create the unpacked-extension fixture**

Implement helpers with explicit signatures:

```ts
export async function launchDianzhiExtension(): Promise<{
  context: BrowserContext
  extensionId: string
  serviceWorker(): Promise<Worker>
  terminateServiceWorker(): Promise<void>
  close(): Promise<void>
}>

export async function startRecoveryTestServer(): Promise<{
  pageUrl: string
  providerBaseUrl: string
  requests: readonly RecordedProviderRequest[]
  close(): Promise<void>
}>
```

Launch Chromium persistently with an isolated temporary profile, `--disable-extensions-except=dist`,
`--load-extension=dist`, and the configured Chromium executable. The local HTTPS server serves a
selectable English paragraph and delayed SSE chunks; its test certificate is accepted only through
the isolated test-browser flag.

- [ ] **Step 2: Write the real follow-up-after-wake test**

Configure the mock provider through the real extension settings UI, select text on the HTTPS fixture,
wait for Content streaming, use the real Side Panel switch, and verify the warm response completes.
Terminate the idle extension service worker, wait for the still-open panel's recovered ready state,
send `Explain further.`, and assert each delayed response chunk appears before the next server delay.
Finally assert the button returns to `aria-label="发送消息"` without clicking Stop and the server saw
exactly one follow-up request.

- [ ] **Step 3: Write the worker-termination-during-stream test**

Start a second delayed response, wait for its first persisted checkpoint, terminate the extension
worker, and wait for reconnection. Assert the visible row becomes `stopped` with the restart recovery
message, no extra provider request appears, the draft remains usable, and browser/extension console
capture contains no unhandled error.

- [ ] **Step 4: Run the production build and E2E test**

Run:

```bash
pnpm run build
pnpm run test:e2e
```

Expected: the extension builds; both real lifecycle tests pass. If the installed Chromium cannot
programmatically terminate the extension worker, record that precise environment limitation and run
the same flow manually through Chrome DevTools before claiming runtime verification.

- [ ] **Step 5: Run all automated quality gates**

Run:

```bash
pnpm run typecheck
pnpm run test
pnpm exec eslint src/background/conversation-manager.ts src/background/side-panel-session-registry.ts src/background/ui-session-coordinator.ts src/background/ui-session-runtime.ts src/background/index.ts src/events/sidePanel/sidePanel.ts src/events/config.ts src/dianzhi/domain/errors.ts src/dianzhi/domain/protocol.ts src/dianzhi/domain/ui-session-protocol.ts src/sidepanel/panel-state.ts src/sidepanel/App.tsx src/dianzhi/ui/Composer.tsx tests/unit/background/conversation-manager.spec.ts tests/unit/background/side-panel-session-registry.spec.ts tests/unit/background/ui-session-coordinator.spec.ts tests/unit/background/ui-session-runtime.spec.ts tests/unit/background/side-panel-worker-recovery.spec.ts tests/unit/events/side-panel-event.spec.ts tests/unit/dianzhi/protocol.spec.ts tests/unit/sidepanel/App.spec.tsx tests/unit/dianzhi/ui/Composer.spec.tsx tests/e2e/support/extension-fixture.ts tests/e2e/side-panel-worker-recovery.spec.ts
pnpm exec prettier --check src/background/conversation-manager.ts src/background/side-panel-session-registry.ts src/background/ui-session-coordinator.ts src/background/ui-session-runtime.ts src/background/index.ts src/events/sidePanel/sidePanel.ts src/events/config.ts src/dianzhi/domain/errors.ts src/dianzhi/domain/protocol.ts src/dianzhi/domain/ui-session-protocol.ts src/sidepanel/panel-state.ts src/sidepanel/App.tsx src/dianzhi/ui/Composer.tsx tests/unit/background/conversation-manager.spec.ts tests/unit/background/side-panel-session-registry.spec.ts tests/unit/background/ui-session-coordinator.spec.ts tests/unit/background/ui-session-runtime.spec.ts tests/unit/background/side-panel-worker-recovery.spec.ts tests/unit/events/side-panel-event.spec.ts tests/unit/dianzhi/protocol.spec.ts tests/unit/sidepanel/App.spec.tsx tests/unit/dianzhi/ui/Composer.spec.tsx tests/e2e/support/extension-fixture.ts tests/e2e/side-panel-worker-recovery.spec.ts README.md docs/superpowers/specs/2026-09-04-side-panel-worker-recovery-design.md docs/superpowers/plans/2026-09-04-side-panel-worker-recovery.md
git diff --check
```

Expected: typecheck, 42+ Vitest files, changed-file lint/format, build, E2E, and whitespace checks pass.
Run repository-wide `format:check` separately and report the known unrelated baseline files if they
remain red.

- [ ] **Step 6: Update operator documentation and planning evidence**

Update README troubleshooting with the automatic recovery behavior and stable not-ready error. Mark
completed plan phases and record exact test counts, build result, E2E result, and any manual browser
evidence in the three planning files. Do not claim the real browser scenario passed without observed
chunk-by-chunk rendering and terminal button recovery.

- [ ] **Step 7: Commit E2E, docs, and verification records**

```bash
git add tests/e2e/support/extension-fixture.ts tests/e2e/side-panel-worker-recovery.spec.ts README.md docs/superpowers/specs/2026-09-04-side-panel-worker-recovery-design.md docs/superpowers/plans/2026-09-04-side-panel-worker-recovery.md task_plan.md findings.md progress.md
git commit -m "test(sidepanel): verify worker recovery in Chromium"
```
