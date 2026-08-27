# Tab UI Session Coordinator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route selections and keyboard shortcuts through a single Background coordinator, guarantee one UI owner per tab/page, and restore every used tool conversation from an explicit SQLite selection session.

**Architecture:** Add `selection_sessions` as the aggregate root above tool-specific conversations, then expose session-oriented operations from the conversation manager. A dedicated Background `UiSessionCoordinator` owns tab/page identity, window-level Side Panel state, event routing, and per-tab serialization; Content Script and Side Panel become response-driven renderers using typed `src/events` contracts.

**Tech Stack:** TypeScript 5.8, React 19, Chrome Manifest V3 (`chrome.tabs`, `chrome.sidePanel`, `chrome.storage.session`), web-sqlite-js/SQLite, Vitest 4, node:sqlite, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-08-27-dianzhi-tab-ui-session-coordinator-design.md`

## Global Constraints

- Work directly on `main`, as requested by the user; preserve unrelated worktree changes.
- Browser-restart UI restoration is out of scope; Service Worker recovery uses `chrome.storage.session`.
- Page identity is trusted `tabId + origin + pathname + search`; URL fragments do not replace a page session.
- At most one of Content UI and Side Panel owns an active tab.
- A global Side Panel is closed directly in Background with `chrome.sidePanel.close({ windowId })`; no Side Panel close command exists.
- A global Side Panel proactively destroys appeared Content UIs in the same window.
- Tool shortcuts do nothing when neither UI appears.
- `UNIQUE(selection_session_id, tool_id)` prevents duplicate tool conversations.
- Selected text, page context, prompts, messages, reasoning, API keys, and authorization headers must never appear in coordination logs.
- Preserve the existing smooth message-growth animation and strict `< 150px` scroll-follow guard.
- When Content UI restoration has no surviving DOM anchor after reload, place it at a deterministic viewport-centered fallback; do not persist anchor geometry.
- Do not run the real-browser verification matrix in this implementation session. Add safe, detailed lifecycle/routing logs and provide the matrix to the user for their manual browser test and log collection.

---

## File Structure

### New files

- `src/dianzhi/domain/ui-session-protocol.ts` — typed UI lifecycle, selection-routing, shortcut, and outbound command contracts plus parsers.
- `src/events/sidePanel/sidePanel.ts` — targeted, acknowledged Background-to-Side-Panel port event pattern.
- `src/background/ui-session-coordinator.ts` — UI ownership state machine, per-tab operation queues, page identity, and Chrome routing.
- `src/background/ui-session-runtime.ts` — Chrome tab/Side Panel adapters and listener registration.
- `tests/unit/offscreen/migration-2-3-0.spec.ts` — real-SQL migration preservation and constraint tests.
- `tests/unit/events/side-panel-event.spec.ts` — targeted port delivery, acknowledgement, and disconnect tests.
- `tests/unit/background/ui-session-coordinator.spec.ts` — state-transition, routing, navigation, and concurrency tests.
- `tests/unit/background/ui-session-runtime.spec.ts` — Chrome listener/adaptor wiring tests.
- `tests/unit/content/views/content-session-routing.spec.tsx` — Content Script lifecycle, selection, restore, and shortcut tests.

### Modified files

- `src/offscreen/database/schema.ts` — schema release 2.3.0.
- `src/offscreen/database/store.ts` — selection-session CRUD and session-oriented snapshots.
- `src/offscreen/database/rpc.ts` — session operation map, validation, mutation classification, and dispatch.
- `src/offscreen/main.ts` — register release 2.3.0.
- `tests/unit/offscreen/sqlite-helper.ts` — apply release 2.3.0 to test databases.
- `tests/unit/offscreen/conversation-store.spec.ts` — session CRUD, active pointer, uniqueness, and cascade tests.
- `src/dianzhi/domain/protocol.ts` — `SelectionSessionRecord`, `selectionSessionId`, and session-aware snapshots/commands.
- `tests/unit/dianzhi/protocol.spec.ts` — session and UI protocol validation.
- `src/events/config.ts` and `src/events/index.ts` — named UI events and Side Panel event export.
- `src/background/conversation-manager.ts` — session-oriented conversation gateway and owner-routed publication.
- `tests/unit/background/conversation-manager.spec.ts` — session creation, activation, deletion, and publication tests.
- `src/background/index.ts` — compose coordinator, manager, event handlers, and runtime listeners.
- `src/dianzhi/conversation/reducer.ts` — remove local `panelOpen` ownership and add explicit restore/destroy events.
- `src/content/views/App.tsx` — response-driven selection/shortcut flow and surface reporting.
- `tests/unit/content/views/App.spec.tsx` — fixture and presentation updates.
- `src/sidepanel/App.tsx` — typed event lifecycle/commands and response-driven shortcuts.
- `src/sidepanel/panel-state.ts` — render/clear transitions for active tabs.
- `tests/unit/sidepanel/App.spec.tsx` — event-based panel binding, commands, and shortcut responses.
- `manifest.config.ts` — retain minimum Chrome 141 and declare only permissions actually required by the final adapters.

---

### Task 1: Add Explicit Selection-Session Persistence

**Files:**

- Create: `tests/unit/offscreen/migration-2-3-0.spec.ts`
- Modify: `src/offscreen/database/schema.ts`
- Modify: `src/offscreen/database/store.ts`
- Modify: `src/offscreen/database/rpc.ts`
- Modify: `src/offscreen/main.ts`
- Modify: `tests/unit/offscreen/sqlite-helper.ts`
- Modify: `tests/unit/offscreen/conversation-store.spec.ts`
- Modify: `src/dianzhi/domain/protocol.ts`
- Modify: persistence/protocol fixtures in `tests/unit/offscreen` and `tests/unit/dianzhi`

**Interfaces:**

- Produces:

```ts
interface SelectionSessionRecord {
  id: number
  activeConversationId: number
  createdAt: string
  updatedAt: string
}

interface ConversationRecord {
  id: number
  selectionSessionId: number
  /** Temporary compatibility alias; remove in Task 8. */
  selectionKey: number
  tabId: number
  toolId: number
  toolName: string
  title: string
  selectedText: string
  contextText: string
  promptSnapshot: string
  createdAt: string
  updatedAt: string
}

