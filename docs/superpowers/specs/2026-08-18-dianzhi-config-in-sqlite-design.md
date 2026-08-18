# Dianzhi Config-in-SQLite Design

Status: approved via collaborative brainstorming (2026-08-18). Supersedes the tools-portions of `2026-08-17-dianzhi-sqlite-tools-options-testing-design.md`; that spec's provider capability calibration plans are explicitly parked (see Non-goals).

## 1. Goal

Move **all** extension configuration out of `chrome.storage.sync` into the OPFS SQLite database: provider settings, shortcuts, UI limits, and the tool list. The database becomes the single source of truth for configuration after a one-time, idempotent legacy migration.

This feature intentionally reworks _where configuration lives_, not the Options UI surface. Content, Side Panel, and conversation consumers keep receiving the same composed `DianzhiSettings` snapshot shape they use today.

## 2. Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| Config location | OPFS SQLite (offscreen-owned), `chrome.storage.sync` cleared after migration | User request; OPFS is machine-local, so settings deliberately stop syncing across devices |
| Tables | One `tools` table + one `settings` row | Tools are a list with CRUD/order/soft-delete semantics (relational); everything else is one validated document (relational buys nothing) |
| Tool identity | **Numeric**: `tools.id INTEGER PRIMARY KEY AUTOINCREMENT`; presets seeded at reserved ids (`context`=1, `synonyms`=2, `translate`=3); custom tools auto-increment | No redundant string `key` column; matches the approved tools spec's mapping |
| Domain identity | `ToolDefinition.id`, `ConversationRecord.toolId`, `defaultToolId` become integers; `conversations.tool_id` rebuilt to INTEGER in migration | Follows from numeric tool identity (one coherent model) |
| Default tool | `tools.is_default` column (unique partial index, one active default) replaces `ui.defaultToolId` | User request; default is a property of a tool |
| Settings shape | **S1**: single-row JSON document `settings(id=1, data)` holding `{ provider, shortcuts, ui }` | One row per save; `mergeSettings` (defaults, forward-compat) and `validateSettings` keep working unchanged; no per-field migrations |
| Preset source of truth | `src/dianzhi/domain/presets.ts` via typed op `tools.ensurePresets`; **no `seedSQL` literals** | `seedSQL` is raw SQL applied at migration time and cannot reference TS constants; presets must not be duplicated |
| Migration | Schema release `2.0.0` (DDL only) + background-coordinated idempotent `tools.ensurePresets` / `tools.migrateLegacy` ops | Legacy data lives in `chrome.storage`, inaccessible to SQL; app-layer transfer is required |

## 3. Architecture

Unchanged runtime boundaries:

- **Offscreen** owns the OPFS SQLite connection, schema releases, and all SQL. New store methods serve configuration.
- **Background** is the only writer to storage and the only caller of validate/migrate; it brokers every database call through typed RPC, and composes the runtime settings snapshot from the `settings` row + `tools` rows.
- **Options** renders composed snapshots and sends typed write operations (`settings.save`, `tools.*`); it never sends SQL.
- **Content / Side Panel** remain read-only consumers of composed snapshots (`settings.get`).

Data flow after migration:

```
Options ──settings.save / tools.*──▶ Background ──typed RPC──▶ Offscreen (SQLite)
Options ──settings.get─────────────▶ Background ──compose──▶ settings row + tools rows
```

## 4. Schema release `2.0.0`

Appended to `releases: [SCHEMA_RELEASE, CONFIG_RELEASE]` in `src/offscreen/main.ts`. The vendored `web-sqlite-js` applies pending releases in semver order inside a transactional lock and records each release (hash-pinned) — so this DDL runs at most once per database.

```sql
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
```

No `seedSQL`: preset rows are created by the typed `tools.ensurePresets` op so `presets.ts` stays the single source (ids/names/prompts).

### 4.1 Preset single-source cleanup

- Add `BUILTIN_TOOL_NAMES: Readonly<Record<BuiltinToolId, string>>` to `src/dianzhi/domain/presets.ts` (语境 / 同义词 / 翻译).
- `DEFAULT_SETTINGS.tools` (in `settings.ts`) derives from `BUILTIN_TOOL_IDS` + `BUILTIN_TOOL_NAMES` + `BUILTIN_PROMPTS`, removing the duplicated names and prompt lookup indirection.

## 5. Domain and protocol changes

- `DianzhiSettings` advances to `version: 2`. The persisted `settings.data` JSON holds `{ version: 2, provider, shortcuts, ui }` (the version is stored for future migrations); `ui.defaultToolId` is removed (it is derived from `tools.is_default` at composition time). The `tools` array is **not** persisted in the row.
- **Degraded-mode path**: when the row is absent (fresh install) or the offscreen DB is unavailable, composition falls back to `mergeSettings(DEFAULT_SETTINGS)`, which still yields a complete v2 snapshot including the three preset `ToolDefinition`s at numeric ids 1/2/3 — every consumer keeps working without a partial document.
- Background composes the runtime `DianzhiSettings` v2 returned to consumers:
  - `provider`, `shortcuts`, `ui` from the `settings` row;
  - `tools: ToolDefinition[]` from active tool rows (numeric `id`, `is_preset → builtin`, `prompt` column → `customPrompt`, `promptMode` derived);
  - `ui.defaultToolId` = the active default tool's id.
