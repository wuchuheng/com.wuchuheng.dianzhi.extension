# 点知 Dianzhi — Native Side Panel Conversation Manager (Design)

**Date:** 2026-08-17  
**Status:** Approved  
**Base:** `feat/popover-fixes`

This design supersedes only the injected `.dz-side` sidebar in `2026-08-16-dianzhi-popover-fixes-design.md`. The active-tab and selection-arrow fixes remain valid.

## 1. Goal and UX

Replace the simulated webpage sidebar with Chrome's native, tab-specific Side Panel. The popover and Side Panel are two views of the same current selection conversation.

- Accept a trimmed selection of up to 300 characters when it contains at least two Unicode letters, at least 80% of which are Latin. Context may contain any language.
- A new selection starts a new current conversation in that tab with the configured default tool.
- The Side Panel has no “new chat” button and no historical-conversation browser.
- Its header has the same enabled-tool tabs as the popover. Docking preserves the active tool; click or `Ctrl+←/→` switches it.
- The active tool shows its complete ordered message history and a composer for follow-ups.
- Each tool maintains an independent conversation for the same selection. Non-default tool conversations are created lazily.
- Clicking `⇥` opens the native panel. The popover closes only after the panel has loaded the requested conversation.
- While the panel is open, a new selection replaces its current selection directly; no popover appears.
- `Esc` in the panel closes it. The current conversation remains reopenable until another selection replaces it.

## 2. Components and ownership

### Content script

Captures selections/context and renders the anchored popover. It sends commands using conversation IDs and renders events from the worker. It no longer owns authoritative history.

### Background service worker

The sole broker among content scripts, Side Panel pages, provider requests, and the offscreen database. It resolves sender tab IDs, owns live provider runs/subscriptions, manages `chrome.sidePanel`, and records each tab's active conversation in `chrome.storage.session` for service-worker restart recovery.

### Offscreen database document

`src/offscreen/index.html` owns the single OPFS database connection. The worker creates it with reason `WORKERS`, guarded by `runtime.getContexts()` and one shared creation promise. It exposes named CRUD operations over correlated `chrome.runtime` request/response messages; callers never send arbitrary SQL.

### Side Panel page

`src/sidepanel/sidepanel.html` connects through a long-lived runtime port, loads the active conversation snapshot, subscribes to live events, renders tool tabs/history/reasoning/composer, and sends switch/follow-up/stop/close commands.

## 3. `web-sqlite-js@2.3.0`

- Pin and bundle 2.3.0 locally. MV3 forbids executable CDN imports.
- Preserve its public `openDB`, `exec`, `query`, `transaction`, `close`, migrations, and logging APIs.
- The published bundle creates database and OPFS helper workers from `blob:` URLs, which MV3 `worker-src` disallows. Build an extension-specific local artifact that externalizes both as packaged worker files. Do not hand-edit the 740 KB minified bundle.
- Verify the pinned npm integrity during the vendor build.
- Manifest extension CSP enables `'wasm-unsafe-eval'`; manifest COOP is `same-origin` and COEP is `require-corp` so `SharedArrayBuffer` is available.
- Initialization asserts `crossOriginIsolated`, `SharedArrayBuffer`, OPFS, and worker loading. Failure returns `DB_UNAVAILABLE`; there is no silent in-memory fallback.

## 4. Persistence model

SQLite is local and single-writer, so IDs use `INTEGER PRIMARY KEY AUTOINCREMENT`, not UUIDs. Dates are worker-generated UTC ISO-8601 strings. Foreign keys are enabled.

```sql
CREATE TABLE conversations (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  selection_key   INTEGER NOT NULL,
  tab_id           INTEGER NOT NULL,
  tool_id          TEXT NOT NULL,
  tool_name        TEXT NOT NULL,
  title            TEXT NOT NULL,
  selected_text    TEXT NOT NULL,
  context_text     TEXT NOT NULL,
  prompt_snapshot  TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE(selection_key, tool_id)
);

CREATE INDEX idx_conversations_tab_selection
  ON conversations(tab_id, selection_key);

CREATE TABLE messages (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id   INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sequence           INTEGER NOT NULL,
  role               TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content            TEXT NOT NULL DEFAULT '',
  reasoning_content  TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL CHECK(status IN ('pending', 'streaming', 'completed', 'error', 'stopped')),
  error_code          TEXT,
  error_message       TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  UNIQUE(conversation_id, sequence)
);

CREATE INDEX idx_messages_conversation_sequence
  ON messages(conversation_id, sequence);
```