interface StoredConversationSnapshot {
  selectionSession: Readonly<SelectionSessionRecord>
  conversation: Readonly<ConversationRecord>
  messages: readonly Readonly<MessageRecord>[]
  conversations: readonly Readonly<ConversationRecord>[]
}
```

The SQL column is temporarily nullable only to break the circular migration dependency. Store reads must repair or reject a null/invalid pointer before constructing `SelectionSessionRecord`, so application code keeps the stronger `number` invariant.

- Produces store operations:

```ts
createSelectionSession(input: CreateSelectionSessionInput): Promise<StoredConversationSnapshot>
getSelectionSession(id: number): Promise<StoredConversationSnapshot | null>
getConversation(id: number): Promise<StoredConversationSnapshot | null>
ensureToolConversation(input: EnsureToolConversationInput): Promise<StoredConversationSnapshot>
setActiveConversation(selectionSessionId: number, conversationId: number): Promise<StoredConversationSnapshot>
deleteSelectionSession(id: number): Promise<void>
deleteOrphanSelectionSessions(retainedIds: number[]): Promise<void>
```

- Consumers in later tasks use `selectionSession.id` as the sole tab-state conversation pointer.

- [ ] **Step 1: Write the migration failure tests**

Create two conversations sharing `selection_key = 10`, attach messages, apply the proposed release, and assert preservation plus the new relationships:

```ts
describe('SELECTION_SESSION_RELEASE 2.3.0', () => {
  it('migrates one selection group into one explicit session', () => {
    const db = databaseAt220()
    insertConversation(db, { id: 10, selectionKey: 10, toolId: 1 })
    insertConversation(db, { id: 11, selectionKey: 10, toolId: 2 })
    insertMessage(db, { id: 20, conversationId: 11 })

    db.exec(SELECTION_SESSION_RELEASE.migrationSQL)

    expect(db.prepare('SELECT * FROM selection_sessions').all()).toEqual([
      expect.objectContaining({ id: 10, active_conversation_id: 10 }),
    ])
    expect(
      db.prepare('SELECT id, selection_session_id FROM conversations ORDER BY id').all()
    ).toEqual([
      { id: 10, selection_session_id: 10 },
      { id: 11, selection_session_id: 10 },
    ])
    expect(db.prepare('SELECT conversation_id FROM messages WHERE id = 20').get()).toEqual({
      conversation_id: 11,
    })
  })

  it('enforces unique tools and cascades session deletion twice', () => {
    const db = migratedDatabase()
    expect(() => insertConversation(db, { selectionSessionId: 10, toolId: 1 })).toThrow()
    db.exec('DELETE FROM selection_sessions WHERE id = 10')
    expect(count(db, 'conversations')).toBe(0)
    expect(count(db, 'messages')).toBe(0)
  })
})
```

- [ ] **Step 2: Run the migration test and confirm RED**

Run:

```bash
pnpm exec vitest run tests/unit/offscreen/migration-2-3-0.spec.ts
```

Expected: failure because `SELECTION_SESSION_RELEASE` and `selection_sessions` do not exist.

- [ ] **Step 3: Add release 2.3.0**

Add `SELECTION_SESSION_RELEASE` to `schema.ts`. Use staged root IDs, rebuild conversations/messages transactionally, and end with these effective definitions:

```sql
CREATE TABLE selection_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  active_conversation_id INTEGER
    REFERENCES conversations(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE conversations_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  selection_session_id INTEGER NOT NULL
    REFERENCES selection_sessions(id) ON DELETE CASCADE,
  tab_id INTEGER NOT NULL,
  tool_id INTEGER NOT NULL,
  tool_name TEXT NOT NULL,
  title TEXT NOT NULL,
  selected_text TEXT NOT NULL,
  context_text TEXT NOT NULL,
  prompt_snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(selection_session_id, tool_id)
);
```

The migration must create the replacement message table with `ON DELETE CASCADE`, copy IDs unchanged, drop the old child table before the old parent, rename replacements, populate active root pointers, and recreate both indexes.

- [ ] **Step 4: Register and test the release sequence**

Append `SELECTION_SESSION_RELEASE` after `MESSAGE_THROUGHPUT_RELEASE` in `src/offscreen/main.ts` and `tests/unit/offscreen/sqlite-helper.ts`:

```ts
releases: [
  SCHEMA_RELEASE,
  CONFIG_RELEASE,
  TOOL_ID_RELEASE,
  MESSAGE_THROUGHPUT_RELEASE,
  SELECTION_SESSION_RELEASE,
]
```

Run the migration test again. Expected: PASS.

- [ ] **Step 5: Write failing store tests**

Add tests proving create/load/activate/delete behavior:

```ts
it('restores every used tool and the persisted active conversation', async () => {
  const created = await store.createSelectionSession(selectionInput(1))
  const second = await store.ensureToolConversation({
    selectionSessionId: created.selectionSession.id,
    tool: DEFAULT_TOOLS[1],
    promptSnapshot: 'Translate run',
  })
  await store.setActiveConversation(created.selectionSession.id, second.conversation.id)

  const restored = await store.getSelectionSession(created.selectionSession.id)
  expect(restored?.selectionSession.activeConversationId).toBe(second.conversation.id)
  expect(restored?.conversations.map((row) => row.toolId)).toEqual([1, 2])
})

it('rejects an active conversation from another session', async () => {
  const first = await store.createSelectionSession(selectionInput(1))
  const second = await store.createSelectionSession(selectionInput(2))
  await expect(
    store.setActiveConversation(first.selectionSession.id, second.conversation.id)
  ).rejects.toMatchObject({ code: 'INVALID_EVENT' })
})
```

- [ ] **Step 6: Run store tests and confirm RED**

Run:

```bash
pnpm exec vitest run tests/unit/offscreen/conversation-store.spec.ts
```

Expected: type/runtime failures for the missing session-oriented methods.

- [ ] **Step 7: Implement session-oriented records and store methods**

Make `selectionSessionId` authoritative in domain/store records. To keep intermediate commits type-safe while the Content, Side Panel, and legacy manager are migrated in later tasks, expose `selectionKey` as a deprecated computed alias with the same numeric value; it is never stored in the new schema and Task 8 removes it. `getSelectionSession()` must load the session row, active conversation, active messages, and all session conversations. `setActiveConversation()` must use a membership-checked update:

```sql
UPDATE selection_sessions
SET active_conversation_id = ?, updated_at = ?
WHERE id = ?
  AND EXISTS (
    SELECT 1 FROM conversations
    WHERE id = ? AND selection_session_id = selection_sessions.id
  );
