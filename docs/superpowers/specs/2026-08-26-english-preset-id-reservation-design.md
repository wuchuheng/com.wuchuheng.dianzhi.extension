# Dianzhi 英英释义 Preset + Tool-ID Reservation Design

Status: approved via collaborative brainstorming (2026-08-26). Extends the numeric
tool-identity decision in `2026-08-18-dianzhi-config-in-sqlite-design.md` §2
(presets today = 1..4): this spec adds a 5th preset and **reserves `1..1024` for
presets**, allocating customer/custom tools from **1025** upward.

## 1. Goal

Two coupled changes to the preset tool system:

1. Add a builtin preset tool **`english`（英英释义）** — a context-aware
   “English in English” reading aid. The model explains the **selected English
   text entirely in English** (paraphrase, contextual meaning, grammar), with
   Chinese allowed **only** inside a single required Translation section. The
   user may select a single word or multiple words.
2. Reserve numeric tool IDs so presets always own `1..1024` and
   customer-created (custom) tools always allocate from `1025` upward,
   deterministically and without collisions on any existing install.

## 2. Decisions

| Decision              | Choice                                                                                                       | Rationale                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| New preset identity   | key `english`, display name `英英释义`, preset id **5**                                                       | Next free slot in the reserved preset range; “英英释义” is the standard term for explaining English in English |
| Prompt language       | Prompt file written in **English**; model prose output English; Chinese only in the Translation section      | Matches the tool's immersion purpose (user-confirmed)                                                       |
| Preset id range       | Presets own `1..1024`; custom tools start at `1025`                                                          | Headroom for future presets; unambiguous allocator                                                          |
| Custom id allocation  | `createTool` computes `id = MAX(1025, MAX(id)+1)` inside a transaction and inserts explicitly                | Removes reliance on `sqlite_sequence`; deterministic and collision-safe                                     |
| Existing-install setup | New schema release `2.1.0` renumbers custom tools with `id < 1025` up `+1024`, rewrites `conversations.tool_id`, bumps `sqlite_sequence` to `≥1024` | One-time, idempotent, pure-SQL; keeps the reserved floor empty for future presets |
| Prompt source of truth | Stays `src/dianzhi/domain/presets.ts` via `tools.ensurePresets`; **no `seedSQL` literals**                    | Unchanged from the config-in-sqlite §2 decision                                                             |

## 3. New preset: `english`（英英释义）

### 3.1 Registration

- `src/dianzhi/domain/types.ts`: `BuiltinToolId` gains `'english'`.
- `src/dianzhi/domain/presets.ts`:
  - import `./presetPrompts/translation-in-english.md?raw`
  - `BUILTIN_PROMPTS.english`, `BUILTIN_TOOL_NAMES.english = '英英释义'`,
    `PRESET_TOOL_IDS.english = 5`
- `src/dianzhi/domain/settings.ts`: no change — everything (including
  `DEFAULT_TOOLS`, `validateSettings`, `effectivePrompt`) derives from
  `BUILTIN_TOOL_IDS` / `BUILTIN_PROMPTS` / `PRESET_TOOL_IDS`.

### 3.2 Prompt contract (`presetPrompts/translation-in-english.md`)

Input uses the same `{{context}}` payload as the translate preset (already
wrapped in `<context>` / `<selected>` by `fillTemplate`); no content-side
changes.

Output mirrors the translate preset's Mode A / Mode B split, with the language
rule inverted:

- **All explanation prose is English.**
- **One required Chinese section** translates the selection:
  - Mode A (single word): `中文释义`
  - Mode B (multi-word): `中文翻译`

Mode A output (single word): headword with `·` syllable split + 英/美 IPA →
POS + English definition → **Chinese** 释义 line → “what it means here”
(English) → optional grammar note (English).

Mode B output (multi-word/ phrase / sentence): English paraphrase of the entire
selection → **Chinese** 翻译 line → “what it means here” (English) → optional
grammar note (English).

Reuses the translate preset's boundaries verbatim: never shrink/expand
`<selected>`, never downgrade a Mode-B selection to Mode A, concision rules,
and the final-validation checklist.

## 4. ID reservation

### 4.1 Constants (`src/dianzhi/domain/presets.ts`)

```ts
export const PRESET_ID_RESERVED_MAX = 1024 // presets own ids 1..1024
export const CUSTOM_TOOL_ID_START = 1025   // first id a custom tool may use
```

