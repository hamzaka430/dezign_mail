-- Seed data for local development testing
-- Run: wrangler d1 execute dezignmail-production --local --file=./migrations/seed.sql

INSERT OR IGNORE INTO inbox_sessions (session_id, email_address, created_at, expires_at, ttl_seconds, is_active)
VALUES (
  'seed-session-001',
  'test.inbox.1234@dezignwise.online',
  datetime('now'),
  datetime('now', '+1 hour'),
  3600,
  1
);

INSERT OR IGNORE INTO email_messages (id, inbox_address, from_address, from_name, subject, body_text, body_html, received_at, is_read, has_attachments, size)
VALUES (
  'seed-msg-001',
  'test.inbox.1234@dezignwise.online',
  'welcome@github.com',
  'GitHub',
  'Verify your GitHub email address',
  'Hi! Please verify your email by clicking the link below. This link expires in 24 hours.',
  '<h2 style="font-family:sans-serif">Verify your GitHub email</h2><p>Hi! Please <a href="#">click here</a> to verify your email. This link expires in 24 hours.</p>',
  datetime('now', '-5 minutes'),
  0,
  0,
  1248
);

INSERT OR IGNORE INTO email_messages (id, inbox_address, from_address, from_name, subject, body_text, body_html, received_at, is_read, has_attachments, size)
VALUES (
  'seed-msg-002',
  'test.inbox.1234@dezignwise.online',
  'noreply@discord.com',
  'Discord',
  'Your Discord verification code: 847291',
  'Your verification code is: 847291 — expires in 10 minutes. If you didn''t request this, ignore this email.',
  '<div style="font-family:sans-serif;max-width:480px"><h3>Your Discord verification code</h3><p style="font-size:32px;font-weight:bold;letter-spacing:8px">847291</p><p style="color:#666">Expires in 10 minutes.</p></div>',
  datetime('now', '-20 minutes'),
  1,
  0,
  892
);
