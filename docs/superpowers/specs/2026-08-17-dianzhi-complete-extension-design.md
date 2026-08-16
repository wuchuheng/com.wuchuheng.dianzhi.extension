# Dianzhi Complete Chrome Extension Design

**Date:** 2026-08-17
**Status:** Approved for planning
**Target:** React 19, TypeScript 5.8, Vite 7, CRXJS, Chrome Manifest V3

## 1. Goal

Replace the scaffold's WareFlow/demo behavior with the complete Dianzhi reading assistant. Selecting English text on a web page opens an anchored AI popover. Users can switch tools, inspect reasoning when enabled, continue a conversation, and hand the same live conversation to Chrome's native Side Panel. Conversations persist in OPFS SQLite.

This is a clean TypeScript implementation of the approved Dianzhi behavior. It reuses the target repository's React entry points, typed event factories, Shadow DOM content boundary, offscreen entry point, and quality gates. It does not copy the legacy repository's global-script architecture.

### Entry criteria

- The target repository builds as the existing MV3 scaffold.
- The existing Chrome contexts remain separate: content, background, offscreen, Side Panel, options, and popup.
- `web-sqlite-js` is pinned to version `2.3.0`.

### Exit criteria

- Every workflow in this document works in the unpacked extension.
- Unit, integration, lint, typecheck, format, production-build, and relevant Playwright gates pass.
- A real Chrome run proves selection, streaming, native-panel handoff, persistence, shortcuts, and two-tab isolation without CSP or console errors.

## 2. Product workflows

### 2.1 Selection lookup

1. On configured `mouseup` or `Alt+mouseup`, accept trimmed text only when it is 1–300 characters, contains at least one Latin letter, and Latin letters comprise at least 70% of all Unicode letters.
2. Assemble bounded surrounding context without mutating the host page. The selected range is represented as `<selected>…</selected>`.
3. Create the default tool's persistent conversation through the background worker.
4. Open a Shadow DOM popover anchored to the selection and stream the first assistant response.
5. Ignore invalid selections without opening UI or calling the provider.

If the native Side Panel is already open for that tab, a new valid selection replaces the tab's current selection group and updates the panel directly; the popover stays hidden.

### 2.2 Tool switching

The enabled tools appear in settings order as pill tabs. The active pill follows mouse clicks and configurable `Ctrl+←/→` shortcuts. Each tool owns an independent conversation for the same selection. The default tool is created immediately; other tool conversations are created lazily when first selected.

Built-ins are:

- `context` / 语境: concise contextual meaning and nuance.
- `synonyms` / 同义词: two to four context-appropriate replacements with phonetics and comparison.
- `translate` / 翻译: context-calibrated Chinese translation.

Users may rename or disable built-ins but cannot delete them. Users may create, reorder, disable, edit, and delete custom tools. Every prompt supports `{{selected}}` and `{{context}}`; substitutions are single-pass and non-recursive.

### 2.3 Popover modes

- The default card view shows the active tool's latest assistant response with lightweight safe Markdown.
- Chat view shows the active tool's full ordered message history and a composer. The configurable toggle shortcut defaults to `Ctrl+Enter`.
- Expand changes the floating panel width while retaining its anchor.
- `Esc` or click-away closes the floating view but does not delete persisted data.
- The popover has a visible arrow pointing to the selection. Placement defaults below, flips above when required, shifts horizontally inside viewport margins, and recalculates on scroll/resize.

### 2.4 Native Side Panel handoff

The dock button and configured shortcut open Chrome's tab-specific native Side Panel. They never create an injected webpage sidebar or ribbon.

1. Content sends `panel.open` during the user gesture, naming the active numeric conversation ID.
2. Background derives the tab ID from the sender and calls `chrome.sidePanel.open({ tabId })`.
3. The panel connects, identifies the active tab, subscribes, loads the persisted snapshot, then reconciles any newer in-memory streaming content by message ID.
4. The panel acknowledges its first render; only then does content hide the popover.
5. The provider request continues unchanged throughout handoff.