### 4.2 `createTool` (`src/offscreen/database/config-store.ts`)

Replace reliance on `lastInsertRowid`. Inside the existing transaction:

```ts
const rows = await tx.query<{ maxId: number }>(
  'SELECT COALESCE(MAX(id), 0) AS maxId FROM tools'
)
const id = Math.max(CUSTOM_TOOL_ID_START, (rows[0]?.maxId ?? 0) + 1)
```

then `INSERT INTO tools (id, name, prompt, ...)` with the explicit `id`. The
transaction serializes creation in one reviewer of the max so concurrent
creates cannot collide.

### 4.3 `migrateLegacy` (`src/offscreen/database/config-store.ts`)

`let nextId = 4` → `let nextId = CUSTOM_TOOL_ID_START` (`usedIds` still seeded
with preset ids, so old custom rows map to `≥1025`).

## 5. Migration release `2.1.0`

Appended to `releases` in `src/offscreen/main.ts` (semver-ordered, transactional,
hash-pinned: runs once). Pure SQL; collides only if an install already has
~1021 custom tools, which is unreachable in practice.

```sql
CREATE TEMP TABLE tool_floor_map AS
SELECT id AS old_id, id + 1024 AS new_id
  FROM tools WHERE is_preset = 0 AND id < 1025;

UPDATE conversations
   SET tool_id = (SELECT new_id FROM tool_floor_map WHERE old_id = tool_id)
 WHERE tool_id IN (SELECT old_id FROM tool_floor_map);

UPDATE tools SET id = id + 1024 WHERE is_preset = 0 AND id < 1025;

UPDATE sqlite_sequence SET seq = MAX(seq, 1024) WHERE name = 'tools';
```

`conversations.tool_id` holds no FK constraint (it is a plain integer column),
so the renumber is safe; ordering matters — conversations are remapped from the
captured `tool_floor_map` before `tools.id` changes.

## 6. Behavior after upgrade

- **Existing installs**: migration runs first, moving any custom tools `1..1024`
  up to `1029+`; `conversations.tool_id` follows; the runtime
  `tools.ensurePresets` (background migration-coordinator) then inserts
  `english` at id 5 (enabled, appended to display order). Existing preset
  conversations are untouched.
- **Fresh installs**: presets 1–5 seeded by `ensurePresets`; the first custom
  tool is id 1025.
- **Options UI**: the generic tool list/config is driven by the preset maps, so
  `英英释义` appears automatically and stays editable/resettable like the others.

## 7. Tests

New unit specs under `tests/unit/` (no existing coverage for this surface):

- `presets`: `english` registered, `PRESET_TOOL_IDS.english === 5`, custom floor
  exported as 1025.
- `settings`: `validateSettings` passes with 5 builtin tools; `DEFAULT_TOOLS`
  contains all 5; `effectivePrompt` resolves the new preset.
- `config-store` (fake `DatabaseConnection`): `createTool` returns ids `≥1025`,
  consecutive, and never returns a preset-range id; `migrateLegacy` maps custom
  rows to `≥1025`.
- Migration `2.1.0`: replay the SQL over a seeded fake DB (custom tool at id 5 +
  a conversation row referencing it) → tool moves to `≥1025`,
  `conversations.tool_id` rewritten, id 5 free for the preset insert.

Gates after implementation: `pnpm run format:check`, `pnpm run lint`,
`pnpm run test`, `pnpm run build`.

## 8. Files changed

| Path                                                        | Change                                                             |
| ----------------------------------------------------------- | ------------------------------------------------------------------ |
| `src/dianzhi/domain/types.ts`                               | add `'english'` to `BuiltinToolId`                                  |
| `src/dianzhi/domain/presets.ts`                             | new import, 3 maps, 2 id constants                                 |
| `src/dianzhi/domain/presetPrompts/translation-in-english.md`| **new** prompt file                                                |
| `src/offscreen/database/schema.ts`                          | new `CONFIG_RELEASE` `2.1.0`                                       |
| `src/offscreen/database/config-store.ts`                    | `createTool` explicit id; `migrateLegacy` floor                    |
| `tests/unit/**`                                             | new specs per §7                                                    |
| `docs/superpowers/specs/2026-08-26-english-preset-id-reservation-design.md` | this document             |

## 9. Non-goals

- Do not rename existing presets or renumber their ids.
- Do not change shared prompt machinery (`fillTemplate`, content-side context
  construction, streaming, messaging).
- Do not add a configurable prompt-editor behavior change.