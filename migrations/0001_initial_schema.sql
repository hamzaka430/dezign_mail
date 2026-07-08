-- Dezignmail Database Schema
-- Run: wrangler d1 migrations apply dezignmail-production --local

-- Inbox sessions table
CREATE TABLE IF NOT EXISTS inbox_sessions (
  session_id    TEXT PRIMARY KEY,
  email_address TEXT UNIQUE NOT NULL,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at    DATETIME NOT NULL,
  ttl_seconds   INTEGER NOT NULL DEFAULT 600,
  is_active     INTEGER NOT NULL DEFAULT 1
);

-- Email messages table
CREATE TABLE IF NOT EXISTS email_messages (
  id              TEXT PRIMARY KEY,
  inbox_address   TEXT NOT NULL,
  from_address    TEXT NOT NULL,
  from_name       TEXT,
  subject         TEXT NOT NULL DEFAULT '(no subject)',
  body_text       TEXT,
  body_html       TEXT,
  received_at     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_read         INTEGER NOT NULL DEFAULT 0,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  size            INTEGER NOT NULL DEFAULT 0,
  raw_headers     TEXT,
  FOREIGN KEY (inbox_address) REFERENCES inbox_sessions(email_address) ON DELETE CASCADE
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_sessions_email    ON inbox_sessions(email_address);
CREATE INDEX IF NOT EXISTS idx_sessions_expires  ON inbox_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_active   ON inbox_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_messages_inbox    ON email_messages(inbox_address);
CREATE INDEX IF NOT EXISTS idx_messages_received ON email_messages(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_read     ON email_messages(is_read);