The panel header contains the same enabled-tool tabs and active state. It shows the current tool's full history, reasoning details, errors, streaming state, stop control, and follow-up composer. It has no new-chat button and no archive/history browser. `Ctrl+←/→` switches tools, Enter sends, Shift+Enter inserts a newline, `Ctrl+.` stops, and `Esc` closes the panel through `chrome.sidePanel.close()`.

## 3. Architecture and ownership

### 3.1 Content script

- Owns selection detection, context extraction, anchor geometry, and the Shadow DOM React mount.
- Renders authoritative snapshots/events received from background.
- Sends typed commands; it does not own provider history, database state, or tab identity.
- Keeps host-page styles isolated and never mutates selected page content.

### 3.2 Background service worker

- Is the sole broker between content, Side Panel, provider, settings, and offscreen storage.
- Derives tab identity from Chrome sender metadata, never untrusted payload fields.
- Owns live provider runs, abort controllers, stream accumulation, subscribers, panel handoff, and per-tab active selection/tool state.
- Persists restart-recovery metadata in `chrome.storage.session` without duplicating message history there.
- Uses the repository's typed event factories for cross-context messages.

### 3.3 Offscreen document

- Owns one OPFS SQLite connection and all SQL.
- Is created through a single-flight background lifecycle using reason `WORKERS`.
- Exposes only typed named database operations over correlated request/response events; callers never provide arbitrary SQL.
- Deduplicates mutating request IDs and retries only idempotent reads after document loss.
- Returns `DB_UNAVAILABLE` if isolation, OPFS, WASM, workers, or initialization fail. There is no in-memory fallback.

### 3.4 Side Panel

- Is a React extension page and a subscriber to background-managed conversations.
- Reconciles database snapshots and live updates by numeric message ID using authoritative content replacement.
- Holds rendering and draft-input state only.

### 3.5 Options and popup

Options is the durable settings surface. Popup is a compact product/status entry point with a settings action; it does not duplicate configuration forms.

## 4. Provider and settings

Settings live in `chrome.storage.sync` and are merged with versioned defaults on every load.

Provider fields:

- OpenAI-compatible `baseUrl`, `apiKey`, `model`, and temperature from 0–2.
- `reasoningEnabled` and effort `low | medium | high`.
- Thinking parameter mode: default sends `reasoning_effort` only while reasoning is on; `enable_thinking` sends the boolean on/off and omits `reasoning_effort`.
- `extraBody` is the single raw JSON escape hatch and merges last.

Options has AI 服务, 工具, and 快捷键 sections, Save status, API-key visibility, connection test with streaming transcript, tool prompt preview/test, validation errors, and reset-to-default behavior where applicable. Empty API key is a warning while invalid URL, model, temperature, shortcut, tool, or JSON is a blocking error.

The provider adapter builds `/chat/completions`, preserves the immutable filled prompt snapshot, sends ordered history, parses SSE fragments across chunk boundaries, supports `delta.content` and `delta.reasoning_content`, reports HTTP bodies safely, and aborts through `AbortController`.

## 5. Persistence model

SQLite is local and single-writer. Record IDs use `INTEGER PRIMARY KEY AUTOINCREMENT`, not UUIDs. Timestamps are offscreen-generated UTC ISO-8601 strings and foreign keys are enabled.

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

`selection_key` is the default/root conversation ID shared by every tool conversation for that selection. Root creation inserts temporary key `0`, obtains the integer ID, updates the key, and inserts the first user message in one transaction. A new selection stops the old run, deletes the previous group for that tab with cascade, and creates the replacement group transactionally.

Tool name and filled prompt are immutable snapshots. A provider run persists its user message and empty streaming assistant row before fetch. Stream content is broadcast immediately and checkpointed serially to SQLite at most every 250 ms or 1 KiB. Terminal content/status is flushed before broadcasting done, error, or stopped.

## 6. Typed event contract

Cross-context commands use the established `src/events/` factories and typed payload/result definitions. Untrusted runtime inputs are validated at receiving boundaries.

Event families:

- `conversation.create`, `conversation.sync`, `conversation.followup`, `conversation.ensureTool`, `conversation.toolChanged`.
- `stream.started`, `stream.delta`, `stream.reasoning`, `stream.done`, `stream.error`, `stream.stopped`, `stream.stop`.
- `panel.open`, `panel.ready`, `panel.rendered`, `panel.handoffReady`, `panel.close`.
- `database.request`, `database.response`, `database.ready`, `database.error`.
- `settings.get`, `settings.save`, `settings.testProvider`.

