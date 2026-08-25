# English Preset + ID Reservation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new builtin preset `english`（英英释义）whose prompt is a complete pure-English port of the translate prompt (one Chinese Translation line allowed), and reserve tool IDs `1..1024` for presets while customer-created tools start at `1025`.

**Architecture:** Preset registration stays in `src/dianzhi/domain/presets.ts` (single source of truth); `ensurePresets` seeds the new row. Customer ID allocation moves from relying on SQLite `AUTOINCREMENT` to an explicit `MAX(1025, MAX(id)+1)` calculation in `createTool`, and existing installs are fixed by a new versioned schema release `2.1.0` that renumbers any custom tool below 1025 up by `+1024` (and rewrites `conversations.tool_id`).

**Tech Stack:** TypeScript, Vite, Chrome extension, OPFS SQLite (web-sqlite-js) at runtime; `node:sqlite` (built-in, Node 22) only for unit tests.

**Spec:** `docs/superpowers/specs/2026-08-26-english-preset-id-reservation-design.md` (approved 2026-08-26). §3 defines the prompt, §4 the ID allocation, §5 the migration.

**Design refinement found during planning (deviates from spec §5 wording, keeps §5 intent):** `ensurePresets`/`migrateLegacy` insert preset rows with `sort_order = id`. After the migration moves a customer tool out of slot 5, that tool may still hold `sort_order = 5`, and the new preset would then violate the unique partial index `idx_tools_active_order` (unique `sort_order` where not deleted). Fix: preset INSERT uses `sort_order = (SELECT COALESCE(MAX(sort_order),0)+1 FROM tools WHERE deleted_at IS NULL)`, appending presets to the end of display order (identical behavior on fresh installs).

---

### Task 1: Register the `english`（英英释义）preset

**Files:**
- Create: `src/dianzhi/domain/presetPrompts/translation-in-english.md`
- Modify: `src/dianzhi/domain/types.ts`
- Modify: `src/dianzhi/domain/presets.ts`
- Test: `tests/unit/dianzhi/presets.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dianzhi/presets.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  BUILTIN_PROMPTS,
  BUILTIN_TOOL_IDS,
  BUILTIN_TOOL_NAMES,
  CUSTOM_TOOL_ID_START,
  PRESET_ID_RESERVED_MAX,
  PRESET_TOOL_IDS,
} from '@/dianzhi/domain/presets'

describe('preset tool registry', () => {
  it('registers the english (英英释义) preset at id 5', () => {
    expect(BUILTIN_TOOL_IDS).toContain('english')
    expect(PRESET_TOOL_IDS.english).toBe(5)
    expect(BUILTIN_TOOL_NAMES.english).toBe('英英释义')
  })

  it('exposes the pure-English prompt with the context template and one Chinese line', () => {
    const prompt = BUILTIN_PROMPTS.english
    expect(prompt).toContain('# Language Policy')
    expect(prompt).toContain('{{context}}')
    expect(prompt).toContain('> Translation: 中文释义')
    expect(prompt).toContain('> Translation: 中文翻译')
  })

  it('keeps every preset id inside the reserved 1..1024 range', () => {
    for (const id of BUILTIN_TOOL_IDS) {
      expect(PRESET_TOOL_IDS[id]).toBeGreaterThanOrEqual(1)
      expect(PRESET_TOOL_IDS[id]).toBeLessThanOrEqual(PRESET_ID_RESERVED_MAX)
    }
    expect(CUSTOM_TOOL_ID_START).toBe(1025)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/dianzhi/presets.spec.ts`
Expected: FAIL — `PRESET_TOOL_IDS.english` is `undefined`, `.toBe(5)` fails, and `CUSTOM_TOOL_ID_START` is not exported.

- [ ] **Step 3: Create the prompt file**

Create `src/dianzhi/domain/presetPrompts/translation-in-english.md` with exactly this content (section order and language policy are binding; from spec §3.2):

````markdown
# Role

