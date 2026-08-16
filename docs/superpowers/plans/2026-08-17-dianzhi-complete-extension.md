# Dianzhi Complete Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the demo scaffold with the complete Dianzhi contextual-reading extension, including persistent AI conversations and Chrome's native Side Panel.

**Architecture:** React views remain isolated in their Chrome contexts while typed domain modules are shared. The background service worker owns provider runs and tab state; one offscreen document owns OPFS SQLite; content and Side Panel are synchronized subscribers to background-managed conversations.

**Tech Stack:** React 19, TypeScript 5.8 strict mode, Vite 7, CRXJS, Chrome MV3, Vitest/jsdom, Playwright, `web-sqlite-js@2.3.0`, OPFS SQLite.

## Global Constraints

- Work only in `/home/wuchuheng/myProjects/com.wuchuheng.dianzhi/com.wuchuheng.dianzhi.extension` on `main`.
- Replace WareFlow/demo product behavior; preserve the existing React entry points, Shadow DOM boundary, and typed event framework.
- Pin `web-sqlite-js` exactly to `2.3.0`; do not import executable CDN code.
- Chrome minimum version is `141`; use the native tab-specific Side Panel, never an injected webpage sidebar or ribbon.
- The Side Panel has no new-chat button and no archive/history browser.
- SQLite record IDs are `INTEGER PRIMARY KEY AUTOINCREMENT`, not UUIDs.
- Offscreen is the only SQL owner; callers use typed named operations and never send arbitrary SQL.
- Background derives tab identity from `chrome.runtime.MessageSender`, never payload data.
- Stream deltas broadcast immediately; SQLite checkpoints serialize at 250 ms or 1 KiB and terminal state flushes before terminal broadcast.
- Preserve per-tool independent conversations, active-tool synchronization, reasoning display, and midstream popover-to-panel handoff without restart or gaps.
- Production code uses `src/events/logger.ts`, not direct `console.log` calls.
- Use red-green-refactor for production behavior and run format, lint, tests, build, and real-Chrome verification before completion.

---

## File map

- `src/dianzhi/domain/`: settings, tools, errors, conversation types, validation, template substitution.
- `src/dianzhi/provider/`: OpenAI-compatible request builder and SSE parser.
- `src/dianzhi/conversation/`: reducers, live-message reconciliation, background orchestration types.
- `src/dianzhi/ui/`: shared tabs, message list, Markdown, reasoning, composer, and status components.
- `src/events/config.ts`: typed application event declarations.
- `src/background/`: offscreen lifecycle, provider runs, tab/session state, Side Panel handoff.
- `src/offscreen/`: database schema, store, and named RPC dispatch.
- `src/content/`: selection/context logic, placement, Shadow DOM popover view.
- `src/sidepanel/`: current-selection full-history UI.
- `src/options/`: provider, tools, shortcuts, and test-chat settings UI.
- `src/popup/`: compact status and settings entry.
- `scripts/vendor-web-sqlite.mts`: deterministic MV3-safe vendor transformer.
- `tests/integration/` and `tests/e2e/`: cross-context and real-browser proof.

---

### Task 1: Establish typed Dianzhi domain, presets, and settings

**Files:**

- Create: `src/dianzhi/domain/types.ts`
- Create: `src/dianzhi/domain/errors.ts`
- Create: `src/dianzhi/domain/presets.ts`
- Create: `src/dianzhi/domain/settings.ts`
- Create: `src/dianzhi/domain/template.ts`
- Create: `tests/unit/domain/settings.spec.ts`
- Create: `tests/unit/domain/template.spec.ts`
- Modify: `package.json`

**Interfaces:**

- Produces `DianzhiSettings`, `ToolDefinition`, `ProviderSettings`, `ShortcutSettings`, `DEFAULT_SETTINGS`, `mergeSettings(raw: unknown): DianzhiSettings`, `validateSettings(settings: DianzhiSettings): SettingsValidation`, `effectivePrompt(tool: ToolDefinition): string`, and `fillTemplate(prompt: string, values: TemplateValues): string`.
- Produces `DianzhiErrorCode`, `DianzhiErrorShape`, and `DianzhiError` with `toJSON()`.