```

`ensureToolConversation()` must query by `(selection_session_id, tool_id)` and update the active pointer before returning. `deleteOrphanSelectionSessions([])` deletes all rows; a nonempty list deletes rows not in the validated retained set using positional bindings.

- [ ] **Step 8: Replace database RPC operations**

Update `DatabaseOperationMap`, `MUTATIONS`, validation, and dispatch:

```ts
createSelectionSession: { args: CreateSelectionSessionInput; result: StoredConversationSnapshot }
getSelectionSession: { args: { id: number }; result: StoredConversationSnapshot | null }
getConversation: { args: { id: number }; result: StoredConversationSnapshot | null }
setActiveConversation: {
  args: { selectionSessionId: number; conversationId: number }
  result: StoredConversationSnapshot
}
deleteSelectionSession: { args: { id: number }; result: void }
deleteOrphanSelectionSessions: { args: { retainedIds: number[] }; result: void }
```

Remove `createSelection` and `deleteSelection` only after all call sites in this task compile against the replacements. Retain `getConversation`, but make it return the owning session-aware snapshot so `conversation.sync`, follow-up, retry, and stop can still begin from a conversation ID. Keep message mutation RPC unchanged.

- [ ] **Step 9: Update fixtures and run persistence/type gates**

Run:

```bash
pnpm exec vitest run tests/unit/offscreen/migration-2-3-0.spec.ts tests/unit/offscreen/conversation-store.spec.ts tests/unit/dianzhi/protocol.spec.ts
pnpm run typecheck
```

Expected: all listed tests and TypeScript pass.

- [ ] **Step 10: Commit the persistence aggregate**

```bash
git add src/offscreen src/dianzhi/domain/protocol.ts tests/unit/offscreen tests/unit/dianzhi/protocol.spec.ts
git commit -m "feat(database): add explicit selection sessions"
```

---

### Task 2: Add Typed UI Events and Targeted Side Panel Delivery

**Files:**

- Create: `src/dianzhi/domain/ui-session-protocol.ts`
- Create: `src/events/sidePanel/sidePanel.ts`
- Create: `tests/unit/events/side-panel-event.spec.ts`
- Modify: `src/events/index.ts`
- Modify: `src/events/config.ts`
- Modify: `tests/unit/dianzhi/protocol.spec.ts`
- Modify: `src/dianzhi/domain/errors.ts`
- Modify: `src/events/internal/messaging.ts`

**Interfaces:**

- Produces the request/result types named in the spec:

```ts
SurfaceStatusRequest
SurfaceStatusResponse
SelectionRouteRequest
SelectionRouteResult
PanelToggleRequest
PanelToggleResult
SelectToolShortcutRequest
CycleToolShortcutRequest
ToolShortcutResult
ContentUiCommand
SidePanelCommand
```

- Produces:

```ts
interface TargetedSidePanelEvent<Args, Return> {
  dispatch(args: Args, windowId: number): Promise<Return>
  accept(port: chrome.runtime.Port): boolean
  handle(
    binding: { tabId: number; windowId: number },
    callback: (args: Args) => Promise<Return>
  ): Cancel
}

function bg2sp<Args, Return>(name: string): TargetedSidePanelEvent<Args, Return>
```

- [ ] **Step 1: Write protocol parser tests**

Add acceptance and trust-boundary cases:

```ts
expect(parseSelectionRoute(selectionRequest('run', 'run fast')).ok).toBe(true)
expect(
  parseSelectionRoute({
    ...selectionRequest('run', 'run fast'),
    payload: { selectedText: 'run', contextText: 'run fast', tabId: 9 },
  }).ok
).toBe(false)
expect(parseToolShortcut(toolIndexRequest(2)).ok).toBe(true)
expect(parseToolShortcut(toolIndexRequest(0)).ok).toBe(false)
```

- [ ] **Step 2: Write targeted Side Panel transport tests**

Use fake ports for windows 19 and 20:

```ts
it('delivers only to the requested window and waits for acknowledgement', async () => {
  const event = bg2sp<SidePanelCommand, true>('dianzhi:side-panel-command')
  const left = fakePort({ tabId: 9, windowId: 19 })
  const right = fakePort({ tabId: 10, windowId: 20 })
  event.accept(left.port)
  event.accept(right.port)

  const result = event.dispatch({ type: 'clear' }, 20)
  expect(left.postMessage).not.toHaveBeenCalled()
  right.acknowledge(true)
  await expect(result).resolves.toBe(true)
})

