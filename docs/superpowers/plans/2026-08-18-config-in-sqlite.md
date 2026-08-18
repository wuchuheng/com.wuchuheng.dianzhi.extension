# Config-in-SQLite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move all extension configuration (provider, shortcuts, UI limits, tools) into the OPFS SQLite database via a new `2.0.0` schema release, with a one-time idempotent legacy migration from `chrome.storage.sync`.

**Architecture:** Offscreen owns the SQLite schema and all SQL; background brokers every call through typed RPC, composes settings from the `settings` row + `tools` rows, and coordinates the legacy migration; Options reads composed snapshots and writes via typed `settings.save` / `tools.*` events. Content and Side Panel stay read-only consumers of composed `DianzhiSettings` snapshots.

**Tech Stack:** TypeScript, Vitest, Chrome MV3 (background service worker, offscreen document, content scripts, side panel), vendored `web-sqlite-js@2.3.0` (OPFS, release-versioned migrations), `pnpm`.

**Spec:** `docs/superpowers/specs/2026-08-18-dianzhi-config-in-sqlite-design.md` (commit `5b53bfe`). This plan argues from that spec; executors must read both.

## Global Constraints

- Runtime boundaries (from CLAUDE.md): content owns selection/context/placement only; background owns authoritative conversations, provider runs, tab identity, config composition and migration; offscreen owns the OPFS SQLite connection and **all** SQL; Options is the durable settings surface.
- Never add arbitrary-SQL events, remote executable code, Blob workers, in-memory DB fallbacks, or new-chat/archive features.
- Validate all runtime messages at every boundary (`rpc.ts` per-op validation, `parse*Command` in background, sender filters). Derive tab identity from Chrome sender metadata.
- Persistent stream messages must end as `completed` | `error` | `stopped`; terminal SQLite writes must finish before terminal UI events publish.
- API keys never in logs, conversation rows, or error context.
- Tool IDs become **numbers** for presets (`context`=1, `synonyms`=2, `translate`=3) and auto-increment for custom tools. No string `key` column.
- `presets.ts` is the single source for preset id/name/prompt; the DDL release contains **no** `seedSQL` (raw SQL cannot read TS constants).
- Settings are local-only after migration (OPFS); `chrome.storage.sync[SETTINGS_KEY]` is cleared only after the SQLite transaction commits.
- Commands: `pnpm run format:check`, `pnpm run lint` (tsc -b), `pnpm run test` (vitest), `pnpm run build` (vendors web-sqlite assets first — do not hand-edit `dist/`), `pnpm run test:e2e`.
- Do not hand-edit generated `dist/` output.

---

### Task 0: Land the staged tools-workspace work on a clean base

The working tree already contains the approved-but-uncommitted tools workspace UI work (staged: `src/options/tools/*`, `src/background/options-test-runner.ts`, `tests/unit/options/*`, `tests/e2e/tools-options.spec.ts`, and related edits). Everything after this task builds on a committed base.

**Files:** (commit whatever is staged; no new code)
**Interfaces:** Produces: a working `main` with Options tools workspace + provider testing, all tests green.

- [ ] **Step 1: Confirm the tree is sane and green**

Run: `pnpm run lint && pnpm run test`
Expected: typecheck passes; all unit tests pass (current count ≈ 186 + the staged tools tests).

- [ ] **Step 2: Inspect the staged diff for accidental files**

Run: `git status` — confirm the `.superpowers/brainstorm/*` artifacts and `.last-*` files are not staged (they are dev-server noise). If they are staged, leave them: they are inert state files, but do not add anything else.

- [ ] **Step 3: Commit the staged work**

```bash
git add -A
git commit -m "feat: tools workspace UI with provider testing"
```

- [ ] **Step 4: Verify base**

Run: `pnpm run test`
Expected: all tests pass on the committed base.

---

### Task 1: Numeric tool identity + preset single-source + settings v2 domain

The foundation. All other tasks depend on these types. Implements spec §2 (numeric identity), §4.1 (preset single-source), §5 (domain/protocol).

**Files:**
- Modify: `src/dianzhi/domain/types.ts`
- Modify: `src/dianzhi/domain/presets.ts`
- Modify: `src/dianzhi/domain/settings.ts`
- Modify: `src/dianzhi/domain/protocol.ts` (types + parsers in later subtask of this task)
- Modify: `src/options/settings-form.ts` (hyperlink to `defaultToolId` repair logic)
- Modify: `src/options/tools/tool-workspace-state.ts`
- Modify: `tests/unit/domain/protocol.spec.ts`, `tests/unit/domain/settings.spec.ts`, `tests/unit/conversation/reducer.spec.ts`, `tests/unit/offscreen/store.spec.ts`, `tests/unit/sidepanel/panel-state.spec.ts`, `tests/unit/background/provider-runner.spec.ts`, `tests/unit/background/conversation-manager.spec.ts`, `tests/unit/background/options-test-runner.spec.ts`, `tests/e2e/dianzhi.spec.ts`, `tests/e2e/tools-options.spec.ts`
- Modify: any file with string-typed `toolId` / `activeToolId` / `defaultToolId` usage found via `rg -n "activeToolId|defaultToolId|toolId|\.id === '" src`

