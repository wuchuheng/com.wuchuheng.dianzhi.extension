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
