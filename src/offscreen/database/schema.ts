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
