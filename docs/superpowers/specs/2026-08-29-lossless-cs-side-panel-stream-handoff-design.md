# Routed CS-to-Side-Panel Stream Handoff Design

## Problem

When an assistant response is streaming in the Content Script UI and the user
presses `Ctrl + [`, the Side Panel can render an old snapshot but stop receiving
new text. The terminal `stream.done` event can also be lost, leaving the message
status at `streaming` instead of `completed`.

The failure is not in the provider run or the Side Panel reducer. Background
continues updating its live conversation, and the reducer applies delta and
terminal events correctly when they arrive. The failure is in handoff routing:

- Content is destroyed before Side Panel rendering is acknowledged;
- panel commands and conversation updates use different ports, so the handoff
  snapshot and subsequent stream events have no shared ordering guarantee;
- ownership is committed only after rendering, leaving updates without a stable
  destination during the gap;
- selection-session loading can replace a newer live snapshot with an older
  persisted checkpoint.

## Authoritative document requirements

This design preserves the original project contract:

1. Background remains the sole broker and authoritative owner of tab identity,
   conversations, provider runs, and UI routing.
2. The Side Panel subscribes before Background sends its handoff snapshot.
3. Persisted state is reconciled with newer in-memory streaming state by message
   identity.
4. Side Panel readiness, the handoff snapshot, and later conversation updates use
   one ordered long-lived channel.
5. The Side Panel acknowledges its first render before Content is destroyed.
6. The provider request continues unchanged and is never restarted by handoff.
7. A failed open, readiness wait, synchronization, or render keeps Content usable.
8. A successful switch ends with Side Panel visible, Content destroyed,
   `latestUI = 'sidePanel'`, and no CS-only restore bookmark.

## Architecture

### Background-owned delivery route

Background maintains one in-memory delivery route per active tab:

```ts
type DeliveryRoute = { to: 'contentScript' } | { to: 'sidePanel'; windowId: number }
```

Only Background creates or changes this value. Provider and conversation code
continues emitting ordinary `ConversationUpdate` values without knowing which UI
is visible.

Every live conversation update passes through one routing function:

```ts
publishToCurrentUI(tabId, update)
```

The router reads `DeliveryRoute.to` and sends the event to exactly one UI. The
route is runtime delivery state, not persisted ownership. In a stable state it is
derived from the coordinator's persisted surface state after initialization.

This distinction permits a short handoff interval in which Content remains
visible as the failure fallback while new conversation events are already routed
to the synchronized Side Panel. It does not create two authoritative owners.

### One ordered conversation channel

The existing Side Panel conversation-update port becomes the ordered data
channel. It carries every conversation-bearing event:

- `conversation.sync`;
- `conversation.toolChanged`;
- `stream.started`;
- `stream.delta` and `stream.reasoning`;
- `stream.done`, `stream.error`, and `stream.stopped`.

Side Panel readiness for conversation handoff waits on this port. The Side Panel
consumer processes deliveries serially in port order. For `conversation.sync`, it
acknowledges only after React has committed the resulting reducer state, not
merely after `dispatch()` has queued the update. Later deliveries wait behind that
commit, so the acknowledgement represents the original contract's first-render
barrier.

Non-conversation controls such as `clear` may remain on the command channel. No
handoff snapshot or tool snapshot may use a different channel from later stream
events for that conversation.

### Authoritative snapshot loading

Conversation Manager adds one authoritative selection-snapshot operation. It
loads the persisted selection structure, then reconciles the active conversation
with `liveSnapshots` by conversation and message identity. A live assistant row
wins over an older persisted checkpoint, including its accumulated content,
reasoning, and terminal status.

Loading a selection snapshot must never overwrite an existing newer
`liveSnapshots` entry with persisted data. The result sent during handoff is a
clone so UI reducers cannot mutate Background state.

## Handoff sequence

For Content Script to Side Panel:

1. The Content shortcut handler asks Background to toggle the panel.
2. Background starts `chrome.sidePanel.open({ tabId })` synchronously inside the
   user-gesture call stack.
3. Delivery remains `{ to: 'contentScript' }` while Background waits for the Side
   Panel conversation port. Content continues receiving stream events.