You are a context-aware reader's dictionary and English-language analyst. Your
job is to help English learners understand the **exactly selected text**
through English itself. Every part of your answer — definition, context note,
and grammar explanation — is written in simple, natural English, so the reader
stays immersed in English. Exactly one Chinese line (the Translation line) is
allowed per answer.

# Language Policy (most important)

- The whole answer is in English: definitions, notes, labels, and grammar.
- Exactly **one** Chinese line per answer — the Translation line:
  - Mode A: `> Translation: 中文释义`
  - Mode B: `> Translation: 中文翻译`
- No other Chinese anywhere in the answer.

# Input Structure

The input contains a `<context>...</context>` block with an inner
`<selected>...</selected>`:

```xml
<context>
...

<selected>the user's actually selected text</selected>

...
</context>
```

- `<context>` is the surrounding passage.
- Everything inside `<selected>` is the ONLY text to define and analyze.
- The rest of `<context>` is used only to understand: domain, senses, terms,
  collocations, references, tone, and logic. Do not translate, summarize, or
  explain anything outside `<selected>`.

# 1. Selected Text Boundary

Keep the exact `<selected>` span. Never shrink it, expand it, ignore part of
it, or pick a single keyword to represent it, and never add text from outside
`<selected>` to the answer.

# 2. Determine the Mode

- **Mode A (single word):** only when `<selected>`, after trimming whitespace
  and meaningless outer punctuation, is exactly one English word.
- **Mode B (multi-word):** everything else — two or more words, phrases,
  phrasal verbs, terms, clauses, full sentences, or multiple sentences.
- Once in Mode B, never extract one word and answer in Mode A.

# 3. Context-Aware Interpretation

Before answering, use the full `<context>` to decide what `<selected>` means
HERE. Sense priority: **current-context sense > domain sense > common
dictionary sense > literal reading.** Answer “what does this word, phrase, or
sentence mean in this place?”, not “what does it usually mean?”.

# 4. Phrase and Term Recognition

When `<selected>` holds multiple words, first check whether they form one unit:
an idiom, a collocation, a phrasal verb, a technical term, or a fixed grammar
pattern. Treat the unit as a whole; never translate word by word and stitch the
parts together.

# 5. Reference Resolution

If `<selected>` contains a pronoun (it, this, that, these, those, they, he,
she, which, such, …), resolve its referent from the surrounding
`<context>`. When the reference is clear, state the referent naturally in the
English note. If the context is genuinely ambiguous, keep reasonable ambiguity
and only explain it if needed.

# 6. Translation Principles — the single Chinese line

The Translation line must completely cover the meaning of `<selected>`, match
the current context, use standard domain terms, read naturally in Chinese,
keep the logical relations, and add nothing or omit nothing. Meaning accuracy
outranks literal form.

# 7. Mode A Output (single word)

Output in this order:

**[split·word]**

EN /British IPA/ · US /American IPA/

**[POS.] [one-sense English definition in plain learner-friendly English]**

The definition is the sense that fits this context, written in simple English.
POS abbreviations follow learner-dictionary conventions (n. vt. vi. v. adj.
adv. prep. conj. pron. art. num. interj. aux.); keep a space between the
abbreviation and the definition, and only mark the POS actually in use in this
context (e.g. `**adj.** able to be changed or modified`).

> Translation: 中文释义

##### In this context:

One short paragraph in English: what the word means here, why this sense is
chosen, and any domain-specific nuance or contrast (for example *mutable* vs
*immutable* in Rust).

##### Grammar:

Only if genuinely useful: POS role, what the word modifies, its syntactical
role, a collocation, or a term relation. Omit the whole section when there is
nothing worth explaining.

# 8. Word Splitting Rule

Single-word mode only. Split the headword like a learner's dictionary, using
`·` between displayed parts: `information → in·for·ma·tion`,
`mutable → mu·ta·ble`. This is display splitting only — not NLP segmentation,
root analysis, or prefix/suffix analysis — and it never applies in Mode B.
If a reliable dictionary split cannot be determined, do not invent a wrong one.

# 9. IPA Rule