Every request carries a correlation ID. Structured failures contain a stable code, readable message, and safe context. Required codes include `INVALID_EVENT`, `INVALID_SELECTION`, `SETTINGS_INVALID`, `PROVIDER_NOT_CONFIGURED`, `PROVIDER_HTTP_ERROR`, `PROVIDER_STREAM_ERROR`, `CONVERSATION_NOT_FOUND`, `DB_UNAVAILABLE`, `SIDE_PANEL_OPEN_FAILED`, and `SIDE_PANEL_READY_TIMEOUT`.

## 7. CSP and `web-sqlite-js@2.3.0`

The dependency is pinned exactly to `2.3.0`; executable CDN imports are forbidden. The published distribution creates its SQLite worker and nested OPFS proxy through Blob URLs, which MV3 extension CSP cannot allow. A deterministic build script verifies the pinned upstream artifact and externalizes both workers as packaged local assets. Generated output is not hand-edited.

The manifest includes only required permissions (`storage`, `offscreen`, `sidePanel` plus content access), a native `side_panel`, minimum Chrome 141, extension CSP with `'wasm-unsafe-eval'` and `worker-src 'self'`, COOP `same-origin`, and COEP `require-corp`. Unnecessary `tabs` or `contentSettings` permissions are removed unless concrete implementation evidence requires them.

## 8. UI system

The visual language is compact, calm, and macOS-inspired without copying OS metrics. Shared tokens cover color, radius, border, shadow, spacing, typography, focus, error, and streaming states. React components share message, tab, Markdown, reasoning, status, and composer primitives between popover, Side Panel, and options test chats.

Accessibility requirements:

- Tool tabs use tablist/tab/tabpanel semantics and `aria-selected`.
- Icon-only actions have labels and tooltips.
- All controls are keyboard reachable with visible focus.
- Streaming and save/test feedback use appropriate live regions without announcing every token.
- Motion respects `prefers-reduced-motion`.

## 9. Failure behavior

- Missing provider configuration keeps the UI visible with an action that opens Options.
- Database failures keep the current view visible with recovery guidance.
- Panel open/readiness failures leave the popover open.
- Provider failures persist an assistant error row; aborted runs preserve partial content with stopped status.
- Late events for replaced conversation/message IDs are discarded.
- Invalid `extraBody` blocks saving and sending.
- Errors and meaningful lifecycle actions use the repository logger; production code does not use `console.log`.

## 10. Testing and verification

### Automated

- Unit: settings merge/validation, template substitution, English gate, context offsets/trimming, placement, Markdown, SSE, request bodies, reducers, message reconciliation, schema CRUD/order/cascade/transitions, and stable errors.
- Integration: content-to-background commands, offscreen single-flight/RPC, migration, provider streaming/checkpoints, midstream panel handoff, tool lazy creation, follow-up history, stop/error, restart recovery, and two-tab state isolation.
- Build contracts: exact SQLite version/integrity, packaged local workers, no Blob/data/remote executable worker, deterministic regeneration, and generated manifest CSP/permissions.
- Playwright/Chrome: real extension-context selection, popover placement/tab state, options persistence, native panel handoff, continued streaming, OPFS persistence, shortcuts, replacement selection, and clean consoles/network.

### Required gates

```bash
pnpm run format:check
pnpm run lint
pnpm run test -- --run
pnpm run build
pnpm run test:e2e
```

Real-Chrome evidence is required because unit tests cannot prove native Side Panel APIs, offscreen lifetime, OPFS worker behavior, Shadow DOM placement, or CSP execution.

## 11. Non-goals

- No user accounts, cloud synchronization, billing, analytics, telemetry, dictionary fallback, or general conversation archive.
- No injected webpage sidebar or dock ribbon.
- No Side Panel new-chat button.
- No arbitrary SQL across extension messages.
- No remote executable code or silent in-memory database fallback.
- No unrelated redesign of the scaffold's event framework or development tooling.