- [x] **Step 1: Normalize package scripts and exact dependency**

Pin `web-sqlite-js` to `"2.3.0"`, add `jsdom` as a development dependency for the configured Vitest environment, and make unit tests terminate in CI:

```json
"test": "vitest --run",
"test:watch": "vitest",
"quality": "pnpm run format:check && pnpm run lint && pnpm run test && pnpm run build"
```

- [x] **Step 2: Write failing settings and template tests**

Cover versioned defaults, deep object merge, array replacement, URL/model/temperature/JSON validation, duplicate IDs, built-in deletion protection, enabled default fallback, shortcut grammar, custom prompt validation, single-pass substitution, missing values, and template-looking input.

```ts
expect(
  fillTemplate('{{selected}} / {{context}}', {
    selected: '{{context}}',
    context: '<selected>word</selected>',
  })
).toBe('{{context}} / <selected>word</selected>')
expect(validateSettings(mergeSettings({ provider: { thinkingParam: 'bad' } })).ok).toBe(false)
```

- [x] **Step 3: Run the red tests**

Run: `pnpm vitest --run tests/unit/domain/settings.spec.ts tests/unit/domain/template.spec.ts`
Expected: FAIL because the domain modules do not exist.

- [x] **Step 4: Implement the domain**

Use discriminated string unions instead of loose strings. Defaults must include the three enabled built-ins, DeepSeek-compatible provider defaults, the four page-level shortcuts, context target/max/block limits, reasoning settings, and `extraBody`.

Each built-in preset must include both variables and these explicit output constraints:

```ts
export const BUILTIN_PROMPTS = {
  context: `Explain {{selected}} as used in {{context}}. Answer in Chinese in exactly two short paragraphs, under 150 Chinese characters, and bold the core meaning and referent.`,
  synonyms: `Using {{context}}, give 2-4 replaceable synonyms for {{selected}}. Use lemma titles, UK and US phonetics, collocations with Chinese translations, examples, and a concise nuance comparison.`,
  translate: `Translate only {{selected}} into Chinese using {{context}} for disambiguation. Return a precise translation and a short context-calibration explanation with bold anchors.`,
} as const
```

- [x] **Step 5: Run tests, format, and commit**

Run: `pnpm vitest --run tests/unit/domain/settings.spec.ts tests/unit/domain/template.spec.ts && pnpm run typecheck && pnpm run format:check`

```bash
git add package.json pnpm-lock.yaml src/dianzhi/domain tests/unit/domain
git commit -m "feat(domain): define Dianzhi tools and settings"
```

---

### Task 2: Add sender-aware typed application events

**Files:**

- Modify: `src/events/types.ts`
- Modify: `src/events/internal/message-listener.ts`
- Modify: `src/events/internal/messaging.ts`
- Modify: `src/events/internal/factories.ts`
- Modify: `src/events/contentScript/contentScript.ts`
- Modify: `src/events/extensionPage/extensionPage.ts`
- Modify: `src/events/config.ts`
- Create: `src/dianzhi/domain/protocol.ts`
- Create: `tests/unit/events/sender-aware.spec.ts`
- Create: `tests/unit/domain/protocol.spec.ts`

**Interfaces:**

- Produces `SenderAwareCallback<Args, Return> = (args: Args, sender: chrome.runtime.MessageSender) => Promise<Return>`.
- Extends one-to-one message events with `handleWithSender(callback)` while preserving existing `.handle(callback)` behavior.
- Produces typed commands/snapshots/events for conversation, stream, panel, database, and settings families.

- [x] **Step 1: Write failing sender and protocol tests**

Verify `.handleWithSender` receives the exact sender object, regular `.handle` remains source-compatible, invalid runtime payloads return `INVALID_EVENT`, and numeric IDs reject strings/UUIDs.

```ts
const sender = { tab: { id: 17 } } as chrome.runtime.MessageSender
listener({ event: 'cs2bg:test', args: { value: 1 } }, sender, sendResponse)
await expect(seenSender).resolves.toBe(sender)
expect(parseConversationCommand({ type: 'sync', conversationId: '17' })).toEqual({
  ok: false,
  error: expect.objectContaining({ code: 'INVALID_EVENT' }),
})
```