Single-word mode only. Always output both pronunciations in the format
`EN /…/ · US /…/`, even when the British and American pronunciations are the
same. Never output IPA in Mode B, and never invent sounds that are not real IPA.

# 10. Mode B Output (multi-word / phrase / sentence)

Output in this order:

**[a natural, accurate English paraphrase of EVERYTHING inside `<selected>`]**

Write it in simple English and cover the whole selection, not a subset.

> Translation: 中文翻译

##### In this context:

One short English paragraph explaining what the whole `<selected>` means here —
terms, collocations, easily misread expressions, pronoun referents, important
implied logic. Explain only material directly tied to `<selected>`; do not
summarize the whole `<context>`.

##### Grammar:

Only the core structures that genuinely help understanding: the sentence
backbone, subject–verb–object, clauses, infinitives, participle structures,
modifiers, parentheses, fixed collocations, or pronoun reference. Do not parse
word by word. Omit the section when nothing valuable exists.

# 11. Conciseness

Keep the output compact, accurate, direct, and worth reading. Do not repeat
what is already clear, summarize the whole article, list unrelated senses,
pad with background, or explain the obvious.

# 12. Example — Mode A

Input:

```xml
<context>
Just as variables are immutable by default, so are references.
A <selected>mutable</selected> reference allows us to modify the borrowed value.
</context>
```

Output:

**mu·ta·ble**

EN /ˈmjuːtəbl/ · US /ˈmjuːtəbl/

**adj.** able to be changed or modified

> Translation: 可变的

##### In this context:

*Mutable* is the opposite of *immutable*; in Rust it describes a reference
whose borrowed value may be modified.

##### Grammar:

*Mutable* is an adjective modifying *reference*, forming the Rust term
*mutable reference*.

# 13. Example — Mode B

Input:

```xml
<context>
First, we change s to be mut. Then, we create a mutable reference with &mut s.

<selected>We can fix the code from Listing 4-6 to allow us to modify a borrowed value with just a few small tweaks that use, instead, a mutable reference</selected>
</context>
```

Output:

**A few small tweaks that replace the plain reference with a mutable reference
let us fix the code in Listing 4-6 and modify a borrowed value.**

> Translation: 我们只需要做几处小修改，改用可变引用，就可以修正代码清单 4-6 中的代码，使我们能够修改借用的值。

##### In this context:

The author explains how to adjust the earlier example: switching from an
ordinary reference to a *mutable reference* so the code may modify the
borrowed value.

##### Grammar:

The backbone is “We can fix the code”; the infinitive “to allow us to modify a
borrowed value” states the purpose, and “that use, instead, a mutable reference”
qualifies *tweaks*.

# 14. Final Validation

Before answering, check internally (do not output this process):

1. Is the full `<selected>` span kept exactly, and kept as the only analyzed text?
2. Is every prose part English, with the single Translation line as the only Chinese?
3. Is the mode recognized correctly — single word or multi-word?
4. Mode A: is there a split headword, EN and US IPA, a POS mark, an English definition, a Translation line, and a contextual note (plus an optional grammar note)?
5. Mode B: is there a full English paraphrase, a Translation line, a contextual note (plus an optional grammar note)? Was no word extracted, and no per-word split or IPA emitted?
6. Was the context actually used for sense disambiguation and term judgment?
7. Is anything obviously repeated or useless?
If any scope, mode, or format rule fails, fix it before answering.

# Input

{{context}}
````

- [ ] **Step 4: Implement the preset registration**

Modify `src/dianzhi/domain/types.ts` line 1:

```ts
export type BuiltinToolId = 'context' | 'synonyms' | 'translate' | 'dictionary' | 'english'
```

Replace the contents of `src/dianzhi/domain/presets.ts` with:

```ts
import type { BuiltinToolId } from './types'
import translate from './presetPrompts/translate-preset-prompt.md?raw'
import synonyms from './presetPrompts/thesaurus.md?raw'
import context from './presetPrompts/context.md?raw'
import dictionary from './presetPrompts/dictionary.md?raw'
import english from './presetPrompts/translation-in-english.md?raw'

export const PRESET_ID_RESERVED_MAX = 1024
export const CUSTOM_TOOL_ID_START = 1025

export const BUILTIN_PROMPTS: Readonly<Record<BuiltinToolId, string>> = {
  context,
  synonyms,
  translate,
  dictionary,
  english,
}

export const BUILTIN_TOOL_NAMES: Readonly<Record<BuiltinToolId, string>> = {
  context: '语境',
  synonyms: '同义词',
  translate: '翻译',
  dictionary: '词典',
  english: '英英释义',
}

export const PRESET_TOOL_IDS: Readonly<Record<BuiltinToolId, number>> = {
  context: 1,
  synonyms: 2,
  translate: 3,
  dictionary: 4,
  english: 5,
}

export const BUILTIN_TOOL_IDS: readonly BuiltinToolId[] = [
  'context',
  'synonyms',
  'translate',
  'dictionary',
  'english',
]
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/dianzhi/presets.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/dianzhi/domain/types.ts src/dianzhi/domain/presets.ts \
        src/dianzhi/domain/presetPrompts/translation-in-english.md \
        tests/unit/dianzhi/presets.spec.ts
git commit -m "feat(preset-tool): add 英英释义 (english) preset with pure-English prompt"
```

---

### Task 2: Verify composed settings with the 5th preset

**Files:**
- Test: `tests/unit/dianzhi/settings.spec.ts`

No production change expected: `settings.ts` derives `DEFAULT_TOOLS`, `validateSettings`, and `effectivePrompt` from the preset maps updated in Task 1.

- [ ] **Step 1: Write the test**

Create `tests/unit/dianzhi/settings.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  DEFAULT_TOOLS,
  effectivePrompt,
  validateSettings,
} from '@/dianzhi/domain/settings'
import { BUILTIN_PROMPTS } from '@/dianzhi/domain/presets'

describe('composed settings with the english preset', () => {
  it('builds a 5-tool default list including the english preset', () => {
    expect(DEFAULT_TOOLS).toHaveLength(5)
    const english = DEFAULT_TOOLS.find((tool) => tool.id === 5)
    expect(english?.name).toBe('英英释义')
    expect(english?.builtin).toBe(true)
    expect(english?.promptMode).toBe('preset')
    expect(DEFAULT_SETTINGS.tools).toHaveLength(5)
  })

  it('passes validation with the english preset present', () => {
    const result = validateSettings(DEFAULT_SETTINGS)
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it('resolves the english preset prompt through effectivePrompt', () => {
    const tool = {
      id: 5,
      name: '英英释义',
      builtin: true,
      enabled: true,
      isDefault: false,
      promptMode: 'preset',
      customPrompt: '',
    }
    expect(effectivePrompt(tool)).toBe(BUILTIN_PROMPTS.english)
  })
})
```

- [ ] **Step 2: Run test**

Run: `pnpm exec vitest run tests/unit/dianzhi/settings.spec.ts`
Expected: PASS (3 tests) — verifies `settings.ts` needs no change.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/dianzhi/settings.spec.ts
git commit -m "test(settings): cover the fifth preset in composition and validation"
```

---

### Task 3: Explicit customer-tool ID allocation

**Files:**
- Modify: `src/offscreen/database/config-store.ts` (`createTool`, remove `integerId`, `migrateLegacy` floor)
- Test: `tests/unit/offscreen/sqlite-helper.ts` (new)
- Test: `tests/unit/offscreen/config-store.spec.ts` (new)

- [ ] **Step 1: Write the SQLite test helper**

Create `tests/unit/offscreen/sqlite-helper.ts`:

```ts
import { DatabaseSync } from 'node:sqlite'
import { CONFIG_RELEASE, SCHEMA_RELEASE } from '@/offscreen/database/schema'
import type { DatabaseConnection, SqlParams, SqlValue } from '@/offscreen/database/store'

export interface NodeDb {
  db: DatabaseSync
  connection: DatabaseConnection
}