- `ToolDefinition.id: number`; `ConversationRecord.toolId: number`; `ConversationSnapshot.activeToolId: number`; `UiSettings.defaultToolId: number`.
- `effectivePrompt(tool)`: preset tools resolve from `BUILTIN_PROMPTS` (immutable); custom tools read their stored `prompt`.
- Exact derived fields for a composed `ToolDefinition` from a `tools` row:
  - `id` = row id; `name` = row name; `builtin` = `is_preset`; `enabled` = row enabled;
  - `promptMode` = `is_preset && prompt === BUILTIN_PROMPTS[id]` ? `'preset'` : `'custom'`;
  - `customPrompt` = the row's stored `prompt`.
- `mergeSettings` still guarantees defaults and repairs (e.g., exactly one active tool, available default) on composed snapshots.

## 6. Typed operations

New offscreen RPC operations (same requestId dedup for mutations and per-operation validation as today; no arbitrary-SQL events):

| Operation | Args | Notes |
| --- | --- | --- |
| `settings.get` | — | Returns the `settings` row or null |
| `settings.save` | `{ data }` | Upserts row `id=1`; data is the validated `{ provider, shortcuts, ui }` document (no tools) |
| `tools.list` | `{ includeRemoved?: boolean }` | Active (and optionally removed) tool rows ordered by `sort_order` |
| `tools.ensurePresets` | — | Insert-if-missing preset rows from `presets.ts` at reserved ids 1/2/3; sets `is_default` on `context` when no active default exists; never overwrites existing rows |
| `tools.create` | `{ name, prompt }` | New custom tool; `sort_order` appended at end; `is_preset=0`, `enabled=1` |
| `tools.update` | `{ id, patch }` | Rename / prompt / enabled / is_default. Flipping `is_default=1` clears the prior default in the same transaction. `TOOL_LAST_ENABLED` if disabling would leave zero active |
| `tools.reorder` | `{ orderedIds }` | Ordered id set must exactly match active tools; temporary collision-free sort values, then final positions, one transaction. `TOOL_ORDER_INVALID` otherwise |
| `tools.softRemove` | `{ id }` | Sets `deleted_at`; clears `is_default`. `TOOL_NOT_FOUND` if missing or already removed |
| `tools.restore` | `{ id }` | Clears `deleted_at`; re-append at end of active order |
| `tools.migrateLegacy` | `{ legacySettings }` | One-time v1 transfer (Section 7) |

Validation invariants per operation: preset rows (1/2/3) cannot be soft-removed or renumbered; at least one enabled tool must remain; at most one active `is_default`.

New stable error codes: `TOOL_NOT_FOUND`, `TOOL_LAST_ENABLED`, `TOOL_ORDER_INVALID`, `TOOL_PRESET_INVALID`; `SETTINGS_INVALID` is reused for row payloads. These codes **must also be added to the `DIANZHI_ERROR_CODES` whitelist in `src/events/internal/messaging.ts`**, or `errorFromResponse` flattens them into generic `Error`s at the message boundary.

Read operations (`settings.get`, `tools.list`) retry once through the offscreen client exactly like `getConversation` does today; mutations stay single-attempt (requestId dedup already prevents double-apply).

## 7. Migration orchestration (background, one-time, idempotent)

1. Offscreen opens; release `2.0.0` DDL applies.
2. Background checks whether migration already completed (settings row present AND tools beyond the reserved presets present → no-op).
3. Not migrated, legacy sync key present:
   a. `tools.ensurePresets` — reserve preset ids 1/2/3.
   b. Read `chrome.storage.sync[SETTINGS_KEY]` (v1 `DianzhiSettings`), validate with `validateSettings`.
   c. `tools.migrateLegacy`: in one SQLite transaction —
      - sync preset rows' `enabled`/`name` state from the legacy `tools` array;
      - allocate auto-increment ids for legacy custom tools in legacy order (id 4, 5, …), insert rows;
      - for any distinct `conversations.tool_id` string not covered by the mapping, allocate a conversation-only row (`is_preset=0`, `enabled=0`, `deleted_at` set) so history resolves to a stable integer id without surfacing a phantom tool;
      - mark `is_default` from the legacy `defaultToolId` (translate string → reserved/mapped id);
      - rebuild `conversations.tool_id` as INTEGER and rewrite every value through the generated string→id mapping;
      - upsert the `settings` row from legacy `provider` + `shortcuts` + `ui` (minus `defaultToolId`, minus `tools`).
   d. Only after the transaction commits: clear `chrome.storage.sync[SETTINGS_KEY]`.
4. Fresh install (no legacy key): `tools.ensurePresets` only; defaults otherwise come from `mergeSettings`.
5. Crash-safety: `migrateLegacy` is re-runnable (upserts, mapping rebuilt by key match, guarded by the completed-check in step 2). If the offscreen DB is unavailable, background serves `mergeSettings(DEFAULT_SETTINGS)` plus preset rows and reports a non-fatal status; no writes are attempted to a missing DB.

