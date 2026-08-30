# Dezignmail — Temporary Email Service

Real-looking disposable email on healthtek.eu.cc

## One-Command Deploy

npm run deploy

## Required Setup

### 1. Cloudflare — Set Environment Variables

wrangler secret put DATABASE_URL
wrangler secret put POSTFIX_WEBHOOK_SECRET

### 2. Neon DB Setup

1. Create a project at neon.tech
2. Create a database named `dezignmail`
3. Run `scripts/schema.sql` in the Neon SQL editor
4. Copy the connection string (pooled, HTTP mode) → set as DATABASE_URL

### 3. DigitalOcean VPS — Postfix Setup

ssh root@YOUR_VPS_IP
bash scripts/setup-postfix.sh

### 4. Cloudflare DNS Records

Add all records from `scripts/dns-records.txt` in Cloudflare DNS dashboard.
Proxy status: MX and TXT records = DNS only (grey cloud). A record for mail = DNS only.

### 5. Test Email Delivery

Send an email to any-address@healthtek.eu.cc and check:
GET https://dezignmail.pages.dev/api/health

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/inbox/create | Create new inbox |
| GET | /api/inbox/:id | Get inbox info |
| GET | /api/inbox/:id/messages | List messages |
| GET | /api/inbox/:id/messages/:msgId | Get single message |
| DELETE | /api/inbox/:id/messages/:msgId | Delete message |
| DELETE | /api/inbox/:id | Delete inbox |
| POST | /api/inbox/:id/extend | Extend by 1 hour |
| POST | /api/receive | Postfix webhook (auth required) |
| GET | /api/health | Health check |
| GET | /api/domains | Available domains |