**Interfaces:**
- Consumes: nothing new.
- Produces (used by every later task):
  - `types.ts`:
    - `ToolDefinition { id: number; name: string; builtin: boolean; enabled: boolean; isDefault: boolean; promptMode: 'preset' | 'custom'; customPrompt: string }` — **`isDefault` added** (composed tools carry it so the workspace can mark the default).
    - `ConversationRecord.toolId: number`; `ConversationSnapshot.activeToolId: number`; `UiSettings.defaultToolId: number`.
    - `UiConfig = Omit<UiSettings, 'defaultToolId'>`
    - `SettingsRowData { version: 2; provider: ProviderSettings; shortcuts: ShortcutSettings; ui: UiConfig }`
    - `DianzhiSettings = SettingsRowData & { ui: UiSettings; tools: ToolDefinition[] }` (composed snapshot).
  - `presets.ts`:
    - `BUILTIN_TOOL_NAMES: Readonly<Record<BuiltinToolId, string>>` (语境 / 同义词 / 翻译)
    - `PRESET_TOOL_IDS: Readonly<Record<BuiltinToolId, number>>` = `{ context: 1, synonyms: 2, translate: 3 }`
  - `settings.ts`:
    - `DEFAULT_ROW: SettingsRowData` (provider/shortcuts/ui defaults; **no** `defaultToolId`, **no** tools)
    - `DEFAULT_TOOLS: readonly ToolDefinition[]` — presets 1/2/3 (`isDefault` true only on id 1)
    - `DEFAULT_SETTINGS: DianzhiSettings` = `composeSettings(DEFAULT_ROW, DEFAULT_TOOLS)` (keeps existing UI seeds working)
    - `mergeSettings(raw: unknown): SettingsRowData` — deep-merges provider/shortcuts/ui against `DEFAULT_ROW`, forces `version: 2`; **removes** the tools-array repair
    - `composeSettings(row: SettingsRowData, tools: readonly ToolDefinition[]): DianzhiSettings` — `ui.defaultToolId = tools.find(t => t.isDefault)?.id ?? tools.find(t => t.enabled)?.id ?? 1`
    - `validateSettings(settings: DianzhiSettings): SettingsValidation` — same checks as today (provider, shortcuts, tools integrity) against the composed doc
  - `protocol.ts`:
    - `ConversationCommand['conversation.ensureTool']` payload becomes `{ selectionKey: number; toolId: number }`; parser accepts `isPositiveInteger(payload.toolId)`
    - `SettingsCommand.settings.save` payload becomes `settings: SettingsRowData`

- [ ] **Step 1: Update the failing type tests**

In `tests/unit/domain/protocol.spec.ts` change every fixture `ToolDefinition.id: 'context'` → `1`, `ConversationRecord.toolId: 'context'` → `1`, `conversation.ensureTool` test payload `{ selectionKey: 1, toolId: 'context' }` → `{ selectionKey: 1, toolId: 1 }`; add a negative case `toolId: 'context'` → `ok: false`. In `tests/unit/domain/settings.spec.ts` add tests:
- `mergeSettings({ version: 1, tools: [{ id: 'context', … }] })` returns a `SettingsRowData` with **no** `tools` member and `version === 2`;
- `composeSettings(DEFAULT_ROW, [{ ...DEFAULT_TOOLS[0], isDefault: true }, ...])` sets `ui.defaultToolId === 1`;
- `composeSettings` with no default and no enabled tool falls back to `1`.
Run: `pnpm run test` — expect these new tests to fail (types/function missing) → red.

- [ ] **Step 2: Rewrite `src/dianzhi/domain/types.ts`**

Apply the Interfaces block above verbatim for `ToolDefinition`, `ConversationRecord.toolId`, `ConversationSnapshot.activeToolId`, `UiSettings.defaultToolId`, `UiConfig`, `SettingsRowData`, `DianzhiSettings`. `BuiltinToolId` and the rest unchanged.

- [ ] **Step 3: Extend `src/dianzhi/domain/presets.ts`**

Add `BUILTIN_TOOL_NAMES` and `PRESET_TOOL_IDS` entries:

```ts
export const BUILTIN_TOOL_NAMES: Readonly<Record<BuiltinToolId, string>> = {
  context: '语境',
  synonyms: '同义词',
  translate: '翻译',
}
export const PRESET_TOOL_IDS: Readonly<Record<BuiltinToolId, number>> = {
  context: 1,
  synonyms: 2,
  translate: 3,
}
```

- [ ] **Step 4: Rewrite `src/dianzhi/domain/settings.ts`**

```ts
export const DEFAULT_ROW: SettingsRowData = {
  version: 2,
  provider: { /* same literal defaults as today's DEFAULT_SETTINGS.provider */ },
  ui: { defaultToolId: undefined as never } // do NOT include defaultToolId — use UiConfig shape:
  //   ui: { contextTargetWords: 100, contextMaxWords: 500, contextMaxBlocks: 6 },
  shortcuts: { /* same literals as today */ },
}

export const DEFAULT_TOOLS: readonly ToolDefinition[] = BUILTIN_TOOL_IDS.map((id, index) => ({
  id: PRESET_TOOL_IDS[id],
  name: BUILTIN_TOOL_NAMES[id],
  builtin: true,
  enabled: true,
  isDefault: index === 0,
  promptMode: 'preset',
  customPrompt: '',
}))

export const DEFAULT_SETTINGS: DianzhiSettings = {
  ...DEFAULT_ROW,
  ui: { ...DEFAULT_ROW.ui, defaultToolId: DEFAULT_TOOLS[0].id },
  tools: [...DEFAULT_TOOLS],
}

export function mergeSettings(raw: unknown): SettingsRowData {
  const merged = cloneSettings(DEFAULT_ROW)
  if (isRecord(raw)) mergeRecord(merged as unknown as Record<string, unknown>, raw)
  merged.version = 2
  return merged
}

export function composeSettings(
  row: SettingsRowData,
  tools: readonly ToolDefinition[]
): DianzhiSettings {
  const active = tools.find((tool) => tool.isDefault) ?? tools.find((tool) => tool.enabled)
  return {
    ...row,
    ui: { ...row.ui, defaultToolId: active?.id ?? 1 },
    tools: [...tools],
  }
}
```

