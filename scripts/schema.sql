CREATE TABLE IF NOT EXISTS inboxes (
  id TEXT PRIMARY KEY,
  address TEXT UNIQUE NOT NULL,
  alias TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  inbox_id TEXT REFERENCES inboxes(id) ON DELETE CASCADE,
  inbox_address TEXT NOT NULL,
  from_address TEXT,
  subject TEXT,
  body_html TEXT,
  body_text TEXT,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  is_read BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_messages_inbox ON messages(inbox_address);
CREATE INDEX IF NOT EXISTS idx_inboxes_expires ON inboxes(expires_at);
CREATE INDEX IF NOT EXISTS idx_inboxes_active ON inboxes(is_active);