it('rejects pending delivery when the target port disconnects', async () => {
  const result = event.dispatch({ type: 'clear' }, 19)
  left.disconnect()
  await expect(result).rejects.toMatchObject({ code: 'SIDE_PANEL_READY_TIMEOUT' })
})
```

- [ ] **Step 3: Run the protocol/transport tests and confirm RED**

Run:

```bash
pnpm exec vitest run tests/unit/dianzhi/protocol.spec.ts tests/unit/events/side-panel-event.spec.ts
```

Expected: missing protocol and `bg2sp` exports.

- [ ] **Step 4: Implement the action-oriented protocol**

Use discriminated unions rather than one generic coordinator request. Each request has `requestId`, a fixed `type`, and a payload that rejects caller-supplied `tabId`, `windowId`, and URL fields. Define explicit results, including:

```ts
type PanelToggleResult = {
  currentUI: UiSurface | 'none'
  latestUI: UiSurface
  action: 'destroy' | 'restore' | 'none'
  snapshot: ConversationSnapshot | null
}
```

Add stable errors `UI_SESSION_STALE` and `SIDE_PANEL_DELIVERY_FAILED` to `DianzhiErrorCode` and the event error-code reconstruction set.

- [ ] **Step 5: Implement `bg2sp`**

Add `'bg2sp'` to `EventChannel` and derive the port name with `buildEventName('bg2sp', name)`. The Side Panel `handle()` method opens the port, posts its binding, processes `{ messageId, args }`, and replies with `{ messageId, data | error }`. Background `accept()` stores one binding per port/window; `dispatch()` targets one window and resolves only after the matching acknowledgement. Remove bindings and reject pending requests on disconnect. Use the existing standardized error serializer.

- [ ] **Step 6: Declare named events**

In `src/events/config.ts`, add:

```ts
export const contentSurfaceStatus = events.cs2bg<SurfaceStatusRequest, SurfaceStatusResponse>(
  'dianzhi:ui-surface-status'
)
export const panelSurfaceStatus = events.ep2bg<SurfaceStatusRequest, SurfaceStatusResponse>(
  'dianzhi:ui-surface-status'
)
export const selectionRoute = events.cs2bg<SelectionRouteRequest, SelectionRouteResult>(
  'dianzhi:selection-route'
)
export const contentPanelToggle = events.cs2bg<PanelToggleRequest, PanelToggleResult>(
  'dianzhi:shortcut-panel-toggle'
)
export const panelPanelToggle = events.ep2bg<PanelToggleRequest, PanelToggleResult>(
  'dianzhi:shortcut-panel-toggle'
)
export const contentSelectToolShortcut = events.cs2bg<
  SelectToolShortcutRequest,
  ToolShortcutResult
>('dianzhi:shortcut-select-tool')
export const panelSelectToolShortcut = events.ep2bg<SelectToolShortcutRequest, ToolShortcutResult>(
  'dianzhi:shortcut-select-tool'
)
export const contentCycleToolShortcut = events.cs2bg<CycleToolShortcutRequest, ToolShortcutResult>(
  'dianzhi:shortcut-cycle-tool'
)
export const panelCycleToolShortcut = events.ep2bg<CycleToolShortcutRequest, ToolShortcutResult>(
  'dianzhi:shortcut-cycle-tool'
)
export const contentUiCommand = events.bg2cs<ContentUiCommand, void>('dianzhi:content-ui-command')
export const sidePanelCommand = events.bg2sp<SidePanelCommand, true>('dianzhi:side-panel-command')
export const sidePanelConversationUpdate = events.bg2sp<ConversationUpdate, true>(
  'dianzhi:conversation-update'
)
```

- [ ] **Step 7: Run event tests and commit**

Run:

```bash
pnpm exec vitest run tests/unit/dianzhi/protocol.spec.ts tests/unit/events/side-panel-event.spec.ts
pnpm run typecheck
```

Expected: PASS.

```bash
git add src/dianzhi/domain src/events tests/unit/dianzhi/protocol.spec.ts tests/unit/events
git commit -m "feat(events): add typed UI session routing"
```

---

### Task 3: Expose a Session-Oriented Conversation Gateway

**Files:**

- Modify: `src/background/conversation-manager.ts`
- Modify: `tests/unit/background/conversation-manager.spec.ts`
- Modify: `src/background/provider-runner.ts` only if its public input needs `selectionSessionId`

**Interfaces:**

- Consumes Task 1 store/RPC methods.
- Produces:

```ts
interface UiConversationGateway {
  createSelection(input: {
    tabId: number
    replaceSelectionSessionId: number | null
    selectedText: string
    contextText: string
  }): Promise<ConversationSnapshot>
  loadSelectionSession(selectionSessionId: number): Promise<ConversationSnapshot>
  activateTool(selectionSessionId: number, toolId: number): Promise<ConversationSnapshot>
  stopSelectionSession(selectionSessionId: number): Promise<void>
  deleteSelectionSession(selectionSessionId: number): Promise<void>
}
```

- Produces owner-routed publication dependency:

```ts
publishToOwner(tabId: number, update: ConversationUpdate): Promise<void>
```

- [ ] **Step 1: Replace panel-centric manager tests with gateway tests**

Add tests that prove session behavior independently of Chrome Side Panel APIs:

```ts
it('creates one session, appends one assistant, and starts one run', async () => {
  const snapshot = await manager.createSelection({
    tabId: 9,
    replaceSelectionSessionId: null,
    selectedText: 'run',
    contextText: 'run fast',
  })
  expect(database.request).toHaveBeenCalledWith(
    'createSelectionSession',
    expect.objectContaining({ tabId: 9 })
  )
  expect(providerRunner.start).toHaveBeenCalledTimes(1)
  expect(snapshot.selectionSession.id).toBe(10)
})