- [x] **Step 2: Run the red tests**

Run: `pnpm vitest --run tests/unit/events/sender-aware.spec.ts tests/unit/domain/protocol.spec.ts`
Expected: FAIL on missing API and protocol module.

- [x] **Step 3: Extend the event factory without bypassing it**

Add the sender-aware handler to message-backed events only. Keep sender filters and standardized response conversion. Do not add raw application-level `chrome.runtime.onMessage` listeners.

- [x] **Step 4: Define application events in `src/events/config.ts`**

Declare separate content-to-background and extension-page-to-background commands plus background-to-content/background-to-extension-page update events. Long-lived stream subscribers use named ports `dianzhi:content` and `dianzhi:sidepanel`; port envelopes use the same protocol parsers.

- [x] **Step 5: Run gates and commit**

Run: `pnpm vitest --run tests/unit/events tests/unit/domain/protocol.spec.ts && pnpm run typecheck && pnpm run lint`

```bash
git add src/events src/dianzhi/domain/protocol.ts tests/unit/events tests/unit/domain/protocol.spec.ts
git commit -m "feat(events): add sender-aware Dianzhi protocol"
```

---

### Task 3: Produce CSP-safe `web-sqlite-js@2.3.0` assets and manifest

**Files:**

- Create: `scripts/vendor-web-sqlite.mts`
- Create: `src/vendor/web-sqlite/index.js` (generated)
- Create: `src/vendor/web-sqlite/index.d.ts`
- Create: `src/vendor/web-sqlite/web-sqlite-worker.js` (generated)
- Create: `src/vendor/web-sqlite/web-sqlite-opfs-proxy.js` (generated)
- Create: `tests/unit/vendor/web-sqlite.spec.ts`
- Modify: `package.json`
- Modify: `manifest.config.ts`
- Modify: `vite.config.ts`

**Interfaces:**

- Produces a local default `openDB` export, its strict TypeScript declaration, and two packaged worker assets.
- Adds `vendor:sqlite` before build and a deterministic contract test.

- [ ] **Step 1: Write the failing vendor contract test**

Assert exact package version, upstream `dist/index.js` SHA-256 `97ab499174918ff700f17213c9493ad325af6c0cc7bf29c6eb1eae04789c4784`, all three assets, local worker URLs, and no `createObjectURL(new Blob`, `data:text/javascript`, or executable HTTP import in any emitted asset.

- [ ] **Step 2: Run the red test**

Run: `pnpm vitest --run tests/unit/vendor/web-sqlite.spec.ts`
Expected: FAIL because local vendor assets are missing.

- [ ] **Step 3: Implement deterministic extraction**

Read only `node_modules/web-sqlite-js/dist/index.js` after hash verification. Parse JavaScript string literals without evaluating arbitrary package code, decode only the isolated validated string literal, extract the outer SQLite worker and nested OPFS proxy, replace each Blob factory exactly once with a local `new URL(...)`, and fail if counts or forbidden patterns differ.

Declare only the library surface consumed by the store:

```ts
export type SqliteBindValue = string | number | bigint | null | Uint8Array
export interface WebSqliteDatabase {
  exec(
    sql: string,
    bind?: readonly SqliteBindValue[]
  ): Promise<{ changes: number; lastInsertRowid: number }>
  query<Row extends Record<string, unknown>>(
    sql: string,
    bind?: readonly SqliteBindValue[]
  ): Promise<Row[]>
  transaction<T>(work: () => Promise<T>): Promise<T>
  close(): Promise<void>
}
export interface OpenDatabaseOptions {
  debug?: boolean
  releases: readonly { version: string; migrationSQL: string }[]
}
export default function openDB(
  name: string,
  options: OpenDatabaseOptions
): Promise<WebSqliteDatabase>
```

- [ ] **Step 4: Set the manifest contract**

Use:

```ts
minimum_chrome_version: '141',
permissions: ['storage', 'offscreen', 'sidePanel'],
side_panel: { default_path: 'src/sidepanel/index.html' },
content_security_policy: {
  extension_pages: "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; object-src 'self';",
},
cross_origin_opener_policy: { value: 'same-origin' },
cross_origin_embedder_policy: { value: 'require-corp' },
```

