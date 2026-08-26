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

| Decision               | Choice                                                                                                                                              | Rationale                                                                                                      |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| New preset identity    | key `english`, display name `英英释义`, preset id **5**                                                                                             | Next free slot in the reserved preset range; “英英释义” is the standard term for explaining English in English |
| Prompt language        | Prompt file written in **English**; model prose output English; Chinese only in the Translation section                                             | Matches the tool's immersion purpose (user-confirmed)                                                          |
| Preset id range        | Presets own `1..1024`; custom tools start at `1025`                                                                                                 | Headroom for future presets; unambiguous allocator                                                             |
| Custom id allocation   | `createTool` computes `id = MAX(1025, MAX(id)+1)` inside a transaction and inserts explicitly                                                       | Removes reliance on `sqlite_sequence`; deterministic and collision-safe                                        |
| Existing-install setup | New schema release `2.1.0` renumbers custom tools with `id < 1025` up `+1024`, rewrites `conversations.tool_id`, bumps `sqlite_sequence` to `≥1024` | One-time, idempotent, pure-SQL; keeps the reserved floor empty for future presets                              |
| Prompt source of truth | Stays `src/dianzhi/domain/presets.ts` via `tools.ensurePresets`; **no `seedSQL` literals**                                                          | Unchanged from the config-in-sqlite §2 decision                                                                |

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

**Product goal (decided 2026-08-26):** English immersion. The learner reads
and understands the selection through English itself and is never routed back
through Chinese — except for exactly one permitted support line.

**Language policy (hard rule):** every definition, note, label, heading, and
grammar section is written in **simple, natural, learner-friendly English**.
The output contains exactly **one** Chinese line per answer — the Translation
line (`> Translation: 中文释义` for a single word, `> Translation: 中文翻译`
otherwise). No other Chinese anywhere.

**Complete feature port.** Every section of `translate-preset-prompt.md`
(§1–§15) is carried over with its behavior unchanged, output language English:

| Original section                | English-output version                                                                                                                                               |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                            | “Context-aware reader's dictionary and English-language analyst”; explains the selection in English; one CN Translation line allowed                                 |
| Input Structure                 | Same `<context>` / `<selected>` contract, written in English                                                                                                         |
| §1 Selected Text Boundary       | Identical: never shrink/expand/ignore `<selected>` or add outside text                                                                                               |
| §2 Determine the Mode           | Mode A (exactly one English word) vs Mode B (everything else); never downgrade B → A                                                                                 |
| §3 Context-Aware Interpretation | Sense priority: context > domain > dictionary > literal; answers “what does it mean _here_”                                                                          |
| §4 Phrase and Term Recognition  | Idioms, collocations, phrasal verbs, terms, fixed patterns treated as one unit                                                                                       |
| §5 Reference Resolution         | Pronouns (`it/this/that/these/those/they/he/she/which/such`) resolved from context; referent stated naturally in the English note                                    |
| §6 Translation Principles       | Applied to the single Chinese Translation line: full coverage, natural Chinese, contextual, no additions/omissions                                                   |
| §7 Mode A Output                | `[split·word]` → `EN /…/ · US /…/` → `**[POS.] [English definition]**` → `> Translation: 中文释义` → `##### In this context:` (EN) → `##### Grammar:` (EN, optional) |
| §8 Word Splitting Rule          | `·` display splitting for single words only; never in Mode B                                                                                                         |
| §9 IPA Rule                     | EN + US IPA for single words only; identical-format when same                                                                                                        |
| §10 Mode B Output               | `[English paraphrase of the whole selection]` → `> Translation: 中文翻译` → `##### In this context:` (EN) → `##### Grammar:` (EN, optional)                          |
| §11 Conciseness                 | Compact, direct, no padding, no unrelated senses, no full-article summary                                                                                            |
| §12/13 Examples                 | Mode A and Mode B worked examples with English output                                                                                                                |
| §14 Final Validation            | Internal checklist incl. “is the only Chinese the Translation line?”                                                                                                 |

**Deliberate deviation from the original:** IPA labels use `EN`/`US` instead of
英/美 so every label stays English.

**Worked examples (design-approved 2026-08-26):**

_Mode A — `<selected>mutable</selected>` in a Rust passage:_

```
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
```

_Mode B — a full-sentence selection:_

```
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
```

**Draft `presetPrompts/translation-in-english.md`** — the implementation shall
produce this file (section order and language policy are binding):

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
chosen, and any domain-specific nuance or contrast (for example _mutable_ vs
_immutable_ in Rust).

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

_Mutable_ is the opposite of _immutable_; in Rust it describes a reference
whose borrowed value may be modified.

##### Grammar:

_Mutable_ is an adjective modifying _reference_, forming the Rust term
_mutable reference_.

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
ordinary reference to a _mutable reference_ so the code may modify the
borrowed value.

##### Grammar:

The backbone is “We can fix the code”; the infinitive “to allow us to modify a
borrowed value” states the purpose, and “that use, instead, a mutable reference”
qualifies _tweaks_.

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

## 4. ID reservation

### 4.1 Constants (`src/dianzhi/domain/presets.ts`)

```ts
export const PRESET_ID_RESERVED_MAX = 1024 // presets own ids 1..1024
export const CUSTOM_TOOL_ID_START = 1025 // first id a custom tool may use
```

### 4.2 `createTool` (`src/offscreen/database/config-store.ts`)

Replace reliance on `lastInsertRowid`. Inside the existing transaction:

```ts
const rows = await tx.query<{ maxId: number }>('SELECT COALESCE(MAX(id), 0) AS maxId FROM tools')
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

| Path                                                                        | Change                                          |
| --------------------------------------------------------------------------- | ----------------------------------------------- |
| `src/dianzhi/domain/types.ts`                                               | add `'english'` to `BuiltinToolId`              |
| `src/dianzhi/domain/presets.ts`                                             | new import, 3 maps, 2 id constants              |
| `src/dianzhi/domain/presetPrompts/translation-in-english.md`                | **new** prompt file                             |
| `src/offscreen/database/schema.ts`                                          | new `CONFIG_RELEASE` `2.1.0`                    |
| `src/offscreen/database/config-store.ts`                                    | `createTool` explicit id; `migrateLegacy` floor |
| `tests/unit/**`                                                             | new specs per §7                                |
| `docs/superpowers/specs/2026-08-26-english-preset-id-reservation-design.md` | this document                                   |

## 9. Non-goals

- Do not rename existing presets or renumber their ids.
- Do not change shared prompt machinery (`fillTemplate`, content-side context
  construction, streaming, messaging).
- Do not add a configurable prompt-editor behavior change.