it('activates the unique conversation for a tool and persists the pointer', async () => {
  const snapshot = await manager.activateTool(10, 2)
  expect(database.request).toHaveBeenCalledWith(
    'ensureToolConversation',
    expect.objectContaining({ selectionSessionId: 10, tool: expect.objectContaining({ id: 2 }) })
  )
  expect(snapshot.activeToolId).toBe(2)
})
```

- [ ] **Step 2: Run manager tests and confirm RED**

Run:

```bash
pnpm exec vitest run tests/unit/background/conversation-manager.spec.ts
```

Expected: missing gateway methods and obsolete panel expectations.

- [ ] **Step 3: Refactor snapshot construction**

Build `ConversationSnapshot` from `stored.selectionSession.activeConversationId`. Tool refs come from all stored conversations:

```ts
const active = stored.conversations.find(
  (conversation) => conversation.id === stored.selectionSession.activeConversationId
)
if (!active) throw invalid('The selection session has no valid active conversation.')
```

If the pointer is invalid, select the first/root conversation, call `setActiveConversation`, and log a bounded recovery.

- [ ] **Step 4: Implement gateway methods**

Move selection/tool logic out of `handle()` into the exact `UiConversationGateway` methods. `stopSelectionSession()` filters `liveSnapshots` by `conversation.selectionSessionId`, stops every matching handle, and awaits their settled `done` promises. `deleteSelectionSession()` stops first, clears matching live maps/subscribers, then calls the database deletion operation.

- [ ] **Step 5: Route streaming through one injected owner publisher**

Replace unconditional Content Script plus subscriber broadcasting with `publishToOwner(tabId, update)`. Keep `applyUpdate()` and live snapshot maintenance inside the manager. The coordinator will provide the owner publisher in Task 5.

- [ ] **Step 6: Preserve follow-up/retry/stop commands**

Keep `conversation.sync`, `conversation.followup`, `conversation.retry`, and `stream.stop` as conversation commands. Replace `conversation.ensureTool`, `conversation.create`, and all `panel.*` handling only after the new callers land; until Task 8, parse them as compatibility routes that delegate to the new gateway.

- [ ] **Step 7: Run manager/type gates and commit**

```bash
pnpm exec vitest run tests/unit/background/conversation-manager.spec.ts tests/unit/background/provider-runner.spec.ts
pnpm run typecheck
git add src/background/conversation-manager.ts src/background/provider-runner.ts tests/unit/background
git commit -m "refactor(background): expose selection session gateway"
```

---

### Task 4: Implement the UI Session Coordinator State Machine

**Files:**

- Create: `src/background/ui-session-coordinator.ts`
- Create: `tests/unit/background/ui-session-coordinator.spec.ts`

**Interfaces:**

- Consumes `UiConversationGateway`, typed UI protocol, and these dependencies:

```ts
interface UiSessionCoordinatorDependencies {
  conversations: UiConversationGateway
  loadSettings(): Promise<DianzhiSettings>
  sessionStore: {
    load(): Promise<Record<string, TabSessionState>>
    save(state: Record<string, TabSessionState>): Promise<void>
  }
  tabs: {
    get(tabId: number): Promise<{ id: number; windowId: number; url?: string }>
    query(windowId: number): Promise<Array<{ id: number; windowId: number; url?: string }>>
  }
  content: {
    destroy(tabId: number): Promise<void>
    publish(tabId: number, update: ConversationUpdate): Promise<void>
  }
  sidePanel: {
    open(tabId: number): Promise<void>
    close(windowId: number): Promise<void>
    command(windowId: number, command: SidePanelCommand): Promise<true>
    publish(windowId: number, update: ConversationUpdate): Promise<void>
  }
}
```

- Produces:

```ts
initialize(): Promise<void>
reportContentStatus(request: SurfaceStatusRequest, sender: MessageSender): Promise<SurfaceStatusResponse>
reportPanelStatus(request: SurfaceStatusRequest, binding: PanelBinding): Promise<SurfaceStatusResponse>
routeSelection(request: SelectionRouteRequest, sender: MessageSender): Promise<SelectionRouteResult>
togglePanel(request: PanelToggleRequest, source: UiEventSource): Promise<PanelToggleResult>
selectTool(request: SelectToolShortcutRequest, source: UiEventSource): Promise<ToolShortcutResult>
cycleTool(request: CycleToolShortcutRequest, source: UiEventSource): Promise<ToolShortcutResult>
publish(tabId: number, update: ConversationUpdate): Promise<void>
onTabActivated(tabId: number, windowId: number): Promise<void>
onTabUpdated(tabId: number, windowId: number, url: string): Promise<void>
onTabRemoved(tabId: number, windowId: number): Promise<void>
onPanelOpened(windowId: number): Promise<void>
onPanelClosed(windowId: number): Promise<void>
```

A valid fresh tab record defaults `latestUI` to `contentScript`. This gives a deterministic restore target before the tab has ever opened the Side Panel; subsequent successful deliveries update the field.

- [ ] **Step 1: Write the four panel-toggle tests**

Represent each approved state explicitly:

```ts
it.each([
  ['content appeared', contentState(), 'sidePanel'],
  ['panel appeared', panelState(), 'none'],
  ['none latest content', noneState('contentScript'), 'contentScript'],
  ['none latest panel', noneState('sidePanel'), 'sidePanel'],
])('%s transitions to %s', async (_name, state, expected) => {
  const coordinator = coordinatorWith(state)
  const result = await coordinator.togglePanel(toggleRequest(), contentSource(9, 19, PAGE))
  expect(result.currentUI).toBe(expected)
})
```

Add a specific assertion that panel close calls `close(19)` and never `command(..., { type: 'close' })`.

- [ ] **Step 2: Write routing, URL, and ownership tests**

Cover:

```ts
it('routes one selection to an appeared panel and returns display false')
it('falls back to content with the same snapshot when panel delivery fails')
it('preserves a session for the same URL with a different hash')
it('stops and deletes the old session when pathname or search changes')
it('destroys every appeared content UI when a global panel opens')
it('renders the active tab session or clears the panel on tab activation')
it('isolates panels and content cleanup by windowId')
it('ignores both tool shortcuts when no UI appears')
it('rejects late work after tab removal closes its queue')
```

For the no-duplicate fallback test:

```ts
expect(conversations.createSelection).toHaveBeenCalledTimes(1)
expect(result).toEqual({ target: 'contentScript', display: true, snapshot })
```

- [ ] **Step 3: Run coordinator tests and confirm RED**

```bash
pnpm exec vitest run tests/unit/background/ui-session-coordinator.spec.ts
```

Expected: module not found.

- [ ] **Step 4: Implement URL normalization and trusted source resolution**

```ts
export function normalizePageUrl(input: string): string {
  const url = new URL(input)
  return `${url.origin}${url.pathname}${url.search}`
}
```

Content sources require `sender.tab.id`, `sender.tab.windowId`, and `sender.url` or `sender.tab.url`. Panel sources use the event-port binding and a fresh `tabs.get()` result.

- [ ] **Step 5: Implement per-tab serialization**

Maintain `Map<number, Promise<unknown>>` plus a closed-tab set. `runForTab(tabId, operation)` chains after the previous promise, removes the tail only if it is still current, and rejects with `UI_SESSION_STALE` after removal. Revalidate normalized identity immediately before every committed state save or UI delivery.

- [ ] **Step 6: Implement status, selection, and tool methods**

Follow the exact result contracts. A `destroyed` status clears only the surface-presence flag; a null request pointer must not erase an already-recorded `selectionSessionId` when page identity still matches. Selection must stop/delete the previous session before creation, then send to only one target. Tool index uses the enabled `snapshot.tools[index - 1]`; cycle uses the current active tool index and wraps in the requested direction. Commit `latestUI` only after successful target delivery.

- [ ] **Step 7: Implement toggle and window-wide ownership**

When opening a global panel:

```ts
await sidePanel.open(tabId)
for (const tab of await tabs.query(windowId)) {
  if (tab.id && tabStates.get(tab.id)?.contentUIAppeared) {
    await content.destroy(tab.id).catch(logDeliveryFailure)
    markContentDestroyed(tab.id)
  }
}
await sidePanel.command(windowId, snapshot ? { type: 'render', snapshot } : { type: 'clear' })
```

When closing, call only `sidePanel.close(windowId)` and wait for success before marking the window destroyed.

- [ ] **Step 8: Implement tab/panel lifecycle and owner publication**

On active-tab change with an appeared panel, load and render/clear the target tab and destroy its Content UI. `publish()` sends streaming updates only to Content when it owns the tab, or only to the appeared panel for the tab's window. Tab removal stops/deletes the session and erases stored state.

- [ ] **Step 9: Run tests and commit**

```bash
pnpm exec vitest run tests/unit/background/ui-session-coordinator.spec.ts
pnpm run typecheck
git add src/background/ui-session-coordinator.ts tests/unit/background/ui-session-coordinator.spec.ts
git commit -m "feat(background): coordinate tab UI ownership"
```

---

### Task 5: Wire Chrome Runtime, Events, and Safe Logs

**Files:**

- Create: `src/background/ui-session-runtime.ts`
- Create: `tests/unit/background/ui-session-runtime.spec.ts`
- Modify: `src/background/index.ts`
- Modify: `manifest.config.ts`
- Modify: `src/events/config.ts` — register the final Background-to-Side-Panel command and conversation-update events

**Interfaces:**

- Consumes Task 2 events and Task 4 coordinator.
- Produces:

```ts
function registerUiSessionRuntime(input: {
  chromeApi: typeof chrome
  coordinator: UiSessionCoordinator
  sidePanelCommand: TargetedSidePanelEvent<SidePanelCommand, true>
  sidePanelConversationUpdate: TargetedSidePanelEvent<ConversationUpdate, true>
}): () => void
```

- [ ] **Step 1: Write runtime adapter tests**

Use fake Chrome event registries:

```ts
it('routes tab activation and committed URL changes to the coordinator', async () => {
  const runtime = fakeChromeRuntime()
  registerUiSessionRuntime({ chromeApi: runtime.chrome, coordinator, sidePanelCommand })
  runtime.tabs.onActivated.emit({ tabId: 9, windowId: 19 })
  runtime.tabs.onUpdated.emit(9, { status: 'loading', url: PAGE_2 }, tab(9, 19, PAGE_2))
  expect(coordinator.onTabActivated).toHaveBeenCalledWith(9, 19)
  expect(coordinator.onTabUpdated).toHaveBeenCalledWith(9, 19, PAGE_2)
})

