-- Dezignmail D1 Indexes
-- Apply with: wrangler d1 execute dezignmail-d1 --file sql/indexes.sql --remote

-- Fast inbox lookup (primary query: filter by to_address, sort newest first)
CREATE INDEX IF NOT EXISTS idx_emails_to_address_received_at
    ON emails (to_address, received_at DESC);

-- Cleanup cron: delete emails older than N hours
CREATE INDEX IF NOT EXISTS idx_emails_cleanup
    ON emails (received_at);

-- Attachment lookup by email
CREATE INDEX IF NOT EXISTS idx_attachments_email_id
    ON attachments (email_id);

CREATE INDEX IF NOT EXISTS idx_attachments_created_at
    ON attachments (created_at DESC);