Keep HTTPS content-script matches and remove `contentSettings` and `tabs` unless a later real-Chrome failure proves a permission is required.

- [ ] **Step 5: Generate twice, test, build, and commit**

Run: `pnpm run vendor:sqlite && pnpm vitest --run tests/unit/vendor/web-sqlite.spec.ts && pnpm run vendor:sqlite && git diff --exit-code src/vendor/web-sqlite && pnpm run build`

```bash
git add package.json pnpm-lock.yaml manifest.config.ts vite.config.ts scripts/vendor-web-sqlite.mts src/vendor/web-sqlite tests/unit/vendor
git commit -m "build(sqlite): package CSP-safe OPFS workers"
```

---

### Task 4: Implement the offscreen SQLite store and named RPC

**Files:**

- Create: `src/offscreen/database/schema.ts`
- Create: `src/offscreen/database/store.ts`
- Create: `src/offscreen/database/rpc.ts`
- Rewrite: `src/offscreen/main.ts`
- Create: `tests/unit/offscreen/store.spec.ts`
- Create: `tests/unit/offscreen/rpc.spec.ts`

**Interfaces:**

- Produces `createConversationStore(db, clock)` with `createSelection`, `ensureToolConversation`, `getConversation`, `appendAssistant`, `appendTurn`, `checkpointAssistant`, `finalizeAssistant`, and `deleteSelection`.
- Produces named `DatabaseOperation` request/result mappings; numeric `conversationId`, `messageId`, and `selectionKey` are returned from SQLite.

- [ ] **Step 1: Write a recording fake database and failing CRUD tests**

Assert schema release `1.0.0`, foreign keys, exact two-table schema, parameterized SQL, transaction boundaries, root-key update, message sequencing, lazy-tool uniqueness, cascade deletion, immutable snapshots, and legal status transitions.

```ts
const created = await store.createSelection({
  tabId: 7,
  tool: contextTool,
  selectedText: 'learning',
  contextText: '<selected>learning</selected>',
  promptSnapshot: 'filled prompt',
})
expect(created.conversation).toMatchObject({ id: 41, selectionKey: 41, toolId: 'context' })
```

- [ ] **Step 2: Run red store tests**

Run: `pnpm vitest --run tests/unit/offscreen/store.spec.ts tests/unit/offscreen/rpc.spec.ts`
Expected: FAIL because store/RPC modules are missing.

- [ ] **Step 3: Implement schema and store**

Use the exact SQL from the design. Root selection creation and first user message are one transaction. `appendTurn` inserts the user/completed row and assistant/streaming placeholder atomically. Checkpoint updates require the current status to be `streaming`; finalization permits only `completed | error | stopped`.

- [ ] **Step 4: Implement offscreen initialization and RPC**

Import local vendor `openDB`, assert `crossOriginIsolated`, `SharedArrayBuffer`, `navigator.storage.getDirectory`, and worker startup, then open `dianzhi.sqlite3`. Dispatch only named operations, correlate responses, and cache successful mutation results by request ID for the offscreen document lifetime.

- [ ] **Step 5: Run tests/build and commit**

Run: `pnpm vitest --run tests/unit/offscreen && pnpm run typecheck && pnpm run build`

```bash
git add src/offscreen tests/unit/offscreen
git commit -m "feat(database): persist Dianzhi conversations in OPFS"
```

---

### Task 5: Implement the OpenAI-compatible streaming provider

**Files:**

- Create: `src/dianzhi/provider/request.ts`
- Create: `src/dianzhi/provider/sse.ts`
- Create: `src/dianzhi/provider/client.ts`
- Create: `tests/unit/provider/request.spec.ts`
- Create: `tests/unit/provider/sse.spec.ts`
- Create: `tests/unit/provider/client.spec.ts`

**Interfaces:**

- Produces `buildChatCompletionsUrl(baseUrl: string): string`, `buildRequestBody(input: ProviderRequestInput): Record<string, unknown>`, `createSseParser(handlers): SseParser`, and `streamChat(input, dependencies): Promise<void>`.
- Emits normalized `{ kind: 'content' | 'reasoning', delta: string }` and terminal callbacks.