4. After readiness, Background loads the current authoritative snapshot.
5. Background posts `conversation.sync(snapshot)` to the Side Panel conversation
   port and retains the returned acknowledgement promise.
6. Without an `await` between posting the snapshot and changing the route,
   Background sets `{ to: 'sidePanel', windowId }`.
7. Every later stream event is posted to the same port after
   `conversation.sync`, preserving FIFO order.
8. Background awaits the `conversation.sync` acknowledgement.
9. Background verifies that the tab page, panel connection, and delivery route
   still match the handoff.
10. Background destroys the Content UI in the window.
11. Background commits durable ownership:
    `sidePanelAppeared = true`, `contentUIAppeared = false`,
    `latestUI = 'sidePanel'`, and `contentRestore` absent.

JavaScript cannot interleave another task between steps 5 and 6 because neither
step yields. Updates applied before step 5 are included in the authoritative
snapshot. Updates applied afterward are delivered behind that snapshot on the
same ordered port.

## Failure and lifecycle behavior

If open, readiness, snapshot loading, dispatch, acknowledgement, identity
validation, or Content destruction fails:

1. Background restores `{ to: 'contentScript' }` when Content still exists.
2. Background loads the newest authoritative live snapshot and sends
   `conversation.sync` to Content. This catches up any updates routed to the
   Side Panel while acknowledgement was pending.
3. Background leaves Content marked visible and does not commit Side Panel
   ownership.
4. Background may close or clear the incomplete Side Panel best-effort.
5. The provider request continues without restart.

Panel close, committed navigation, and tab removal invalidate a pending route
immediately. A late acknowledgement cannot complete an invalidated handoff.
Navigation also revalidates normalized page identity before any state commit or
Content destruction.

If Content destruction fails, handoff does not report success. Background keeps
the route recoverable and records a stable, metadata-only delivery failure.

## Successful postcondition

A CS-to-Side-Panel handoff succeeds only when all conditions hold:

- Side Panel applied the authoritative snapshot;
- subsequent delta and terminal events target Side Panel;
- Content was destroyed;
- Side Panel is the sole persisted visible owner;
- `latestUI` is `sidePanel` and `contentRestore` is absent;
- selection session, conversation ID, assistant message ID, and provider run are
  unchanged.

## Files and boundaries

- `src/background/conversation-manager.ts`: return authoritative live selection
  snapshots without replacing live data with stale persisted state.
- `src/background/ui-session-coordinator.ts`: own `DeliveryRoute`, execute the
  handoff sequence, recover Content, and invalidate routes on lifecycle changes.
- `src/background/index.ts`: make Side Panel readiness and handoff synchronization
  use the conversation-update channel.
- `src/events/config.ts`: retain a dedicated ordered Side Panel conversation
  channel; no universal command/update union is required.
- `src/sidepanel/App.tsx`: continue reducing `ConversationUpdate` events and
  serialize the conversation consumer so synchronization is acknowledged only
  after reducer state commits.
- Focused tests under `tests/unit/background`, `tests/unit/events`, and
  `tests/unit/sidepanel`.

The provider runner, database schema, visual message animation, scrolling,
Markdown, and toolbar styling remain unchanged.

## Verification

Automated tests must prove:

- before Side Panel readiness, deltas still reach Content;
- `conversation.sync`, a later delta, and `stream.done` arrive on the same panel
  port in that order;
- a live in-memory message wins over an older persisted checkpoint;
- `stream.done` changes the handed-off assistant row to `completed`;
- successful acknowledgement is followed by Content destruction and final Side
  Panel ownership;
- ready/render/destroy failure restores and resynchronizes Content;
- panel close, navigation, and tab removal reject late completion and clear the
  pending Side Panel route;
- no handoff path starts a second provider request.

Real Chrome verification must start a sufficiently long response, switch with
`Ctrl + [`, and confirm continuous text, no duplicate suffix, terminal completion,
one provider request, CS closure after panel rendering, and no Background or Side
Panel console errors.

## Out of scope

- Broadcasting every conversation event to both UIs.
- Persisting transient delivery routes across a service-worker restart.
- Adding sequence numbers, replay logs, or a new database migration.
- Redesigning non-conversation Side Panel controls.