it('uses native Side Panel open/closed events as lifecycle evidence', async () => {
  runtime.sidePanel.onOpened.emit({ windowId: 19, path: PANEL_PATH })
  runtime.sidePanel.onClosed.emit({ windowId: 19, path: PANEL_PATH })
  expect(coordinator.onPanelOpened).toHaveBeenCalledWith(19)
  expect(coordinator.onPanelClosed).toHaveBeenCalledWith(19)
})
```

- [ ] **Step 2: Run runtime tests and confirm RED**

```bash
pnpm exec vitest run tests/unit/background/ui-session-runtime.spec.ts
```

Expected: runtime module not found.

- [ ] **Step 3: Implement listener registration and cleanup**

Register `tabs.onActivated`, `tabs.onUpdated`, `tabs.onRemoved`, `sidePanel.onOpened`, `sidePanel.onClosed`, and `runtime.onConnect`. Ignore subframe/noncommitted updates and other extension Side Panel paths. Return a cleanup function used by tests.

- [ ] **Step 4: Register request/response event handlers**

In `background/index.ts`, parse every untrusted request before calling the coordinator. Use `handleWithSender` for Content events and privileged extension-sender validation plus current panel binding for Side Panel events. Compose manager publication through a coordinator ref:

```ts
const coordinatorRef: { current?: UiSessionCoordinator } = {}
const manager = createConversationManager({
  ...dependencies,
  publishToOwner: (tabId, update) => coordinatorRef.current!.publish(tabId, update),
})
const coordinator = createUiSessionCoordinator({ conversations: manager, ...uiDependencies })
coordinatorRef.current = coordinator
```

- [ ] **Step 5: Persist and reconcile session state**

Use a new key such as `dianzhi.ui-tab-sessions`. On initialization, load records, validate their primitive fields, compare them to current `tabs.get()` URL/window data, retain only exact normalized matches, and call `deleteOrphanSelectionSessions(retainedSessionIds)`.

- [ ] **Step 6: Add safe lifecycle logs**

For every operation log request ID, event, tab/window, normalized URL, source/target UI, session/conversation IDs, and `received|validated|committed|delivered|failed`. Pass no selected/context/message/provider content to the logger. Add test assertions that a sentinel selected string and API-key string never appear in serialized log arguments.

- [ ] **Step 7: Run Background gates and commit**

```bash
pnpm exec vitest run tests/unit/background/ui-session-runtime.spec.ts tests/unit/background/ui-session-coordinator.spec.ts tests/unit/background/conversation-manager.spec.ts
pnpm run typecheck
git add src/background src/events/config.ts manifest.config.ts tests/unit/background
git commit -m "feat(background): wire UI session event routing"
```

---

### Task 6: Convert Content Script to Response-Driven Routing

**Files:**

- Create: `tests/unit/content/views/content-session-routing.spec.tsx`
- Modify: `src/content/views/App.tsx`
- Modify: `src/dianzhi/conversation/reducer.ts`
- Modify: `tests/unit/content/views/App.spec.tsx`
- Modify: `tests/unit/content/selection/context.spec.ts` only if selection controller typing changes

**Interfaces:**

- Consumes:

```ts
contentSurfaceStatus
selectionRoute
contentPanelToggle
contentSelectToolShortcut
contentCycleToolShortcut
contentUiCommand
```

- Produces reducer events:

```ts
{
  type: 'view.restored'
  snapshot: ConversationSnapshot
}
{
  type: 'view.destroyed'
}
```

- [ ] **Step 1: Write Content routing tests**

Mock the new events and assert:

```ts
it('renders only when selection.route targets content', async () => {
  selectionRouteDispatch.mockResolvedValue({ target: 'contentScript', display: true, snapshot })
  await emitSelection('run')
  expect(screen.queryByRole('dialog', { name: '点知查询' })).not.toBeNull()
  expect(contentSurfaceStatusDispatch).toHaveBeenCalledWith(
    expect.objectContaining({
      status: 'appeared',
      selectionSessionId: snapshot.selectionSession.id,
    })
  )
})

