-- Dezignmail D1 Schema
-- Apply with: wrangler d1 execute dezignmail-d1 --file sql/schema.sql --remote

CREATE TABLE IF NOT EXISTS emails (
    id              TEXT     PRIMARY KEY,
    from_address    TEXT     NOT NULL,
    to_address      TEXT     NOT NULL,
    subject         TEXT,
    received_at     INTEGER  NOT NULL,   -- Unix timestamp (seconds)
    html_content    TEXT,
    text_content    TEXT,
    has_attachments INTEGER  NOT NULL DEFAULT 0,  -- 0/1 (SQLite boolean)
    attachment_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS attachments (
    id           TEXT     PRIMARY KEY,
    email_id     TEXT     NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
    filename     TEXT     NOT NULL,
    content_type TEXT     NOT NULL,
    size         INTEGER  NOT NULL,
    r2_key       TEXT     NOT NULL,
    created_at   INTEGER  NOT NULL    -- Unix timestamp (seconds)
);