## 8. Options rewiring

- **Provider / UI / shortcuts form**: unchanged UI; `settings.save` now validates in background and persists the `settings` row via RPC instead of `chrome.storage.sync`. The background-side `parseSettingsCommand` is updated to the v2 row shape (no `tools`, no `defaultToolId`).
- **Tools workspace** (the staged `src/options/tools/*` UI): its data layer is swapped from mutating the settings-array to `tools.*` ops (`list/create/update/reorder/softRemove/restore` + `ensurePresets` on load); default-tool selection calls `tools.update` with `is_default`. The workspace holds its own tool-list state and refreshes from `tools.list`; it no longer round-trips tools through `settings.save`.
- **Provider test** (`settings.testProvider`): unchanged; uses the composed provider settings.

## 9. Error handling and security

- All RPC args validated per operation before touching the DB (existing pattern in `rpc.ts`); mutations deduped by `requestId`.
- API key lives in the `settings` row inside OPFS (machine-local). Existing redaction rules remain: the key never appears in logs, error context, or conversation rows.
- Partial unique index `idx_tools_active_default` and app-layer checks jointly enforce the single-active-default invariant.
- Migration failures leave the legacy sync key intact so retries see the original v1 data.

## 10. Testing

- **Unit — store**: `tools` CRUD invariants (order, single active default, last-enabled guard, preset immutability, soft-remove/restore), `settings` row upsert, `migrateLegacy` (fresh install / legacy v1 / interrupted re-run), `ensurePresets` idempotency.
- **Unit — rpc**: per-operation arg validation tables (unknown op, bad payloads).
- **Unit — channel**: new error codes round-trip through `errorToResponse` / `errorFromResponse` (whitelist regression test); config read retry through the offscreen client.
- **Unit — domain**: numeric `ToolDefinition`/`defaultToolId` types; `mergeSettings` v2 composition (missing row, missing tools, truncated doc → defaults).
- **Integration**: conversation flow with numeric `toolId`; composed snapshot shape to content/Side Panel.
- **e2e**: tools workspace create/edit/reorder/soft-remove/restore/default through the real Options UI; provider settings persist across reload.
- **Migration test**: apply release `2.0.0` over a `1.0.0` database containing legacy conversations with string `tool_id`; assert the numeric rewrite and preset seeding.

## 11. Message channels

Events are defined once in `src/events/config.ts` and created per channel in `src/events/{background,extensionPage,contentScript}/`. Channels, transports, and sender validation (all existing):

| Hop | Channel | Transport | Sender validation |
| --- | --- | --- | --- |
| Extension pages (Options, Side Panel, popup, offscreen) → bg | `ep2bg` | `chrome.runtime.sendMessage` (`{event,args}` → `{success,data|error}`) | Sender filter `origin` starts with `chrome-extension://` |
| Content script → bg | `cs2bg` | `chrome.runtime.sendMessage` | `handleWithSender` retains Chrome sender metadata for tab identity |
| bg → extension page | `bg2ep` | `chrome.runtime.sendMessage` | `isPrivilegedExtensionSender` (ext id, no tab, ext origin) — offscreen qualifies |
| bg → content | `bg2cs` | `chrome.tabs.sendMessage(tabId)` | Explicit tab target |
| content ↔ extension page | `ep2cs`/`cs2ep` | Native port relay via bg (`relayService()`) | Port name = event; page vs content port distinguished |
| bg ↔ bg | `bg2bg` | In-memory | n/a |

Config CRUD adds exactly one consumer-facing event: **`toolsCommand`** — `ep2bg 'dianzhi:tools-command'` carrying a `ToolsCommand` union (`tools.list/create/update/reorder/softRemove/restore`), parsed by a new `parseToolsCommand` validator mirroring `parseSettingsCommand`. The tools workspace is its only caller; the Side Panel and content scripts never write tools.

Flow:

```
Options / Side Panel ──ep2bg──▶ background ──bg2ep database-request──▶ offscreen store
  settings.get/save              compose (settings row + tools.list)   settings + tools SQL
  tools.*                        validate sender + payload             (typed ops, no raw SQL)
```

- `settings.get` / `settings.save` handlers swap their backend from `chrome.storage.sync` to the offscreen RPC; the events and all consumers (content, Side Panel, popup) are unchanged.
- Content `ConversationCommand` payloads carry numeric `toolId` / `ToolDefinition` (protocol types in §5); `parseConversationCommand` validation updates accordingly.
- Background is the migration coordinator: after `databaseReady` it runs `ensurePresets` (fresh) or `ensurePresets` + `migrateLegacy` (legacy sync key), idempotently, before serving composed settings; DB unavailable → serve the §5 degraded snapshot and make no writes.

## 12. Non-goals (parked)

- Provider capability calibration / caching (`provider.calibrate`, `provider.invalidateCapability` from the prior tools spec) — added later without changing this design.
- UI redesign beyond the tools workspace data layer swap.
- Cloud synchronization of OPFS config (deliberately local-only).