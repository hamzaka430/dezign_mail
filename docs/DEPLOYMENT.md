# Dezignmail v2 — Full Deployment Guide

## Architecture Overview

```
Email Sender
      │  SMTP
      ▼
Cloudflare Email Routing (healthtek.eu.cc catch-all)
      │  Forwards raw MIME to Worker
      ▼
Cloudflare Worker  ← src/handlers/emailHandler.ts
      │  postal-mime parses message
      ├──► Cloudflare D1   (emails + attachments metadata)
      └──► Cloudflare R2   (attachment binary files)
      │
      ▼
Cloudflare Pages  ← functions/api/[[route]].ts  (Hono REST API)
      │
      ▼
Browser SPA  ← public/index.html  (polls every 5 seconds)
```

---

## Part 1 — Project Setup

### 1.1 Prerequisites

- Node.js 18+ and npm
- Wrangler CLI (included as dev dependency): `npx wrangler login`
- Cloudflare account with a domain added (e.g. `healthtek.eu.cc`)

### 1.2 Install Dependencies

```bash
npm install
```

### 1.3 Login to Cloudflare

```bash
npx wrangler login
```

---

## Part 2 — Cloudflare D1 Setup (Email Database)

### 2.1 Create D1 Database

```bash
npm run db:create
# Output includes database_id — copy it
```

### 2.2 Update wrangler.toml

Open `wrangler.toml` and replace `PLACEHOLDER_D1_ID` with the actual `database_id`:

```toml
[[d1_databases]]
binding       = "D1"
database_name = "dezignmail-d1"
database_id   = "your-actual-id-here"
```

### 2.3 Apply Schema and Indexes

```bash
npm run db:schema    # creates emails and attachments tables
npm run db:indexes   # adds performance indexes
```

---

## Part 3 — Cloudflare R2 Setup (Attachment Storage)

```bash
npm run r2:create          # production bucket
npm run r2:create-preview  # local dev preview bucket
```

No further configuration needed — the bucket name is already in `wrangler.toml`.

---

## Part 4 — Cloudflare Email Routing Setup

This replaces the old Postfix VPS entirely.

### 4.1 Enable Email Routing

1. Go to **Cloudflare Dashboard** → select your domain
2. Navigate to **Email → Email Routing**
3. Click **Get started** and follow the wizard
4. Cloudflare will add the required MX records automatically

### 4.2 Configure Catch-All Rule

1. In Email Routing, go to **Routing Rules**
2. Under **Catch-all address**, click **Edit**
3. Set Action to **Send to a Worker**
4. Select your Worker (`dezignmail`)
5. Click **Save**

> Now ALL emails to `@healthtek.eu.cc` will be received by the Worker.

### 4.3 Add DKIM / DMARC (Recommended)

In Cloudflare Email Routing → **DKIM** tab — follow the setup wizard to generate and add DKIM keys.

Add a DMARC record manually in DNS:

| Type | Name | Value |
|------|------|-------|
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:admin@healthtek.eu.cc` |

---

## Part 5 — Deploy

### 5.1 Build and Deploy

```bash
npm run deploy
```

Your app will be live at `https://dezignmail.pages.dev`

### 5.2 Set Optional Secrets

```bash
# Telegram notifications for cleanup cron (optional)
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
```

### 5.3 Verify

```bash
# Health check
curl https://dezignmail.pages.dev/api/health

# List domains
curl https://dezignmail.pages.dev/api/domains

# Generate an address
curl https://dezignmail.pages.dev/api/address/generate
```

---

## Part 6 — Testing Email Delivery

### 6.1 Send a Test Email

Send an email to any address `@healthtek.eu.cc` from any mail client.

### 6.2 Check via API

```bash
# Replace with the address you sent to
curl "https://dezignmail.pages.dev/api/emails/swift.fox.1234@healthtek.eu.cc"
```

### 6.3 Check Email Routing Logs

In Cloudflare Dashboard → Email → Email Routing → **Activity log** — you can see all recent routing events.

---

## Part 7 — Auto-Cleanup (Cron)

The Worker has a scheduled cron that runs **every 2 hours** and deletes emails older than `HOURS_TO_DELETE` (default: 3 hours).

To change the retention window, update `wrangler.toml`:

```toml
[vars]
HOURS_TO_DELETE = 24    # keep emails for 24 hours
```

---

## Cost Estimate

| Service | Plan | Cost |
|---------|------|------|
| Cloudflare Pages | Free | $0/month |
| Cloudflare D1 | Free (5 GB, 5M reads/day) | $0/month |
| Cloudflare R2 | Free (10 GB, 1M ops/month) | $0/month |
| Cloudflare Email Routing | Free | $0/month |
| Domain (healthtek.eu.cc) | Annual renewal | ~$10/year |
| **Total** | | **~$0/month** |

---

## Security Notes

1. **No webhook secret needed** — Email Routing is authenticated by Cloudflare natively
2. **XSS protection** — HTML email bodies are rendered in sandboxed `<iframe srcdoc>` elements
3. **CORS** — restrict `origin` in `functions/api/[[route]].ts` to your domain in production
4. **Attachment limits** — 50 MB per file, 10 files per email, allowlist of MIME types
5. **Auto-cleanup** — emails are automatically deleted after `HOURS_TO_DELETE` hours