- [ ] **Step 1: Write failing request/SSE/client tests**

Cover URL joining, ordered messages, temperature, reasoning default, `enable_thinking` true/false behavior, `extraBody` precedence, chunk-split lines, multiple events per chunk, `[DONE]`, reasoning-only deltas, final unterminated line, non-200 body, malformed provider error objects, network failure, and abort.

- [ ] **Step 2: Run red provider tests**

Run: `pnpm vitest --run tests/unit/provider`
Expected: FAIL because provider modules are missing.

- [ ] **Step 3: Implement pure builder and incremental parser**

When `thinkingParam === 'enable_thinking'`, always send `enable_thinking: reasoningEnabled` and omit `reasoning_effort`. Otherwise send `reasoning_effort` only when reasoning is enabled. Merge parsed `extraBody` last.

- [ ] **Step 4: Implement streaming client**

Use injected `fetch`, `AbortSignal`, and callbacks. Parse HTTP response text safely on failure. Do not log secrets or full Authorization headers.

- [ ] **Step 5: Run gates and commit**

Run: `pnpm vitest --run tests/unit/provider && pnpm run typecheck && pnpm run lint`

```bash
git add src/dianzhi/provider tests/unit/provider
git commit -m "feat(provider): stream OpenAI-compatible responses"
```

---

### Task 6: Implement offscreen lifecycle and background conversation authority

**Files:**

- Rewrite: `src/background/setUpOffscreen.ts`
- Create: `src/background/offscreen-client.ts`
- Create: `src/background/conversation-manager.ts`
- Create: `src/background/provider-runner.ts`
- Rewrite: `src/background/index.ts`
- Create: `tests/unit/background/offscreen-client.spec.ts`
- Create: `tests/unit/background/conversation-manager.spec.ts`
- Create: `tests/unit/background/provider-runner.spec.ts`

**Interfaces:**

- Produces `createOffscreenClient(chromeApi, timers)` with `ensureDocument()` and typed `request(operation, args, options)`.
- Produces `createConversationManager(dependencies)` with sender-aware command handlers, `connect(port)`, `disconnect(port)`, and `getLiveSnapshot(conversationId)`.

- [ ] **Step 1: Write failing lifecycle and manager tests**

Prove concurrent DB requests create one offscreen document, existing context reuse, out-of-order correlation, timeout mapping, one retry for idempotent reads, no mutation replay, sender-derived tab ID, old-run abort before replacement, lazy tool creation, exact provider history, immediate deltas, serialized checkpoint thresholds, terminal flush ordering, subscriptions, restart state, panel render acknowledgement, and late-event rejection.

- [ ] **Step 2: Run red background tests**

Run: `pnpm vitest --run tests/unit/background`
Expected: FAIL because the new clients/managers are missing.

- [ ] **Step 3: Implement single-flight offscreen lifecycle**

Use `chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'], documentUrls: [chrome.runtime.getURL('src/offscreen/index.html')] })` and one shared creation promise cleared in `finally`. Use reason `WORKERS` with a database-specific justification.

- [ ] **Step 4: Implement conversation and provider state machines**

Use maps keyed by numeric IDs for live runs/subscribers and a per-tab record `{ selectionKey, activeToolId, activeConversationId, panelOpen }`. Persist only that record to `chrome.storage.session`. Serialize checkpoints so an older write cannot overwrite newer accumulated content.

- [ ] **Step 5: Implement panel lifecycle**

Open from the content user gesture, validate the panel's active-tab claim against a pending handoff, subscribe before database load, send persisted plus live snapshots, and emit handoff-ready only after panel-rendered. Close with `chrome.sidePanel.close({ tabId })`.

- [ ] **Step 6: Wire background entry and run gates**

Remove demo test handlers and eager retry logging. Initialize relay, typed commands, ports, session recovery, and meaningful structured logs.

Run: `pnpm vitest --run tests/unit/background && pnpm run typecheck && pnpm run lint`

- [ ] **Step 7: Commit**

```bash
git add src/background tests/unit/background
git commit -m "feat(background): manage persistent AI conversations"
```

---

### Task 7: Implement selection context and anchored placement