it('does not render when Background routes selection to Side Panel', async () => {
  selectionRouteDispatch.mockResolvedValue({ target: 'sidePanel', display: false, snapshot: null })
  await emitSelection('run')
  expect(screen.queryByRole('dialog', { name: '点知查询' })).toBeNull()
})

it('restores a same-page session with a fallback placement after reload', async () => {
  panelToggleDispatch.mockResolvedValue({
    currentUI: 'contentScript',
    latestUI: 'contentScript',
    action: 'restore',
    snapshot,
  })
  pressDockShortcut()
  expect(dialogStyle()).toMatchObject({ left: expect.any(String), top: expect.any(String) })
})
```

Also test `contentUi.destroy`, close reporting, and shortcut results targeted to Side Panel.

- [ ] **Step 2: Run Content routing tests and confirm RED**

```bash
pnpm exec vitest run tests/unit/content/views/content-session-routing.spec.tsx
```

Expected: mocks/events are not consumed and Content still calls `conversation.create`/`panel.toggle` directly.

- [ ] **Step 3: Remove local panel ownership**

Delete `panelOpen` from `ConversationViewState`. `conversation.sync` updates data without deciding visibility. Only `selection.route`/toggle responses and `contentUi.destroy` dispatch `view.restored` or `view.destroyed`.

- [ ] **Step 4: Route selection before rendering**

Keep the captured anchor locally, dispatch `selectionRoute`, render only the Content result, and report appeared after the snapshot is committed. Do not dispatch `selection.started` before routing. On failure, show the existing structured error UI only if Background did not successfully route elsewhere.

- [ ] **Step 5: Implement lifecycle reporting and fallback placement**

On bootstrap dispatch destroyed with `selectionSessionId: null`. On user close and Background destroy command, dispatch `view.destroyed` and report destroyed. For restore without an anchor, synthesize an anchor centered horizontally at 96px from the viewport top:

```ts
const fallbackAnchor: AnchorRect = {
  left: window.innerWidth / 2,
  right: window.innerWidth / 2,
  top: 96,
  bottom: 96,
}
```

- [ ] **Step 6: Route shortcuts through their named events**

Capture-phase handling remains. `Ctrl + [` works without a local snapshot. Direct/cycle tool shortcuts always dispatch, then apply a returned Content snapshot only when `handled && target === 'contentScript'`; no-UI ignored results make no UI change. Follow-up/retry/stop remain conversation commands.

- [ ] **Step 7: Preserve existing Content behavior and commit**

```bash
pnpm exec vitest run tests/unit/content/views/content-session-routing.spec.tsx tests/unit/content/views/App.spec.tsx tests/unit/content/views/scroll-guard.spec.ts tests/unit/content/views/useScrollGuard.spec.tsx
pnpm run typecheck
git add src/content src/dianzhi/conversation/reducer.ts tests/unit/content
git commit -m "feat(content): follow background UI routing decisions"
```

---

### Task 7: Convert Side Panel to Typed Commands and Responses

**Files:**

- Modify: `src/sidepanel/App.tsx`
- Modify: `src/sidepanel/panel-state.ts`
- Modify: `tests/unit/sidepanel/App.spec.tsx`
- Modify: `tests/unit/sidepanel/scroll-follow.spec.ts` only for fixture field updates
- Modify: `src/events/config.ts` — consume the owner-routed `sidePanelConversationUpdate` event

**Interfaces:**

- Consumes:

```ts
panelSurfaceStatus
panelPanelToggle
panelSelectToolShortcut
panelCycleToolShortcut
sidePanelCommand
sidePanelConversationUpdate
```

- Produces `sidePanelCommand` acknowledgement `true` only after `render`, `clear`, or `selectTool` has been reduced into panel state, and acknowledges `sidePanelConversationUpdate` only after the streaming update has been reduced.

- [ ] **Step 1: Rewrite Side Panel lifecycle and shortcut tests**

Replace raw `port.postMessage({ type: 'close' })` expectations:

```ts
it('dispatches the panel-toggle event from an empty focused panel', async () => {
  await renderApp()
  pressDockShortcut(window)
  expect(panelToggleDispatch).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'shortcut.panelToggle' })
  )
})

it('renders and acknowledges a targeted Background command', async () => {
  await renderApp()
  await sidePanelCommandHandler({ type: 'render', snapshot })
  expect(host?.querySelector('.dz-panel-history')).not.toBeNull()
})

it('clears to the empty component when the active tab has no session', async () => {
  await sidePanelCommandHandler({ type: 'clear' })
  expect(host?.querySelector('.dz-panel-empty')).not.toBeNull()
})
```

- [ ] **Step 2: Run Side Panel tests and confirm RED**

```bash
pnpm exec vitest run tests/unit/sidepanel/App.spec.tsx
```

Expected: Side Panel still owns a raw port and posts `close`.

- [ ] **Step 3: Bind typed Side Panel events**

Query the active tab/window once for event binding, call both `sidePanelCommand.handle(binding, callback)` and `sidePanelConversationUpdate.handle(binding, callback)`, and report panel appeared. On cleanup report destroyed when possible; Background port disconnect/native `onClosed` remains the authoritative fallback.

- [ ] **Step 4: Apply render/clear/selectTool commands**

Extend `panel-state.ts` with:

```ts
type PanelStateEvent =
  | ConversationUpdate
  | { type: 'panel.render'; snapshot: ConversationSnapshot }
  | { type: 'panel.clear' }
  | { type: 'panel.connected' }
  | { type: 'panel.disconnected' }
