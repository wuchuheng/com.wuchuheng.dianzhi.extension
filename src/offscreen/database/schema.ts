export const SCHEMA_RELEASE = {
  version: '1.0.0',
  migrationSQL: `
PRAGMA foreign_keys = ON;

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
`,
} as const

/**
 * Schema release 2.0.0: config tables plus an INTEGER rebuild of
 * `conversations.tool_id`. No `seedSQL` — preset rows are created by the
 * typed `ensurePresets` op so `presets.ts` stays the single source of truth.
 */
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
-- The UNIQUE(selection_key, tool_id) constraint is deliberately deferred out
-- of this rebuild: at the copy stage every row is staged at tool_id = 0 while
-- a v1 selection may hold multiple tool conversations (v1's unique pair used
-- TEXT tool ids). migrateLegacy recreates the index after remapping.
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
  updated_at       TEXT NOT NULL
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

/**
 * Schema release 2.1.0: presets own tool ids 1..1024, customer-created
 * (custom) tools start at 1025. Any custom tool already sitting in the
 * reserved range is moved up by 1024 and conversations.tool_id follows.
 * The `tools` AUTOINCREMENT counter is lifted to at least 1024 as a
 * defensive backstop so even a plain INSERT (no explicit id) stays at or
 * above the floor; the floor itself is enforced primarily by the
 * explicit-id allocation in `createTool`/`migrateLegacy`, which always
 * allocate `MAX(1025, maxId + 1)`. Runs before runtime `ensurePresets`,
 * which can then seed the next preset (e.g. `english` at id 5)
 * collision-free. The `+1024` renumber can only abort outright (PRIMARY
 * KEY violation surfacing as a DB-open failure) if a custom tool already
 * holds an id `>= 1029` while another sits below 1025 — that requires
 * ~1021 lifetime AUTOINCREMENT-allocated custom ids (soft-removed rows
 * keep their ids), effectively unreachable.
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

DROP TABLE IF EXISTS tool_floor_map;
`,
} as const

/** Schema release 2.2.0: stores the final UI-estimated output throughput. */
export const MESSAGE_THROUGHPUT_RELEASE = {
  version: '2.2.0',
  migrationSQL: `
ALTER TABLE messages
  ADD COLUMN estimated_throughput_tps INTEGER
  CHECK (estimated_throughput_tps IS NULL OR estimated_throughput_tps >= 0);
`,
} as const

/**
 * Schema release 2.3.0: replaces implicit selection-key conversation groups
 * with explicit selection-session aggregate roots.
 */
export const SELECTION_SESSION_RELEASE = {
  version: '2.3.0',
  migrationSQL: `
PRAGMA foreign_keys = ON;

CREATE TEMP TABLE selection_session_roots AS
SELECT selection_key AS session_id, selection_key AS active_conversation_id
FROM conversations
GROUP BY selection_key;

CREATE TABLE selection_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  active_conversation_id INTEGER
    REFERENCES conversations(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO selection_sessions (id, active_conversation_id, created_at, updated_at)
SELECT selection_key, NULL, MIN(created_at), MAX(updated_at)
FROM conversations
GROUP BY selection_key;

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

INSERT INTO conversations_new (
  id, selection_session_id, tab_id, tool_id, tool_name, title, selected_text,
  context_text, prompt_snapshot, created_at, updated_at
)
SELECT id, selection_key, tab_id, tool_id, tool_name, title, selected_text,
  context_text, prompt_snapshot, created_at, updated_at
FROM conversations;

CREATE TABLE messages_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id   INTEGER NOT NULL REFERENCES conversations_new(id) ON DELETE CASCADE,
  sequence           INTEGER NOT NULL,
  role               TEXT NOT NULL CHECK(role IN ('user', 'assistant')),
  content            TEXT NOT NULL DEFAULT '',
  reasoning_content  TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL CHECK(status IN ('pending', 'streaming', 'completed', 'error', 'stopped')),
  error_code          TEXT,
  error_message       TEXT,
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL,
  estimated_throughput_tps INTEGER
    CHECK (estimated_throughput_tps IS NULL OR estimated_throughput_tps >= 0),
  UNIQUE(conversation_id, sequence)
);

INSERT INTO messages_new (
  id, conversation_id, sequence, role, content, reasoning_content, status,
  error_code, error_message, created_at, updated_at, estimated_throughput_tps
)
SELECT id, conversation_id, sequence, role, content, reasoning_content, status,
  error_code, error_message, created_at, updated_at, estimated_throughput_tps
FROM messages;

DROP TABLE messages;
DROP TABLE conversations;

ALTER TABLE conversations_new RENAME TO conversations;
ALTER TABLE messages_new RENAME TO messages;

UPDATE selection_sessions
SET active_conversation_id = (
  SELECT active_conversation_id
  FROM selection_session_roots
  WHERE session_id = selection_sessions.id
);

DROP TABLE selection_session_roots;

CREATE INDEX idx_conversations_tab_session
  ON conversations(tab_id, selection_session_id);
CREATE INDEX idx_messages_conversation_sequence
  ON messages(conversation_id, sequence);
`,
} as const