**Files:**

- Create: `src/content/selection/english.ts`
- Create: `src/content/selection/context.ts`
- Create: `src/content/selection/controller.ts`
- Create: `src/content/popover/placement.ts`
- Create: `tests/unit/content/english.spec.ts`
- Create: `tests/unit/content/context.spec.ts`
- Create: `tests/unit/content/placement.spec.ts`

**Interfaces:**

- Produces `isEnglishSelection(text: string): boolean`, `assembleSelectionContext(selection: Selection, limits): SelectionContext | null`, and `computePlacement(rect, panel, viewport): Placement`.
- Produces a controller that emits valid `SelectionContext` plus anchor rect and respects `mouseup | alt-mouseup`.

- [ ] **Step 1: Write failing pure and jsdom tests**

Cover empty/over-300/punctuation/mixed-script thresholds, nested text offsets, block discovery, alternating neighbors, word/block caps, symmetric trim, no DOM mutation, below/above choice, horizontal clamp, arrow clamp, degenerate rect, wide mode, scroll/resize recomputation, and selection inside the extension host being ignored.

- [ ] **Step 2: Run red selection tests**

Run: `pnpm vitest --run tests/unit/content`
Expected: FAIL because selection modules are missing.

- [ ] **Step 3: Implement English gate and context extraction**

Count Unicode letters with `\p{L}` and Latin letters with `\p{Script=Latin}`. Walk text nodes with `TreeWalker`; never wrap or edit host-page nodes.

- [ ] **Step 4: Implement placement**

Default below with 8 px viewport margin and 6 px arrow gap. Prefer above if below overflows; if neither fits, choose more space and clamp. Arrow center follows selection center but stays at least 24 px from panel corners.

- [ ] **Step 5: Run gates and commit**

Run: `pnpm vitest --run tests/unit/content && pnpm run typecheck && pnpm run lint`

```bash
git add src/content/selection src/content/popover tests/unit/content
git commit -m "feat(content): capture and anchor English selections"
```

---

### Task 8: Build shared conversation UI and the content popover

**Files:**

- Create: `src/dianzhi/conversation/reducer.ts`
- Create: `src/dianzhi/ui/ToolTabs.tsx`
- Create: `src/dianzhi/ui/Markdown.tsx`
- Create: `src/dianzhi/ui/Reasoning.tsx`
- Create: `src/dianzhi/ui/MessageList.tsx`
- Create: `src/dianzhi/ui/Composer.tsx`
- Create: `src/dianzhi/ui/ConversationStatus.tsx`
- Rewrite: `src/content/views/App.tsx`
- Rewrite: `src/content/views/App.css`
- Rewrite: `src/content/main.tsx`
- Modify: `src/content/index.css`
- Create: `tests/unit/conversation/reducer.spec.ts`
- Create: `tests/unit/ui/tool-tabs.spec.tsx`
- Create: `tests/unit/ui/markdown.spec.tsx`
- Create: `tests/unit/content/popover.spec.tsx`

**Interfaces:**

- Produces `reduceConversationView(state, event)`, `reconcileMessage(current, incoming)`, shared controlled UI components, and the Shadow DOM `ContentApp`.
- Consumes authoritative snapshots and stream updates keyed by numeric conversation/message IDs.

- [ ] **Step 1: Write failing reducer and component tests**

Assert snapshot replacement, message upsert/deduplication, stale ID rejection, active pill updates, keyboard cycling, safe Markdown escaping, reasoning collapse/gating, card/chat modes, expand, stop/retry, no-provider settings action, new selection while panel open, and popover hide only after handoff-ready.

- [ ] **Step 2: Run red UI tests**

Run: `pnpm vitest --run tests/unit/conversation tests/unit/ui tests/unit/content/popover.spec.tsx`
Expected: FAIL because shared UI/reducer modules are missing.

- [ ] **Step 3: Implement shared controlled components**

Components receive state and callbacks; they do not call Chrome APIs. Markdown supports escaped paragraphs, bold, inline code, headings, lists, and blockquotes only. Use tablist semantics, visible focus, labelled icon buttons, polite terminal status, and reduced-motion CSS.

- [ ] **Step 4: Replace demo content mount**