```

`panel.clear` sets `snapshot` and `error` to null while preserving connection state. `render`/`selectTool` replace the snapshot and reset the per-session handoff/draft key.

- [ ] **Step 5: Route shortcuts by response**

`Ctrl + [` dispatches `panelPanelToggle`; Background closes the Chrome panel directly. Direct/cycle tool shortcuts dispatch their named events and reduce returned Side Panel snapshots. No raw `close` post exists. Follow-up/retry/stop remain conversation commands using the active conversation ID.

- [ ] **Step 6: Preserve streaming UI and commit**

Keep `MessageList` smooth growth, `useScrollFollow`, pending dots, toolbar hover/focus behavior, provider setup, drafts, and composer focus unchanged.

```bash
pnpm exec vitest run tests/unit/sidepanel/App.spec.tsx tests/unit/sidepanel/scroll-follow.spec.ts tests/unit/dianzhi/ui/MessageList.spec.tsx
pnpm run typecheck
git add src/sidepanel src/events/config.ts tests/unit/sidepanel
git commit -m "feat(sidepanel): render routed tab sessions"
```

---

### Task 8: Remove Legacy Panel Protocol and Run End-to-End Gates

**Files:**

- Modify: `src/dianzhi/domain/protocol.ts`
- Modify: `src/background/conversation-manager.ts`
- Modify: `src/background/index.ts`
- Modify: `src/sidepanel/App.tsx`
- Modify: `src/content/views/App.tsx`
- Modify: `tests/unit/dianzhi/protocol.spec.ts`
- Modify: `tests/unit/background/conversation-manager.spec.ts`
- Modify: `tests/unit/content/views/content-session-routing.spec.tsx`
- Modify: `tests/unit/sidepanel/App.spec.tsx`
- Modify: `docs/superpowers/plans/2026-08-27-tab-ui-session-coordinator.md` checkboxes during execution

**Interfaces:**

- Final `ConversationCommand` contains only:

```ts
type ConversationCommand =
  | { type: 'conversation.sync'; requestId: string; payload: { conversationId: number } }
  | {
      type: 'conversation.followup'
      requestId: string
      payload: { conversationId: number; content: string }
    }
  | { type: 'conversation.retry'; requestId: string; payload: { conversationId: number } }
  | { type: 'stream.stop'; requestId: string; payload: { conversationId: number } }
```

- Final code has no `panel.open`, `panel.toggle`, `panel.rendered`, `panel.close`, `panel.handoffReady`, `panel.closed`, `selectionKey`, or raw Side Panel `postMessage({ type: 'close' })` application paths.

- [ ] **Step 1: Add absence/regression assertions**

Update protocol tests to reject legacy panel and selection-key commands:

```ts
expect(
  parseConversationCommand({
    type: 'panel.toggle',
    requestId: 'legacy',
    payload: { conversationId: 1 },
  }).ok
).toBe(false)
expect(
  parseConversationCommand({
    type: 'conversation.ensureTool',
    requestId: 'legacy',
    payload: { selectionKey: 1, toolId: 2 },
  }).ok
).toBe(false)
```

- [ ] **Step 2: Remove compatibility branches and stale state**

Delete old panel command/update variants, manager handoff maps/subscriber bindings that have been replaced by owner publication, legacy port-close handling, and `selectionKey` aliases. Confirm with:

```bash
rg -n "panel\.open|panel\.toggle|panel\.rendered|panel\.close|panel\.handoffReady|panel\.closed|selectionKey|postMessage\(\{ type: 'close'" src tests
```

Expected: no application hits; migration tests may contain `selection_key` as historical schema input.

- [ ] **Step 3: Run focused cross-context tests**

```bash
pnpm exec vitest run \
  tests/unit/offscreen/migration-2-3-0.spec.ts \
  tests/unit/offscreen/conversation-store.spec.ts \
  tests/unit/events/side-panel-event.spec.ts \
  tests/unit/background/ui-session-coordinator.spec.ts \
  tests/unit/background/ui-session-runtime.spec.ts \
  tests/unit/background/conversation-manager.spec.ts \
  tests/unit/content/views/content-session-routing.spec.tsx \
  tests/unit/content/views/App.spec.tsx \
  tests/unit/sidepanel/App.spec.tsx \
  tests/unit/sidepanel/scroll-follow.spec.ts
```

Expected: PASS.

- [ ] **Step 4: Run all quality gates**

```bash
pnpm run format:check
pnpm run lint
pnpm run test
pnpm run build
git diff --check
```

Expected: every command exits 0. Preserve the existing Vite/Tailwind sourcemap warning as a non-failing upstream warning unless this change introduces a new warning.

- [ ] **Step 5: Prepare the real-Chrome handoff and safe-log checklist**

Do not launch or drive Chrome in this implementation session. Build the unpacked extension, then hand this matrix to the user for manual testing:

```text
Content selection → Content UI
Content UI Ctrl+[ → global Side Panel handoff
Side Panel Ctrl+[ → Background direct window close
Neither UI + latest Content → Content restore
Neither UI + latest Panel → Side Panel restore
Panel open + new selection → Side Panel only, one provider request
Panel open + tab switch → latest session or empty component
Same URL reload → session restored
Hash-only change → session retained
Path/query navigation → old session deleted
Ctrl+number and Ctrl+Left/Right from Content and Panel
Tool shortcuts with neither UI → ignored
Two browser windows → isolated panel routing
Tab close → session/conversations/messages deleted
```

Document which Background, Content, and Side Panel consoles to capture. The automated safe-log tests must confirm logs show request/stage/IDs/outcome and contain none of the selected text, context, prompt, messages, reasoning, or provider credentials used during the run. Ask the user to provide those console logs if a manual scenario fails.

- [ ] **Step 6: Commit final cleanup and verification fixes**

```bash
git add src tests manifest.config.ts docs/superpowers/plans/2026-08-27-tab-ui-session-coordinator.md
git commit -m "refactor(ui): remove legacy panel ownership protocol"
```

- [ ] **Step 7: Perform final drift check**

Compare the final diff to `docs/superpowers/specs/2026-08-27-dianzhi-tab-ui-session-coordinator-design.md`. Confirm every touched file belongs to schema/session persistence, typed events, Background coordination, Content/Side Panel routing, tests, or plan tracking; generated `dist/` output remains uncommitted unless repository policy explicitly requires it.
