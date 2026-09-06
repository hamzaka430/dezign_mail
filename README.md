# Dezignmail — Temporary Email Service

Real-looking disposable email on **healthtek.eu.cc** — powered entirely by Cloudflare (Pages + Email Routing + D1 + R2). **No VPS required.**

## Architecture

```
Email Sender (SMTP)
        │
        ▼
Cloudflare Email Routing (catch-all for healthtek.eu.cc)
        │
        ▼
Cloudflare Worker (functions/scheduled.ts + src/handlers/emailHandler.ts)
        │  postal-mime parses raw MIME
        │
        ├── emails table  →  Cloudflare D1 (SQLite)
        └── attachments   →  Cloudflare R2 (object storage)
        │
        ▼
Cloudflare Pages (SPA + Hono API in functions/api/[[route]].ts)
        │
        ▼
Browser (Vanilla JS — polls /api/emails/:address every 5s)
```

## One-Command Deploy

```bash
npm run deploy
```

## Required Setup

### 1. Cloudflare D1 (email database)

```bash
npm run db:create        # creates "dezignmail-d1", copy the database_id
# → update wrangler.toml [[d1_databases]] database_id
npm run db:schema        # creates emails + attachments tables
npm run db:indexes       # creates performance indexes
```

### 2. Cloudflare R2 (attachment storage)

```bash
npm run r2:create          # creates "dezignmail-attachments" bucket
npm run r2:create-preview  # creates preview bucket for local dev
```

### 3. Cloudflare Email Routing

1. Go to your Cloudflare Dashboard → select `healthtek.eu.cc` domain
2. Navigate to **Email → Email Routing**
3. Enable Email Routing (follow the MX record setup wizard)
4. Under **Routing Rules**, add a **Catch-all** rule:
   - Action: **Send to a Worker**
   - Worker: select `dezignmail` (deployed via `npm run deploy`)
5. Save

> Cloudflare automatically configures MX records and basic SPF. Add DKIM/DMARC via the Email Routing UI for better deliverability.

### 4. Environment Variables (optional secrets)

```bash
# Telegram logging (optional)
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
```

### 5. Deploy

```bash
npm run deploy
```

Test: `GET https://dezignmail.pages.dev/api/health`

---

## API Reference

### Email Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/domains | List allowed domains |
| GET | /api/health | Health check |
| GET | /api/address/generate | Generate a random address |
| GET | /api/emails/:address | List emails for an address |
| GET | /api/emails/:address/count | Count emails for an address |
| DELETE | /api/emails/:address | Delete all emails for an address |
| GET | /api/inbox/:emailId | Get full email content |
| DELETE | /api/inbox/:emailId | Delete a single email |

### Attachment Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/inbox/:emailId/attachments | List attachments for an email |
| GET | /api/attachments/:attachmentId | Download an attachment |
| DELETE | /api/attachments/:attachmentId | Delete an attachment |

### Legacy Compat Endpoints (for old frontend)

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/inbox/create | Create/generate inbox address |
| GET | /api/inbox/:address | Get inbox status |
| GET | /api/inbox/:address/messages | List messages (legacy format) |
| GET | /api/inbox/:address/messages/:msgId | Get message (legacy format) |
| DELETE | /api/inbox/:address/messages/:msgId | Delete message |
| DELETE | /api/inbox/:address | Delete inbox |
| POST | /api/inbox/:address/extend | No-op (no TTL in new model) |

---

## What Changed from v1

| Feature | Old (v1) | New (v2) |
|---------|----------|----------|
| Email ingestion | DigitalOcean VPS + Postfix + pipe script | Cloudflare Email Routing + Worker |
| Database | Neon PostgreSQL (external) | Cloudflare D1 (built-in SQLite) |
| Attachments | Not supported | Cloudflare R2 (up to 50 MB/file) |
| Sessions/TTL | DB rows with expires_at | No TTL — emails until deleted |
| Cost | ~$6/month (VPS) | $0 (free tier) |
| No VPS | ❌ | ✅ |

---

## Local Development

```bash
npm install
cp .env.example .dev.vars  # fill in values
npm run build
npm run dev                 # wrangler pages dev
```

> Email routing cannot be tested locally. Use the `/api/health` endpoint and test email insertion via the API or D1 console.