Maintain one `#dianzhi-root` Shadow DOM host. Subscribe to selection controller and background port, dispatch conversation commands, render arrow geometry, reposition on scroll/resize, close on outside pointer/Esc, and keep popover hidden while validated panel state is open.

- [ ] **Step 5: Run gates and commit**

Run: `pnpm vitest --run tests/unit/conversation tests/unit/ui tests/unit/content && pnpm run typecheck && pnpm run lint`

```bash
git add src/dianzhi/conversation src/dianzhi/ui src/content tests/unit/conversation tests/unit/ui tests/unit/content
git commit -m "feat(popover): add anchored Dianzhi conversation UI"
```

---

### Task 9: Build the native Side Panel full-history chat

**Files:**

- Rewrite: `src/sidepanel/App.tsx`
- Rewrite: `src/sidepanel/App.css`
- Rewrite: `src/sidepanel/index.css`
- Modify: `src/sidepanel/main.tsx`
- Create: `src/sidepanel/panel-state.ts`
- Create: `tests/unit/sidepanel/panel-state.spec.ts`
- Create: `tests/unit/sidepanel/app.spec.tsx`

**Interfaces:**

- Produces `reducePanelState`, `cycleEnabledTool`, and a panel that announces ready/rendered with validated active tab identity.
- Reuses shared tabs, history, reasoning, composer, and status components.

- [ ] **Step 1: Write failing Side Panel tests**

Cover initial sync, persisted/live reconciliation, active tool/history, click and `Ctrl+←/→`, Enter/Shift+Enter, `Ctrl+.`, `Esc`, streaming/error/stopped states, disconnect behavior, and the absence of new-chat/archive controls.

- [ ] **Step 2: Run red Side Panel tests**

Run: `pnpm vitest --run tests/unit/sidepanel`
Expected: FAIL because panel state and product UI are missing.

- [ ] **Step 3: Implement panel state and UI**

Query `{ active: true, currentWindow: true }` for the candidate tab ID, let background validate it, announce ready, render the synchronized current selection, then acknowledge rendered. Keep drafts local per active tool but all messages authoritative from background.

- [ ] **Step 4: Run gates and commit**

Run: `pnpm vitest --run tests/unit/sidepanel && pnpm run typecheck && pnpm run lint && pnpm run build`

```bash
git add src/sidepanel tests/unit/sidepanel
git commit -m "feat(sidepanel): add native full-history chat"
```

---

### Task 10: Build Options and Popup product surfaces

**Files:**

- Rewrite: `src/options/App.tsx`
- Rewrite: `src/options/App.css`
- Rewrite: `src/options/index.css`
- Create: `src/options/settings-form.ts`
- Rewrite: `src/popup/App.tsx`
- Rewrite: `src/popup/App.css`
- Rewrite: `src/popup/index.css`
- Create: `tests/unit/options/settings-form.spec.ts`
- Create: `tests/unit/options/app.spec.tsx`
- Create: `tests/unit/popup/app.spec.tsx`

**Interfaces:**

- Options loads/saves versioned `DianzhiSettings`, tests provider/tool prompts through background, and blocks invalid saves.
- Popup reports configured/unconfigured state and opens Options.

- [ ] **Step 1: Write failing options/popup tests**

Cover three navigation sections, initial merge, provider fields, API-key reveal, temperature output, reasoning/thinking dependencies, `extraBody`, Save validation/status, provider test stream, built-in rename/enable/no-delete, custom create/reorder/delete, prompt mode/preview/test, shortcut capture, configured popup status, and open-options action.

- [ ] **Step 2: Run red tests**

Run: `pnpm vitest --run tests/unit/options tests/unit/popup`
Expected: FAIL because scaffold views do not implement Dianzhi.

- [ ] **Step 3: Implement Options**

Use controlled typed form state and domain validation. Save through `chrome.storage.sync`; never log or render the full key outside its password input. Provider/tool tests stream through background but do not persist conversations.

- [ ] **Step 4: Implement Popup and remove demo assets/components**

Replace Vite/React/CRX branding. Delete `HelloWorld`, `HelloInCSUI`, unused demo assets, demo test-event setup, and unused free-drag shell/hooks only after `rg` proves no Dianzhi code imports them.