function toList(params: SqlParams | undefined): SqlValue[] {
  if (params === undefined) return []
  return Array.isArray(params) ? params : Object.values(params)
}

function bindValue(value: SqlValue): unknown {
  return typeof value === 'boolean' ? (value ? 1 : 0) : value
}

/**
 * Builds an in-memory SQLite database using the vendored release DDL and
 * wraps it in the app's DatabaseConnection contract so ConfigStore can run
 * against a real SQL engine in unit tests.
 */
export function createNodeDatabase(): NodeDb {
  const db = new DatabaseSync(':memory:')
  db.exec(SCHEMA_RELEASE.migrationSQL)
  db.exec(CONFIG_RELEASE.migrationSQL)

  const connection: DatabaseConnection = {
    async exec(sql, params) {
      const list = toList(params)
      if (list.length === 0) {
        db.exec(sql)
        return { changes: 0 }
      }
      const stmt = db.prepare(sql)
      const info = stmt.run(...list.map(bindValue))
      return { changes: info.changes, lastInsertRowid: info.lastInsertRowid }
    },
    async query<T>(sql: string, params?: SqlParams): Promise<T[]> {
      const list = toList(params)
      const stmt = db.prepare(sql)
      return stmt.all(...list.map(bindValue)) as T[]
    },
    async transaction<T>(callback: (tx: DatabaseConnection) => Promise<T>): Promise<T> {
      db.exec('BEGIN')
      try {
        const result = await callback(connection)
        db.exec('COMMIT')
        return result
      } catch (error) {
        db.exec('ROLLBACK')
        throw error
      }
    },
  }

  return { db, connection }
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/unit/offscreen/config-store.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { createConfigStore } from '@/offscreen/database/config-store'
import { createNodeDatabase } from './sqlite-helper'

const clock = () => '2026-08-26T00:00:00.000Z'

describe('ConfigStore customer-tool ID allocation', () => {
  it('allocates customer tool ids starting at 1025', async () => {
    const { connection } = createNodeDatabase()
    const config = createConfigStore(connection, clock)
    await config.ensurePresets()
    const first = await config.createTool({ name: '自定义1', prompt: 'p1' })
    expect(first.id).toBeGreaterThanOrEqual(1025)
    const second = await config.createTool({ name: '自定义2', prompt: 'p2' })
    expect(second.id).toBe(first.id + 1)
  })

  it('never returns a preset-range id even when the max row id is small', async () => {
    const { connection, db } = createNodeDatabase()
    const now = clock()
    ;(
      [
        [1, '语境'],
        [2, '同义词'],
        [3, '翻译'],
        [4, '词典'],
      ] as const
    ).forEach(([id, name]) => {
      db.prepare(
        `INSERT INTO tools (id, name, prompt, is_preset, is_default, enabled, sort_order, deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, 1, 0, 1, ?, NULL, ?, ?)`
      ).run(id, name, 'p', id, now, now)
    })
    const config = createConfigStore(connection, clock)
    const tool = await config.createTool({ name: '自定义', prompt: 'p' })
    expect(tool.id).toBeGreaterThanOrEqual(1025)
  })

  it('maps legacy custom tools onto ids >= 1025 and rewires conversations', async () => {
    const { connection, db } = createNodeDatabase()
    const now = clock()
    db.prepare(
      `INSERT INTO conversations (selection_key, tab_id, tool_id, tool_id_legacy, tool_name, title, selected_text, context_text, prompt_snapshot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(0, 1, 0, 'myCustom', '我的工具', 't', 's', 'c', 'p', now, now)
    const config = createConfigStore(connection, clock)
    const mapping = await config.migrateLegacy({
      legacySettings: {
        version: 1,
        ui: { defaultToolId: 'context' },
        tools: [
          {
            id: 'myCustom',
            name: '我的工具',
            builtin: false,
            enabled: true,
            customPrompt: 'hello',
          },
        ],
      },
    })
    expect(mapping.myCustom).toBeGreaterThanOrEqual(1025)
    const row = db
      .prepare('SELECT is_preset AS isPreset FROM tools WHERE id = ?')
      .get(mapping.myCustom) as { isPreset: number }
    expect(row.isPreset).toBe(0)
    const conv = db
      .prepare('SELECT tool_id AS toolId, tool_id_legacy AS toolIdLegacy FROM conversations')
      .get() as { toolId: number; toolIdLegacy: string | null }
    expect(conv.toolId).toBe(mapping.myCustom)
    expect(conv.toolIdLegacy).toBeNull()
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm exec vitest run tests/unit/offscreen/config-store.spec.ts`
Expected: FAIL — `first.id` is `5` (AUTOINCREMENT) instead of `>= 1025`; `mapping.myCustom` is `5`.

- [ ] **Step 4: Implement the allocation**

In `src/offscreen/database/config-store.ts`:

1. Add `CUSTOM_TOOL_ID_START` to the import from `'@/dianzhi/domain/presets'` (line 1–7 area):

```ts
import {
  BUILTIN_PROMPTS,
  BUILTIN_TOOL_IDS,
  BUILTIN_TOOL_NAMES,
  CUSTOM_TOOL_ID_START,
  PRESET_TOOL_IDS,
} from '@/dianzhi/domain/presets'
```

2. Delete the now-unused `integerId` helper (currently lines 82–92):

```ts
function integerId(value: number | bigint | undefined, operation: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1) {
    throw new DianzhiError({
      code: 'DB_UNAVAILABLE',
      message: `SQLite did not return a valid ID for ${operation}.`,
      context: { operation },
    })
  }
  return id
}
```

3. Replace `createTool` (currently lines 205–219) with:

```ts
  async function createTool(input: { name: string; prompt: string }): Promise<ToolRecord> {
    const now = clock()
    const id = await db.transaction(async (tx) => {
      const rows = await tx.query<{ maxId: number }>(
        'SELECT COALESCE(MAX(id), 0) AS maxId FROM tools'
      )
      const id = Math.max(CUSTOM_TOOL_ID_START, (rows[0]?.maxId ?? 0) + 1)
      await tx.exec(
        `INSERT INTO tools (id, name, prompt, is_preset, is_default, enabled, sort_order, deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, 0, 0, 1, (SELECT COALESCE(MAX(sort_order),0)+1 FROM tools WHERE deleted_at IS NULL), NULL, ?, ?)`,
        [id, input.name, input.prompt, now, now]
      )
      return id
    })
    const rows = await db.query<ToolRecord>(`SELECT ${TOOL_COLUMNS} FROM tools WHERE id = ?`, [id])
    const row = rows[0]
    if (!row) throw toolNotFound(id)
    return Object.freeze(normalizeToolRow(row))
  }
```

4. In `migrateLegacy`, change `let nextId = 4` (line ~389) to `let nextId = CUSTOM_TOOL_ID_START`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm exec vitest run tests/unit/offscreen/config-store.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the full suite to catch unrelated regressions**

Run: `pnpm exec vitest run`
Expected: all existing specs still PASS.

- [ ] **Step 7: Commit**

```bash
git add src/offscreen/database/config-store.ts \
        tests/unit/offscreen/sqlite-helper.ts tests/unit/offscreen/config-store.spec.ts
git commit -m "feat(tools): allocate customer tool ids from 1025 in createTool and migration"
```

---

### Task 4: Reservation migration release 2.1.0

**Files:**
- Modify: `src/offscreen/database/schema.ts` (add `TOOL_ID_RELEASE`)
- Modify: `src/offscreen/main.ts` (register the release)
- Modify: `src/offscreen/database/config-store.ts` (`PRESET_INSERT_SQL` sort_order)
- Test: `tests/unit/offscreen/migration-2-1-0.spec.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/offscreen/migration-2-1-0.spec.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { TOOL_ID_RELEASE } from '@/offscreen/database/schema'
import { createConfigStore } from '@/offscreen/database/config-store'
import { createNodeDatabase } from './sqlite-helper'

const clock = () => '2026-08-26T00:00:00.000Z'

describe('TOOL_ID_RELEASE 2.1.0', () => {
  it('declares a versioned release after 2.0.0', () => {
    expect(TOOL_ID_RELEASE.version).toBe('2.1.0')
    expect(TOOL_ID_RELEASE.migrationSQL).toContain('tool_floor_map')
    expect(TOOL_ID_RELEASE.migrationSQL).toContain('sqlite_sequence')
  })

  it('moves a pre-2.1.0 customer tool out of the reserved range and lets english insert at id 5', async () => {
    const { connection, db } = createNodeDatabase()
    const now = clock()
    // A pre-2.1.0 install: four presets plus a customer tool sitting at id 5.
    ;(
      [
        [1, '语境'],
        [2, '同义词'],
        [3, '翻译'],
        [4, '词典'],
      ] as const
    ).forEach(([id, name]) => {
      db.prepare(
        `INSERT INTO tools (id, name, prompt, is_preset, is_default, enabled, sort_order, deleted_at, created_at, updated_at)
         VALUES (?, ?, ?, 1, 0, 1, ?, NULL, ?, ?)`
      ).run(id, name, 'p', id, now, now)
    })
    db.prepare(
      `INSERT INTO tools (id, name, prompt, is_preset, is_default, enabled, sort_order, deleted_at, created_at, updated_at)
       VALUES (?, ?, ?, 0, 0, 1, ?, NULL, ?, ?)`
    ).run(5, '旧自定义', 'p', 5, now, now)
    db.prepare(
      `INSERT INTO conversations (selection_key, tab_id, tool_id, tool_name, title, selected_text, context_text, prompt_snapshot, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(0, 1, 5, '旧自定义', 't', 's', 'c', 'p', now, now)

    db.exec(TOOL_ID_RELEASE.migrationSQL)

    const moved = db
      .prepare('SELECT id FROM tools WHERE is_preset = 0 AND id >= 1025')
      .get() as { id: number }
    expect(moved.id).toBe(1029)
    const conv = db.prepare('SELECT tool_id AS toolId FROM conversations').get() as {
      toolId: number
    }
    expect(conv.toolId).toBe(1029)
    const presetCount = db
      .prepare('SELECT COUNT(*) AS count FROM tools WHERE is_preset = 1')
      .get() as { count: number }
    expect(presetCount.count).toBe(4)

    // ensurePresets can now seed the english preset at id 5 without colliding.
    const config = createConfigStore(connection, clock)
    await config.ensurePresets()
    const english = db
      .prepare('SELECT COUNT(*) AS count FROM tools WHERE id = 5 AND is_preset = 1')
      .get() as { count: number }
    expect(english.count).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run tests/unit/offscreen/migration-2-1-0.spec.ts`
Expected: FAIL — `TOOL_ID_RELEASE` is not exported. (The second test will also fail initially because the `5 旧自定义` tool is never moved; once the export exists, the first test starts passing.)

- [ ] **Step 3: Add the migration release**

In `src/offscreen/database/schema.ts`, append after the `CONFIG_RELEASE` export:

```ts
/**
 * Schema release 2.1.0: presets own tool ids 1..1024, customer-created
 * (custom) tools start at 1025. Any custom tool already sitting in the
 * reserved range is moved up by 1024 and conversations.tool_id follows;
 * the AUTOINCREMENT counter is lifted above the floor so a plain INSERT
 * can never reuse a preset id. Runs before runtime `ensurePresets`, which
 * can then seed the next preset (e.g. `english` at id 5) collision-free.
 */
export const TOOL_ID_RELEASE = {
  version: '2.1.0',
  migrationSQL: `
PRAGMA foreign_keys = ON;

CREATE TEMP TABLE tool_floor_map AS
SELECT id AS old_id, id + 1024 AS new_id
  FROM tools WHERE is_preset = 0 AND id < 1025;

UPDATE conversations
   SET tool_id = (SELECT new_id FROM tool_floor_map WHERE old_id = tool_id)
 WHERE tool_id IN (SELECT old_id FROM tool_floor_map);

UPDATE tools SET id = id + 1024 WHERE is_preset = 0 AND id < 1025;

UPDATE sqlite_sequence SET seq = MAX(seq, 1024) WHERE name = 'tools';
`,
} as const
```

- [ ] **Step 4: Register the release in the runtime**

In `src/offscreen/main.ts`, update the import (line 6) and the `releases` array (line 25):

```ts
import { CONFIG_RELEASE, SCHEMA_RELEASE, TOOL_ID_RELEASE } from './database/schema'
```

```ts
  const db = (await openDB('dianzhi.sqlite3', {
    debug: false,
    releases: [SCHEMA_RELEASE, CONFIG_RELEASE, TOOL_ID_RELEASE],
  })) as DatabaseConnection
```

- [ ] **Step 5: Prevent preset sort_order collisions when seeding `english` on an existing install**

In `src/offscreen/database/config-store.ts`, replace `PRESET_INSERT_SQL` (currently lines 64–66):

```ts
const PRESET_INSERT_SQL = `INSERT INTO tools (
  id, name, prompt, is_preset, is_default, enabled, sort_order, deleted_at, created_at, updated_at
) VALUES (?, ?, ?, 1, 0, 1, (SELECT COALESCE(MAX(sort_order),0)+1 FROM tools WHERE deleted_at IS NULL), NULL, ?, ?)`
```

and update its call site in `ensurePresetsInner` (currently lines 169–176) to drop the positional `id` argument that was previously passed as `sort_order`:

```ts
    await tx.exec(PRESET_INSERT_SQL, [
      id,
      BUILTIN_TOOL_NAMES[builtinId],
      BUILTIN_PROMPTS[builtinId],
      now,
      now,
    ])
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm exec vitest run tests/unit/offscreen/migration-2-1-0.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Run the full unit suite**

Run: `pnpm exec vitest run`
Expected: all specs PASS (presets, settings, config-store, migration, and existing suites).

- [ ] **Step 8: Commit**

```bash
git add src/offscreen/database/schema.ts src/offscreen/main.ts \
        src/offscreen/database/config-store.ts tests/unit/offscreen/migration-2-1-0.spec.ts
git commit -m "feat(schema): 2.1.0 release reserves preset ids 1-1024 for custom tool allocation"
```

---

### Task 5: Gates and final verification

**Files:** none expected — verification and, if needed, minor fixes.

- [ ] **Step 1: Format check**

Run: `pnpm run format:check`
Expected: no diffs reported. If it reports diffs, run `pnpm run format` (or the project formatter) and re-check.

- [ ] **Step 2: Lint and type check**

Run: `pnpm run lint`
Expected: no errors. If `TDD comment`/coverage style rules complain, fix only what is reported.

- [ ] **Step 3: Full unit test run**

Run: `pnpm run test`
Expected: all specs PASS.

- [ ] **Step 4: Production build**

Run: `pnpm run build`
Expected: build completes; `dist/` regenerated (source-generated, not hand-edited).

- [ ] **Step 5: Drift check**

Run `/drift-check` (project quality skill) and resolve any drift findings that point at source, tests, or docs changed by this plan.

- [ ] **Step 6: Final commit (if any fixes)**

```bash
git add -A
git commit -m "chore: post-implementation drift and gate fixes"
```

If nothing changed, skip this step.

---

## Self-Review Notes

- **Spec coverage:** §3 registration ⇢ Task 1; §4.1 constants ⇢ Task 1; §4.2 `createTool` ⇢ Task 3; §4.3 `migrateLegacy` floor ⇢ Task 3; §5 migration ⇢ Task 4 (+ sort_order refinement, documented above); §7 tests ⇢ Tasks 1–4.
- **The `sqlite_sequence` lift and `conversations.tool_id` rewrite are exercised in Task 4 Step 1 (second test).**
- **Commit style follows the repo's recent `feat(preset-tool): ...` convention.**