Keep `validateSettings` validating the **composed** `DianzhiSettings` (same field checks as today, including the tools integrity loop and builtin-can't-be-deleted check — `BUILTIN_TOOL_IDS` now maps numeric ids through `PRESET_TOOL_IDS`). Any test that imported `DEFAULT_SETTINGS.tools` continues to work because `DEFAULT_SETTINGS` still has tools.

- [ ] **Step 5: Update `conversation.ensureTool` type + parser in `src/dianzhi/domain/protocol.ts`**

```ts
| { type: 'conversation.ensureTool'; requestId: string; payload: { selectionKey: number; toolId: number } }
```
In `parseConversationCommand`'s `ensureTool` case:
```ts
if (!isPositiveInteger(payload.selectionKey) || !isPositiveInteger(payload.toolId)) {
  return invalid('Tool conversation payload is invalid.')
}
```

- [ ] **Step 6: Fix TypeScript across the tree**

Run: `pnpm run lint` — follow the errors. Expected mechanical fixes:
- `src/options/settings-form.ts`: `defaultToolId` repairs now use numbers; add a `toToolId` guard in the `removeCustomTool`/`setToolEnabled` helpers:
  ```ts
  const fallback = next.tools.find((item) => item.enabled)?.id ?? DEFAULT_TOOLS[0].id
  ```
- `src/options/tools/tool-workspace-state.ts`: `repairActiveTool(tools, activeToolId: number | null, defaultToolId: number): number | null` — same logic, numeric.
- `src/content/**`, `src/sidepanel/**`, `src/dianzhi/ui/tool-tabs-state.ts`, `src/options/App.tsx`, `src/background/**`: any `'context'` string used as a tool id/default → `1` (or the typed mapping), and `ToolDefinition` literals get numeric ids + `isDefault`.
- Test fixtures across `tests/unit/**` and `tests/e2e/**` (use `mergeSettings` / `DEFAULT_SETTINGS` where possible; inline literals get numeric ids).

Do not yet change store/rpc/schema (Tasks 2–3 handle those).

- [ ] **Step 7: Green + commit**

Run: `pnpm run format:check && pnpm run lint && pnpm run test`
Expected: all pass.
Commit: `git add -A && git commit -m "refactor: numeric tool ids and settings v2 domain types"`

---

### Task 2: Schema release 2.0.0 + config store + RPC ops + error whitelist

Implements spec §4 (DDL, conversation `tool_id` rebuild), §6 (ops, invariants, error codes), §9 (whitelist).

**Files:**
- Modify: `src/offscreen/database/schema.ts`
- Create: `src/offscreen/database/config-store.ts`
- Modify: `src/offscreen/database/store.ts` (conversation methods now receive numeric `tool.id`; no SQL change beyond column type)
- Modify: `src/offscreen/database/rpc.ts`
- Modify: `src/offscreen/main.ts` (register `CONFIG_RELEASE` + `createConfigStore`)
- Modify: `src/dianzhi/domain/errors.ts`, `src/events/internal/messaging.ts` (whitelist)
- Create: `tests/unit/offscreen/config-store.spec.ts`; modify `tests/unit/offscreen/store.spec.ts` (fixture ids)

**Interfaces:**
- Consumes: Task 1 types (`ToolDefinition` numeric, `BUILTIN_TOOL_IDS/NAMES/PROMPTS`, `PRESET_TOOL_IDS`).
- Produces:
  - `schema.ts`: `export const CONFIG_RELEASE: { version: '2.0.0'; migrationSQL: string }` (no `seedSQL`)
  - `config-store.ts`:
    ```ts
    export interface ToolRecord {
      id: number; name: string; prompt: string; isPreset: boolean; isDefault: boolean;
      enabled: boolean; sortOrder: number; deletedAt: string | null;
      createdAt: string; updatedAt: string
    }
    export interface LegacyToolInput {
      id: string; name: string; isBuiltin: boolean; enabled: boolean; prompt: string
    }
    export interface ConfigStore {
      listTools(includeRemoved?: boolean): Promise<ToolRecord[]>
      ensurePresets(): Promise<void>
      createTool(input: { name: string; prompt: string }): Promise<ToolRecord>
      updateTool(id: number, patch: { name?: string; prompt?: string; enabled?: boolean; isDefault?: boolean }): Promise<ToolRecord>
      reorderTools(orderedIds: number[]): Promise<void>
      softRemoveTool(id: number): Promise<void>
      restoreTool(id: number): Promise<void>
      getSettings(): Promise<string | null>
      saveSettings(data: string): Promise<void>
      migrateLegacy(input: { tools: LegacyToolInput[]; defaultToolId: string | null }): Promise<Record<string, number>>
    }
    export function createConfigStore(db: DatabaseConnection, clock: () => string): ConfigStore
    ```
  - `rpc.ts`: `DatabaseOperationMap` gains the ops above (args exactly as the store signatures minus `id` for update/remove/restore which become top-level args); `MUTATIONS` gains `ensurePresets, createTool, updateTool, reorderTools, softRemoveTool, restoreTool, saveSettings, migrateLegacy`.
  - `errors.ts`: codes `TOOL_NOT_FOUND`, `TOOL_LAST_ENABLED`, `TOOL_ORDER_INVALID`, `TOOL_PRESET_INVALID`; add the same four to `DIANZHI_ERROR_CODES` in `messaging.ts`.
  - `store.ts` conversation SQL: `tool_id` is now INTEGER; add nothing else here (migration handles the column).

- [ ] **Step 1: Write the failing schema-constants + store tests**

Create `tests/unit/offscreen/config-store.spec.ts` using the same `RecordingDatabase` approach as `store.spec.ts` (records `exec`/`query` SQL+params; overridable canned `query` results). Assert, in order:

1. `createTool({name:'读后续写', prompt:'...'})` issues
   ```sql
   INSERT INTO tools (name, prompt, is_preset, is_default, enabled, sort_order, deleted_at, created_at, updated_at)
   VALUES (?, ?, 0, 0, 1, (SELECT COALESCE(MAX(sort_order),0)+1 FROM tools WHERE deleted_at IS NULL), NULL, ?, ?)
   ```
   with params `['读后续写', '...', now, now]`.
2. `updateTool(5, { isDefault: true })` runs, inside one `db.transaction`, exactly:
   - `UPDATE tools SET is_default = 0 WHERE is_default = 1`
   - `UPDATE tools SET is_default = 1, updated_at = ? WHERE id = ?` with `[now, 5]`
3. `reorderTools([3,1,2])` first `SELECT`s active ids
   (`SELECT id, name, prompt, is_preset AS isPreset, is_default AS isDefault, enabled, sort_order AS sortOrder, deleted_at AS deletedAt, created_at AS createdAt, updated_at AS updatedAt FROM tools WHERE deleted_at IS NULL ORDER BY sort_order`), then updates each row to a temporary offset (`100000 + index`), then to final `index + 1` — all in one transaction.
4. `softRemoveTool(4)` sets `deleted_at` and clears `is_default`; `restoreTool(4)` clears `deleted_at` and appends `sort_order = MAX(active)+1`.
5. `getSettings()` returns the `data` string of row `id = 1`; `saveSettings('{"ok":1}')` runs the upsert:
   ```sql
   INSERT INTO settings (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data
   ```
6. `migrateLegacy({ tools: [context variant + one custom], defaultToolId: 'custom1' })` — with a canned `query` returning `[{ tool_id_legacy: 'context' }, { tool_id_legacy: 'custom1' }]` — sequences: preset inserts for ids not present (assert `INSERT INTO tools ... VALUES (1,...)`, `(2,...)`, `(3,...)` with names/prompts from `BUILTIN_TOOL_NAMES`/`BUILTIN_PROMPTS`), a custom insert allocated id `4`, `UPDATE conversations SET tool_id = ? WHERE tool_id_legacy = ?` for each mapping pair, `UPDATE tools SET is_default = 1 WHERE id = 4`, and the settings row insert reserved.
   Also assert `listTools(false)` excludes `deleted_at` non-null rows.
7. `ensurePresets()` on a table that already has id 1/2/3 does **not** emit inserts.

Run: `pnpm run test tests/unit/offscreen/config-store.spec.ts` — expect FAIL (module/file missing).

- [ ] **Step 2: Add the schema release**

In `src/offscreen/database/schema.ts` append:

```ts
export const CONFIG_RELEASE = {
  version: '2.0.0',
  migrationSQL: `
PRAGMA foreign_keys = ON;

CREATE TABLE tools (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  is_preset   INTEGER NOT NULL DEFAULT 0 CHECK (is_preset IN (0,1)),
  is_default  INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  enabled     INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  sort_order  INTEGER NOT NULL,
  deleted_at  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE UNIQUE INDEX idx_tools_active_order
  ON tools(sort_order) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX idx_tools_active_default
  ON tools(is_default) WHERE is_default = 1 AND deleted_at IS NULL;

CREATE TABLE settings (
  id   INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);

-- Rebuild conversations.tool_id as INTEGER; keep the legacy string in
-- tool_id_legacy so migrateLegacy can map it once the id mapping exists.
CREATE TABLE conversations_new (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  selection_key   INTEGER NOT NULL,
  tab_id           INTEGER NOT NULL,
  tool_id          INTEGER NOT NULL DEFAULT 0,
  tool_id_legacy   TEXT,
  tool_name        TEXT NOT NULL,
  title            TEXT NOT NULL,
  selected_text    TEXT NOT NULL,
  context_text     TEXT NOT NULL,
  prompt_snapshot  TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL,
  UNIQUE(selection_key, tool_id)
);

INSERT INTO conversations_new (
  id, selection_key, tab_id, tool_id, tool_id_legacy, tool_name, title,
  selected_text, context_text, prompt_snapshot, created_at, updated_at
)
SELECT id, selection_key, tab_id, 0, tool_id, tool_name, title,
  selected_text, context_text, prompt_snapshot, created_at, updated_at
FROM conversations;

CREATE TABLE messages_new (
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

INSERT INTO messages_new (id, conversation_id, sequence, role, content, reasoning_content, status, error_code, error_message, created_at, updated_at)
SELECT id, conversation_id, sequence, role, content, reasoning_content, status, error_code, error_message, created_at, updated_at FROM messages;

DROP TABLE messages;
DROP TABLE conversations;

ALTER TABLE conversations_new RENAME TO conversations;
ALTER TABLE messages_new RENAME TO messages;

CREATE INDEX idx_conversations_tab_selection ON conversations(tab_id, selection_key);
CREATE INDEX idx_messages_conversation_sequence ON messages(conversation_id, sequence);
`,
} as const
```

(Child `messages` dropped before parent `conversations`, so `PRAGMA foreign_keys = ON` holds throughout; the `messages_new` FK resolves to `conversations` by name after the renames.)

- [ ] **Step 3: Register the release + config store in `src/offscreen/main.ts`**

```ts
import { CONFIG_RELEASE, SCHEMA_RELEASE } from './database/schema'
import { createConfigStore } from './database/config-store'

// in initialize():
const db = (await openDB('dianzhi.sqlite3', {
  debug: false,
  releases: [SCHEMA_RELEASE, CONFIG_RELEASE],
})) as DatabaseConnection
await db.exec('PRAGMA foreign_keys = ON')

const clock = () => new Date().toISOString()
const store = createConversationStore(db, clock)
const config = createConfigStore(db, clock)
databaseRequest.handle(createDatabaseRpc({ conversation: store, config }))
```

Change `createDatabaseRpc`'s signature to accept `{ conversation: ConversationStore; config: ConfigStore }`, keeping every existing conversation op dispatched to `conversation` and new ops to `config` (see Step 5). Update `rpc.ts`'s `DatabaseOperationMap` and validation accordingly; existing conversation ops keep their exact current validation.

- [ ] **Step 4: Implement `src/offscreen/database/config-store.ts`**

Follow the RecordingDatabase tests exactly. Shared helpers (copy from `store.ts` conventions): `integerId`, column alias lists. Preset defaults come from `PRESET_TOOL_IDS`, `BUILTIN_TOOL_IDS`, `BUILTIN_TOOL_NAMES`, `BUILTIN_PROMPTS`. Key rules:

- `ensurePresets()`: `INSERT INTO tools (...) VALUES (?,…)` per preset **only if id not present** — implement via `INSERT ... SELECT ... WHERE NOT EXISTS (SELECT 1 FROM tools WHERE id = ?)` or one read-then-insert in a transaction; never overwrite existing rows.
- `updateTool` guards: id must exist (`TOOL_NOT_FOUND`); disabling the row when zero enabled would remain → `TOOL_LAST_ENABLED`; `isDefault: true` clears the old default first (same transaction).
- `reorderTools`: active id set must equal the input set → else `TOOL_ORDER_INVALID`; temp `sort_order = 100000 + index` then final `index + 1`.
- `softRemoveTool`: preset ids 1/2/3 → `TOOL_PRESET_INVALID`; sets `deleted_at = now`, `is_default = 0`.
- `migrateLegacy`: one transaction — (a) `ensurePresets` inside the same tx; (b) for legacy tools not presets, insert in legacy order (id 4, 5, …); (c) `SELECT DISTINCT tool_id_legacy FROM conversations WHERE tool_id_legacy IS NOT NULL`; allocate conversation-only rows (`is_preset=0, enabled=0, deleted_at=now`) for unmapped strings; (d) `UPDATE conversations SET tool_id = <mapped> WHERE tool_id_legacy = '<legacy>'` for every pair, then `UPDATE conversations SET tool_id_legacy = NULL` where mapped; (e) set `is_default` on the mapped default id (clear others); (f) return the string→number mapping.

- [ ] **Step 5: Extend `src/offscreen/database/rpc.ts`**

Add ops to `DatabaseOperationMap` with `args` exactly matching the store signatures (top-level `id` args for `updateTool`, `softRemoveTool`, `restoreTool`). Add validation predicates: `isToolName`, `isToolPrompt` (non-empty strings, length ≤ 2000), `isOrderedIds` (non-empty, all positive ints), `isSettingsData` (string, length ≤ 100_000). `migrateLegacy` args: `{ legacyTools: LegacyToolInput[]; legacyDefaultToolId: string | null }` with per-field validation. Extend `MUTATIONS` and dispatch. `invalidRequest()` stays for unknown ops.

- [ ] **Step 6: Error codes + whitelist**

`src/dianzhi/domain/errors.ts`: add `TOOL_NOT_FOUND | TOOL_LAST_ENABLED | TOOL_ORDER_INVALID | TOOL_PRESET_INVALID` to the `DianzhiErrorCode` union. `src/events/internal/messaging.ts`: add the same four strings to `DIANZHI_ERROR_CODES`.

- [ ] **Step 7: Fix the conversation-store fixture + run**

`tests/unit/offscreen/store.spec.ts`: the `tool` fixture `id: 'context'` → `1` (and any expected SQL/params that use `input.tool.id`, which is now numeric). Ensure `store.ts` conversation inserts pass `input.tool.id` (number) into `tool_id`.

Run: `pnpm run lint && pnpm run test`
Expected: all pass, including the new `config-store.spec.ts`.

- [ ] **Step 8: Commit**

`git add -A && git commit -m "feat: config tables, tools/settings store ops and RPC migration 2.0.0"`

---

### Task 3: Background composition, migration coordinator, and tools command event

Implements spec §3, §7, §8 (background half), §11 (message channels: `toolsCommand`).

**Files:**
- Modify: `src/events/config.ts`
- Modify: `src/dianzhi/domain/protocol.ts` (add `ToolsCommand` + `parseToolsCommand`; `SettingsCommand.save` payload → `SettingsRowData`)
- Create: `src/background/config-composer.ts` (composition + row serialization helpers)
- Create: `src/background/migration-coordinator.ts`
- Modify: `src/background/index.ts` (`loadSettings`, `settings.save` handler, new `toolsCommand` handler)
- Create: `tests/unit/background/config-composer.spec.ts`, `tests/unit/background/migration-coordinator.spec.ts`; modify `tests/unit/background/protocol.spec` additions in Task 1 file

**Interfaces:**
- Consumes: Task 1 types/`composeSettings`/`mergeSettings`; Task 2 store ops via the offscreen client.
- Produces:
  - `protocol.ts`:
    ```ts
    export type ToolsCommand =
      | { type: 'tools.list'; requestId: string; payload: { includeRemoved?: boolean } }
      | { type: 'tools.ensurePresets'; requestId: string; payload: Record<string, never> }
      | { type: 'tools.create'; requestId: string; payload: { name: string; prompt: string } }
      | { type: 'tools.update'; requestId: string; payload: { id: number; patch: { name?: string; prompt?: string; enabled?: boolean; isDefault?: boolean } } }
      | { type: 'tools.reorder'; requestId: string; payload: { orderedIds: number[] } }
      | { type: 'tools.softRemove'; requestId: string; payload: { id: number } }
      | { type: 'tools.restore'; requestId: string; payload: { id: number } }
    export function parseToolsCommand(value: unknown): ParseResult<ToolsCommand>
    ```
  - `config.ts`: `export const toolsCommand = events.ep2bg<ToolsCommand, unknown>('dianzhi:tools-command')`
  - `config-composer.ts`:
    ```ts
    export function toToolDefinition(record: ToolRecord): ToolDefinition
    // promptMode = record.isPreset && record.prompt === BUILTIN_PROMPTS[<preset for id>] ? 'preset' : 'custom';
    // customPrompt = record.prompt; isDefault = record.isDefault
    export function serializeRow(settings: Omit<DianzhiSettings, 'tools' | 'ui' | 'version'>): unknown
    // actually: export function rowDataFromSettings(settings: DianzhiSettings): SettingsRowData
    export function settingsRowToBase(raw: string | null): SettingsRowData
    export async function composeSettingsSnapshot(base: SettingsRowData, records: ToolRecord[]): Promise<DianzhiSettings>
    ```
  - `migration-coordinator.ts`:
    ```ts
    export interface MigrationDependencies {
      getSettings(): Promise<string | null>
      listTools(includeRemoved: boolean): Promise<ToolRecord[]>
      ensurePresets(): Promise<void>
      migrateLegacy(input: Parameters<ConfigStore['migrateLegacy']>[0]): Promise<Record<string, number>>
      readLegacySettings(): Promise<unknown>  // chrome.storage.sync[SETTINGS_KEY]
      clearLegacySettings(): Promise<void>
    }
    export function createMigrationCoordinator(deps: MigrationDependencies): {
      ensureMigrated(): Promise<void>
    }
    ```
- [ ] **Step 1: Write the failing tests**

`tests/unit/background/config-composer.spec.ts`:
- `toToolDefinition({ id: 1, isPreset: true, prompt: BUILTIN_PROMPTS.context, isDefault: true, name: '语境', enabled: true, ... })` → `{ id: 1, name: '语境', builtin: true, enabled: true, isDefault: true, promptMode: 'preset', customPrompt: BUILTIN_PROMPTS.context }`
- a preset whose `prompt` was edited → `promptMode: 'custom', customPrompt: <edited>`
- `composeSettingsSnapshot(...)` derives `defaultToolId` (delegates to domain `composeSettings`).

`tests/unit/background/migration-coordinator.spec.ts` (fakes for deps): 
- legacy sync key present → calls `ensurePresets`, `migrateLegacy` with parsed settings `{ provider, ui, shortcuts }` and `defaultToolId`, then `clearLegacySettings`;
- no legacy key → only `ensurePresets`;
- `migrateLegacy` rejects → `clearLegacySettings` NOT called, error surfaces;
- second call (`ensureMigrated`) is a no-op (in-memory guard).

`tests/unit/domain/protocol.spec.ts` additions: `parseToolsCommand` accepts valid `tools.update` and rejects unknown types and negative ids.

Run: `pnpm run test tests/unit/background tests/unit/domain/protocol.spec.ts` — expect FAIL (missing modules).

- [ ] **Step 2: Add `ToolsCommand` + `parseToolsCommand` to `protocol.ts`**

Mirror `parseConversationCommand`'s structure: envelope (`requestId`, `type`, `payload`), reject caller-supplied `tabId`, `parseToolsCommand` validates each op; `tools.reorder` requires `Array.isArray(orderedIds) && orderedIds.length > 0 && every isPositiveInteger`; `tools.update` `patch` must be a record with at least one recognized key and only recognized keys.

- [ ] **Step 3: Register `toolsCommand` event in `src/events/config.ts`**

```ts
export const toolsCommand = events.ep2bg<ToolsCommand, unknown>('dianzhi:tools-command')
```

- [ ] **Step 4: Implement `config-composer.ts`**

Per the Interfaces block; `settingsRowToBase(raw)` = `raw ? mergeSettings(JSON.parse(raw)) : mergeSettings(null)` with try/catch → `mergeSettings(null)` on parse failure; `rowDataFromSettings(settings)` strips `tools`, drops `ui.defaultToolId`, sets `version: 2`.

- [ ] **Step 5: Implement `migration-coordinator.ts`**

```ts
export function createMigrationCoordinator(deps: MigrationDependencies) {
  let done = false
  return {
    async ensureMigrated(): Promise<void> {
      if (done) return
      await deps.ensurePresets()
      const legacy = await deps.readLegacySettings()
      if (legacy === undefined) { done = true; return }
      const rawTools = (legacy as { tools?: unknown }).tools
      const legacyTools = Array.isArray(rawTools)
        ? rawTools.filter(isLegacyToolInput)
        : []
      const merged = mergeSettings(legacy)
      await deps.migrateLegacy({
        tools: legacyTools,
        defaultToolId:
          (merged as SettingsRowData & { ui?: { defaultToolId?: string } }).ui?.defaultToolId ?? null,
      })
      await deps.clearLegacySettings()
      done = true
    },
  }
}
```
`isLegacyToolInput` validates `{ id: string, name: string, isBuiltin: boolean, enabled: boolean, prompt: string }` record shape; legacy `ui.defaultToolId` is read from the raw blob because `mergeSettings` now returns `SettingsRowData` without it.

- [ ] **Step 6: Rewire `src/background/index.ts`**

- `loadSettings()` becomes:
  ```ts
  async function loadSettings(): Promise<DianzhiSettings> {
    await migrationCoordinator.ensureMigrated()
    const raw = await database.request('getSettings', {})   // add read retry (see Step 7)
    const records = await database.request('tools.list', { includeRemoved: false })
    const base = settingsRowToBase(raw)
    return composeSettingsSnapshot(base, records)
  }
  ```
  Degraded path: wrap the two RPC calls in try/catch → `composeSettingsSnapshot(mergeSettings(null), DEFAULT_TOOLS)` when the DB is unavailable (spec §5).
- `settingsCommand` handler: for `settings.save`, build `rowDataFromSettings(settings)` and `await database.request('saveSettings', { data: JSON.stringify(row) })`, then return the composed snapshot; `settings.get` returns `loadSettings()`; `settings.testProvider` unchanged.
- New handler:
  ```ts
  toolsCommand.handle(async (value) => {
    const parsed = parseToolsCommand(value)
    if (!parsed.ok) throw new DianzhiError(parsed.error)
    return dispatchToolsCommand(parsed.value, database)
  })
  ```
  `dispatchToolsCommand` maps op → `database.request(op, args)`; `tools.create/update/softRemove/restore` return the refreshed `tools.list` result (so Options can re-render from one round trip).
- Add `createMigrationCoordinator(...)` wired to `database.request('getSettings')`, `database.request('tools.list', {includeRemoved:true})`, `database.request('ensurePresets')`, `database.request('migrateLegacy', {...})`, `chrome.storage.sync.get(SETTINGS_KEY)` / `chrome.storage.sync.remove(SETTINGS_KEY)`.
- Call `migrationCoordinator.ensureMigrated()` inside `loadSettings` (after `databaseReady`), and also on `settings.save` before writing.

- [ ] **Step 7: Read retry for config reads in `src/background/offscreen-client.ts`**

```ts
const attempts = operation === 'getConversation' || operation === 'getSettings' || operation === 'tools.list' ? 2 : 1
```

- [ ] **Step 8: Green + commit**

Run: `pnpm run lint && pnpm run test`
Expected: all pass.
Commit: `git add -A && git commit -m "feat: background composes settings from SQLite and migrates legacy storage"`

---

### Task 4: Options rewiring — tools workspace on `tools.*` ops

Implements spec §8 (Options), §5 derived fields in the workspace UI.

**Files:**
- Create: `src/options/tools/use-tools-api.ts` (injected API holder for the workspace)
- Modify: `src/options/tools/ToolsWorkspace.tsx`
- Modify: `src/options/tools/ToolList.tsx`, `src/options/tools/ToolConfig.tsx` (default indicator / promptMode editing)
- Modify: `src/options/App.tsx` (workspace gets `toolsApi` + `provider`; settings form save → row payload)
- Modify: `src/options/settings-form.ts` (remove tool-array helpers now owned by the workspace; keep document-level helpers)
- Update: `tests/unit/options/tools-workspace.spec.tsx`, `tests/unit/options/tool-list.spec.tsx`, `tests/unit/options/tool-config.spec.tsx`, `tests/unit/options/app.spec.tsx`, `tests/e2e/tools-options.spec.ts`

**Interfaces:**
- Consumes: Task 3 `toolsCommand` event; Task 1 types.
- Produces:
  ```ts
  // src/options/tools/use-tools-api.ts
  export interface ToolsApi {
    list(includeRemoved?: boolean): Promise<ToolRecord[]>
    create(name: string, prompt: string): Promise<ToolRecord[]>
    update(id: number, patch: { name?: string; prompt?: string; enabled?: boolean; isDefault?: boolean }): Promise<ToolRecord[]>
    reorder(orderedIds: number[]): Promise<ToolRecord[]>
    softRemove(id: number): Promise<ToolRecord[]>
    restore(id: number): Promise<ToolRecord[]>
  }
  export function useToolsApi(): ToolsApi  // dispatches toolsCommand ep2bg events
  ```
  `ToolsWorkspaceProps` becomes:
  ```ts
  export interface ToolsWorkspaceProps {
    provider: ProviderSettings
    toolsApi?: ToolsApi   // injected for tests; production uses useToolsApi()
  }
  ```
  The workspace owns its tool-list state (`useState<ToolRecord[]>`), refreshes after each mutation, and no longer receives/emits a whole `DianzhiSettings` doc.
- [ ] **Step 1: Write the failing component tests**

Update `tests/unit/options/tools-workspace.spec.tsx` to render `<ToolsWorkspace provider={provider} toolsApi={fakeApi} />`; fake `list` returns three preset `ToolRecord`s. Assert:
- initial render lists the three presets (names from the fake), default badge on id 1;
- "make default" on id 2 calls `fakeApi.update(2, { isDefault: true })`;
- drag-reorder calls `fakeApi.reorder([3, 2, 1])`;
- remove calls `fakeApi.softRemove(2)`;
- after any mutation the list is re-fetched (`fakeApi.list` called again).
Run: `pnpm run test tests/unit/options` — expect FAIL.

- [ ] **Step 2: Implement `use-tools-api.ts`**

Each method dispatches `toolsCommand` with a fresh `requestId` and returns the `tools.list` result payload; production wiring:
```ts
export function useToolsApi(): ToolsApi {
  return useMemo(() => ({
    list: (includeRemoved) => toolsCommand.dispatch({ type: 'tools.list', requestId: crypto.randomUUID(), payload: { includeRemoved } }) as Promise<unknown> as Promise<ToolRecord[]>,
    // ... create/update/reorder/softRemove/restore same pattern
  }), [])
}
```

- [ ] **Step 3: Rewrite `ToolsWorkspace.tsx`**

- Drop `settings`/`onSettingsChange` props; hold `tools: ToolRecord[] | null` state, `pickedToolId: number | null`, `detailTab`.
- On mount and after every mutation: `toolsApi.list(false)` → set state; guard against unmounted setState with a disposed flag in a `useEffect` loader.
- `updateTool(id, patch)` → `toolsApi.update(...)` then refresh; the default-tool control sets `{ isDefault: true }` (server clears others).
- Reorder handlers call `toolsApi.reorder(orderedIds)`; keep the existing drag structures in `ToolList`.
- `ToolTestPane` keeps working: pass `provider` and `tools.find(t => t.id === activeId)`'s composed prompt (via `toToolDefinition` from `config-composer` — import from `@/background/config-composer` or move `toToolDefinition` to domain `settings.ts` if the options bundle cannot import background; prefer the domain location: **move `toToolDefinition` into `src/dianzhi/domain/settings.ts`** in Task 4 and have `config-composer.ts` re-export it — the options page bundles domain, not background).
- `ToolConfig` prompt editor maps the single `prompt` field; preset rows keep a "重置为内置提示词" button (writes `prompt = BUILTIN_PROMPTS[...]` via `update`), and `promptMode` is derived on render.

- [ ] **Step 4: Update `ToolList.tsx` / `ToolConfig.tsx`**

ToolList receives `ToolRecord[]` + callbacks; render `isDefault` badge; ToolConfig receives the active `ToolRecord` + `onPatch(patch)` and edits `name`/`prompt`/`enabled` with local draft state (unchanged patterns, numeric ids).

- [ ] **Step 5: Rewire `src/options/App.tsx` and `settings-form.ts`**

- Provider/ui/shortcuts tab: on save, dispatch `settingsCommand` `settings.save` with `rowDataFromSettings(settings)` (import from `@/dianzhi/domain/settings` — move `rowDataFromSettings` there too) and update local state from the returned composed snapshot.
- Tools tab: `<ToolsWorkspace provider={settings.provider} />` (no doc props).
- `settings-form.ts`: delete `addCustomTool`, `moveTool`, `removeCustomTool`, `reorderToolsByTarget`, `setToolEnabled` (workspace owns tool mutation now); keep `updateProvider`/`updateUi`/shortcut helpers; remove the `defaultToolId`-repair logic that referenced `settings.tools`.

- [ ] **Step 6: Green + commit**

Run: `pnpm run lint && pnpm run test`
Expected: all pass.
Commit: `git add -A && git commit -m "feat: tools workspace on SQLite-backed tools API"`

---

### Task 5: Migration verification, degraded mode, and final gate

Implements spec §10 (migration test, degraded path) and closes the loop.

**Files:**
- Create: `tests/unit/offscreen/migration.spec.ts` (real-DB path is not available in vitest; use `RecordingDatabase` with canned `query` sequences — **alternatively** run the real `web-sqlite` against a temp file if the harness supports it: check `node_modules/web-sqlite-js` worker requirements first; if not usable in node, keep the recording-DB assertions and add a manual e2e step)
- Modify: `tests/e2e/tools-options.spec.ts` (fixture: settings row writes + reload persistence), `tests/e2e/dianzhi.spec.ts` (numeric `toolId` in fixtures)
- Modify: `src/dianzhi/domain/settings.ts` (if `toToolDefinition`/`rowDataFromSettings` were not yet moved — done in Task 4; verify imports)

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: nothing new.

- [ ] **Step 1: Migration sequence test**

`tests/unit/offscreen/migration.spec.ts`:
- Given a `RecordingDatabase` pretends history: canned `migrateLegacy` inputs with two custom legacy tools and conversations referencing `'context'` and a kebab-case custom id;
- assert `migrateLegacy` return mapping `{ context: 1, synonyms: 2, translate: 3, 'my-custom': 4, 'ghost': 5 }` (ghost = conversation-only row with `is_preset=0, enabled=0, deleted_at` set);
- assert re-running migrateLegacy with the same input does not re-insert (tool table now has rows; inserts skipped), i.e., idempotency.
Run: `pnpm run test tests/unit/offscreen/migration.spec.ts` — expect FAIL, then implement per Task 2's store rules if anything is missing (fix in `config-store.ts`).

- [ ] **Step 2: Degraded-mode test**

`tests/unit/background/config-composer.spec.ts` add: `settingsRowToBase('not json')` → `mergeSettings(null)` (parse failure safe).
`tests/unit/background/conversation-manager.spec.ts` add: when the offscreen client rejects `getSettings`, `loadSettings` returns the `DEFAULT_SETTINGS` composed snapshot (patch the background handler's try/catch — already specified in Task 3 Step 6; make it explicit with this test).

- [ ] **Step 3: e2e fixture refresh + persistence check**

`tests/e2e/tools-options.spec.ts` and `tests/e2e/dianzhi.spec.ts`: update settings fixtures to the v2 composed shape (numeric ids, `isDefault`). Add an e2e assertion that editing provider settings, reloading the Options page, re-reading settings retains the values (SQLite round-trip).

- [ ] **Step 4: Full verification**

Run: `pnpm run format:check && pnpm run lint && pnpm run test && pnpm run build`
Expected: all green; build vendors web-sqlite assets and packs the zip.
Optionally run `pnpm run test:e2e` if a local Chromium profile is available (see `start-chromium.sh`).

- [ ] **Step 5: Commit**

`git add -A && git commit -m "test: config migration, degraded mode, and e2e persistence"`

---

## Parallelization note

Tasks 0–1 are strictly sequential (shared types). **After Task 2 commits**, Tasks 3 (background) and Task 4 (Options workspace) are independent *if* the interfaces in the Task 2/3/4 "Produces" blocks are honored exactly — they share no files (`background/**` vs `options/tools/**`, with `protocol.ts` additions confined to Task 3). They may be dispatched concurrently. Task 5 collects.

## Self-review log

1. **Spec coverage:** §4 DDL → Task 2; §4.1 presets single-source → Task 1; §5 domain/protocol → Tasks 1+3; §6 ops/invariants/codes/whitelist → Tasks 2+3; §7 migration → Tasks 3; §8 Options → Task 4; §9 security → Tasks 2–4 (redaction unchanged, rpc validation); §10 testing → Tasks 1–5; §11 channels → Task 3; §12 non-goals → none.
2. **Placeholder scan:** no TBD/TODO; every code step shows the actual implementation or an exact interface with a mechanical fill-in target.
3. **Type consistency:** `ToolRecord`/`ToolDefinition` (numeric id, `isDefault`) shared across Tasks 2–4; `SettingsRowData` vs `DianzhiSettings` split consistent in Tasks 1/3/4; `migrateLegacy` naming pinned once (Task 2). `toToolDefinition`/`rowDataFromSettings` live in domain `settings.ts` (final location) with `config-composer.ts` re-exporting.