`selection_key` is the ID of the default/root conversation and is shared by the other tool conversations for that selection. In the creation transaction, insert the root with temporary key `0`, read its integer ID, then update its key to that ID before commit. The single database writer prevents another committed key `0`. `tool_name` and `prompt_snapshot` are immutable snapshots. The UI maps stored `user`/`assistant` roles to “me”/“AI”.

Creating a new selection is one transaction: stop the old live run, delete the prior selection group for that tab (messages cascade), insert the default/root conversation and assign its ID as `selection_key`, then insert its first user message. That first message contains the filled tool prompt shown as “me”; `prompt_snapshot` preserves the same provider instruction independently of later settings edits.

## 5. Streaming and handoff

### Provider run

1. Persist a user message and empty assistant placeholder (`streaming`) transactionally.
2. Start the provider request in the worker.
3. Broadcast text/reasoning deltas immediately to all subscribers.
4. Buffer accumulated output and checkpoint SQLite at most every 250 ms or 1 KiB, rather than once per token.
5. On done/error/stop, flush authoritative content and terminal status before broadcasting the terminal event.

Follow-ups rebuild provider history from ordered messages plus the immutable prompt snapshot.

### Dock during streaming

1. Content sends `panel.open { conversationId }` from the dock user gesture.
2. Worker immediately calls `chrome.sidePanel.open({ tabId })` and records the handoff target.
3. Panel connects through the `dianzhi:sidepanel` port and sends `ready { tabId }`; the worker subscribes it before loading SQLite.
4. Worker sends the persisted snapshot followed by the current in-memory live snapshot.
5. Panel reconciles by message ID using authoritative content replacement, acknowledges rendering, and only then does content hide the popover. The provider request is not restarted.

### Tool switching

The worker updates `activeToolId`. It returns an existing `(selectionKey, toolId)` conversation or lazily creates it from the same selected text/context and current tool snapshot, then starts its initial request. Popover and panel receive the same active-tool event.

## 6. Event contract

Conversation messages use `{ type, requestId, payload }`; tab identity comes from Chrome sender metadata, never from a caller-supplied `tabId`. Database RPC uses `{ requestId, operation, args }`. Cross-context results use `{ success, data?, error? }`, and command results carry `{ accepted, snapshot }`. Errors contain stable `code`, readable `message`, and safe context.

Families: `conversation.create/sync/followup/ensureTool`, `conversation.toolChanged`, `stream.started/delta/reasoning/done/error/stopped`, `panel.open`, port `ready`, `panel.rendered`/`panel.handoffReady`, `panel.close`, and `database.request`/`database.ready` (`dianzhi:database-request` / `dianzhi:database-ready`).

The offscreen RPC validates payloads and deduplicates mutating request IDs. The worker derives tab identity from `sender.tab`, not caller data.

## 7. Failure behavior

- DB initialization failure keeps the popover visible and shows `DB_UNAVAILABLE` with safe error context; a dedicated recovery action is offered for `PROVIDER_NOT_CONFIGURED`.
- Panel open/readiness failure keeps the popover visible and returns `SIDE_PANEL_OPEN_FAILED` or `SIDE_PANEL_READY_TIMEOUT`.
- Provider failure finalizes the assistant row as `error`; no row remains permanently streaming.
- Offscreen loss recreates the document and retries one idempotent read. Mutations are not blindly replayed.
- Late events for a replaced conversation/message ID are dropped.

## 8. Chrome requirements

Manifest adds `offscreen` and `sidePanel` permissions, a `side_panel.default_path`, required CSP/COOP/COEP keys, and `minimum_chrome_version: "141"` because programmatic Side Panel close was introduced in Chrome 141. The offscreen document uses only `chrome.runtime`, as required by Chrome.

## 9. Verification

- Unit: English gate, schema CRUD/cascade/order, integer IDs, tool lazy-create, reducer state, event validation, stream reconciliation, error transitions.
- Integration: worker↔offscreen RPC, creation race, recreation, migration, vendor integrity, and CSP-safe packaged workers.
- Real Chrome: OPFS survives worker/offscreen restart; initial selection persists; tab pill follows click and shortcuts; native panel opens; streaming handoff has no gaps/duplicates; full history and follow-up work; `Esc` closes; new selection replaces the docked view; console/network are clean.
- Existing provider, reasoning, markdown, placement, and active-tab tests remain green.

## 10. Branch correction

Keep the placement solver, anchor arrow, and active-tab commits on `feat/popover-fixes`. Remove only the `.dz-side` injected-sidebar implementation and replace it with the native Side Panel and conversation manager described here.