- [ ] **Step 5: Run gates and commit**

Run: `pnpm vitest --run tests/unit/options tests/unit/popup && pnpm run typecheck && pnpm run lint && pnpm run build`

```bash
git add src/options src/popup src/components src/assets src/hooks src/events/test.ts tests/unit/options tests/unit/popup
git commit -m "feat(settings): add Dianzhi configuration surfaces"
```

---

### Task 11: Integration, E2E, documentation, and completion audit

**Files:**

- Create: `tests/integration/conversation-flow.spec.ts`
- Create: `tests/integration/offscreen-recovery.spec.ts`
- Create: `tests/e2e/fixtures/reader.html`
- Create: `tests/e2e/support/mock-provider.ts`
- Create: `tests/e2e/dianzhi.spec.ts`
- Modify: `playwright.config.ts`
- Rewrite: `README.md`
- Modify: `CLAUDE.md`
- Modify: `package.json`
- Modify: `docs/superpowers/specs/2026-08-17-dianzhi-complete-extension-design.md` only if verified implementation decisions differ.

**Interfaces:**

- Produces reproducible integration/E2E commands and an operator guide for build, load-unpacked, configure, inspect offscreen/worker/panel, and verify OPFS.

- [ ] **Step 1: Add cross-context integration tests**

Execute selection create → initial stream → midstream panel handoff → follow-up → tool switch/lazy conversation → stop → offscreen recreation → new selection replacement. Assert database operation order, terminal flush ordering, no duplicate IDs/deltas, and per-tab isolation.

- [ ] **Step 2: Add the real extension Playwright fixture**

Launch persistent Chromium with the built extension and mock OpenAI SSE server. Select English fixture text, inspect the Shadow DOM popover, switch tabs, open native Side Panel, continue the conversation, exercise shortcuts, replace the selection, reload the extension context, and assert clean service-worker/page console collection.

- [ ] **Step 3: Rewrite product documentation**

Document Dianzhi purpose, architecture, data ownership, permissions/security impact, exact settings, build/test commands, unpacked loading, Chrome 141 requirement, database location semantics, troubleshooting stable errors, and real-browser verification steps. Remove WareFlow and generic CRXJS product claims.

- [ ] **Step 4: Run the complete automated gate**

Run:

```bash
pnpm run format
pnpm run format:check
pnpm run lint
pnpm run test
pnpm run build
pnpm run test:e2e
git diff --check
```

Expected: all commands pass with no warnings attributable to changed code. Run `pnpm run vendor:sqlite` again and confirm generated vendor assets have no diff.

- [ ] **Step 5: Run manual real-Chrome verification**

Load `dist` unpacked in Chrome 141 or newer and record evidence for: provider setup, selection gate/context, arrow/flip, active tabs, reasoning on/off, card/chat/expand, native Side Panel, midstream handoff, full history/follow-up, `Ctrl+←/→`, `Ctrl+.`, `Esc`, new selection replacement, offscreen/service-worker recreation, OPFS persistence, two-tab isolation, and zero CSP/Blob-worker/network/console errors.

- [ ] **Step 6: Perform completion audit and commit**

Compare every design section and plan checkbox to source, tests, generated manifest, and runtime evidence. Any missing or indirect evidence remains incomplete and must be implemented or verified before this commit.

```bash
git add tests playwright.config.ts README.md CLAUDE.md package.json pnpm-lock.yaml docs
git commit -m "test: verify complete Dianzhi extension workflows"
```

---

## Final review gate

- [ ] No WareFlow/demo UI, Vite/React branding, injected sidebar, ribbon, new-chat button, archive browser, UUID record ID, arbitrary SQL event, remote executable code, Blob worker, or silent database fallback remains.
- [ ] Manifest permissions, CSP, COOP/COEP, Side Panel path, content matches, and Chrome floor match the design.
- [ ] Every cross-context boundary validates untrusted input and uses typed events; background derives tab identity from sender metadata.
- [ ] Every persistent stream reaches a terminal database status and no late event can update a replaced conversation.
- [ ] All automated gates and the real-Chrome two-tab checklist have fresh evidence.
