# Dezignmail

**Professional disposable email service by [Dezignwise](https://dezignwise.com)**

A production-ready, SaaS-grade temporary email service built entirely on Cloudflare's edge infrastructure — no VPS, no traditional servers, no maintenance overhead.

🌐 **Live:** [https://dezignmail.eu.cc](https://dezignmail.eu.cc)

---

## Overview

Dezignmail provides instant, disposable email inboxes with real MX, SPF, DKIM, and DMARC records. Unlike most disposable email services that use misconfigured domains and get blocked immediately, Dezignmail uses Cloudflare Email Routing with proper DNS configuration — so addresses actually work on real-world services.

---

## Architecture

```
Email Sender (SMTP)
        │
        ▼
Cloudflare Email Routing
(MX: route1/2/3.mx.cloudflare.net)
        │
        ▼
dezignmail-email Worker          ← email/ handler (email-worker/)
  └── postal-mime parses SMTP
  └── D1: stores email metadata
  └── R2: stores attachments
        │
        ▼
Cloudflare D1 (SQLite)  ←→  Cloudflare R2 (Object Storage)
        │
        ▼
dezignmail Pages Worker          ← fetch handler (src/index.ts)
  └── Hono REST API (/api/*)
  └── Static frontend (public/)
        │
        ▼
Browser (Vanilla JS — polls /api/emails/:address every 5s)
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla HTML/CSS/JS — single file SPA |
| API | [Hono](https://hono.dev) on Cloudflare Pages Worker |
| Email ingest | Cloudflare Email Routing + Email Worker |
| Email parsing | [postal-mime](https://github.com/postalsys/postal-mime) |
| Database | Cloudflare D1 (SQLite at the edge) |
| File storage | Cloudflare R2 (S3-compatible object storage) |
| Hosting | Cloudflare Pages |
| Language | TypeScript |

---

## Project Structure

```
dezignmail/
├── src/
│   ├── index.ts              # Main Hono app (Worker entry point)
│   ├── types.ts              # Env type definitions
│   ├── database/
│   │   ├── d1.ts             # D1 CRUD helpers
│   │   └── r2.ts             # R2 store/get/delete helpers
│   ├── handlers/
│   │   └── emailHandler.ts   # Email ingest logic (reference)
│   ├── utils/
│   │   └── helpers.ts        # now(), generateId(), sanitizeHtml()
│   └── config/
│       └── constants.ts      # Attachment limits
├── email-worker/
│   ├── src/index.ts          # Standalone Email Worker (email handler)
│   ├── wrangler.toml         # Email Worker config (D1 + R2 bindings)
│   └── package.json
├── functions/
│   └── api/[[route]].ts      # Pages Functions fallback
├── public/
│   ├── index.html            # Complete SaaS frontend (SPA)
│   └── _routes.json          # Route config: /api/* → Worker, rest → CDN
├── sql/
│   ├── schema.sql            # D1 table definitions
│   └── indexes.sql           # D1 indexes
├── wrangler.toml             # Pages app config
├── vite.config.ts            # Build config
└── tsconfig.json
```

---

## Features

- ⚡ **Instant inbox** — one click, no signup, no forms
- 🌐 **Multiple domains** — dezignmail.eu.cc, dezignwisemail.eu.cc, healthtek.eu.cc
- 🎯 **Custom alias** — choose your own prefix (e.g. `yourname@dezignmail.eu.cc`)
- 🛡️ **Real email infra** — MX, SPF, DKIM, DMARC configured on all domains
- 📎 **Attachment support** — files stored in Cloudflare R2
- 🔒 **Zero tracking** — no accounts, no cookies, no analytics
- 🗑️ **Auto-cleanup** — emails deleted after 3 hours automatically
- 📱 **Fully responsive** — works on mobile and desktop

---

## Pages

| Page | Description |
|------|-------------|
| Home | Inbox generator with domain selector |
| Features | Full feature breakdown |
| How it works | Architecture and data flow explanation |
| About | Dezignwise company info |
| Contact | Contact form + email addresses |
| Privacy Policy | GDPR-aligned data handling policy |
| Terms of Service | Acceptable use and liability terms |

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/health` | Health check + DB status |
| `GET` | `/api/domains` | List allowed email domains |
| `POST` | `/api/inbox/create` | Create a new inbox |
| `GET` | `/api/emails/:address` | List emails for an address |
| `GET` | `/api/emails/:address/count` | Count emails |
| `DELETE` | `/api/emails/:address` | Delete entire inbox |
| `GET` | `/api/inbox/:emailId` | Get single email |
| `DELETE` | `/api/inbox/:emailId` | Delete single email |
| `GET` | `/api/inbox/:emailId/attachments/:attId` | Download attachment |

### POST `/api/inbox/create`

```json
{
  "custom_alias": "yourname",
  "domain": "dezignmail.eu.cc"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "email_address": "yourname@dezignmail.eu.cc",
    "session_id": "yourname@dezignmail.eu.cc"
  }
}
```

---

## Self-Hosting Guide

### Prerequisites

- Cloudflare account (free tier works)
- A domain managed on Cloudflare DNS
- Node.js 18+ and npm

### 1. Clone the repo

```bash
git clone https://github.com/hamzaka430/dezign_mail.git
cd dezign_mail
npm install
```

### 2. Create Cloudflare resources

```bash
# Create D1 database
npx wrangler d1 create dezignmail-d1

# Create R2 bucket
npx wrangler r2 bucket create dezignmail-attachments
```

Copy the D1 database ID from the output and update `wrangler.toml`:

```toml
[[d1_databases]]
binding     = "D1"
database_name = "dezignmail-d1"
database_id = "YOUR_D1_ID_HERE"
```

### 3. Apply database schema

```bash
npx wrangler d1 execute dezignmail-d1 --file sql/schema.sql --remote
npx wrangler d1 execute dezignmail-d1 --file sql/indexes.sql --remote
```

### 4. Configure your domains

Update `wrangler.toml`:

```toml
[vars]
ALLOWED_DOMAINS = "yourdomain.com,yourdomain2.com"
HOURS_TO_DELETE = 3
```

### 5. Deploy the Pages app

```bash
npm run deploy
```

### 6. Deploy the Email Worker

```bash
cd email-worker
npm install

# Update email-worker/wrangler.toml with same D1 ID and domains
npx wrangler deploy
```

### 7. Enable Cloudflare Email Routing

For each domain:
1. Cloudflare Dashboard → your domain → **Email → Email Routing**
2. Enable Email Routing (adds MX + SPF records automatically)
3. **Routing rules → Catch-all → Edit**
   - Action: **Send to a Worker**
   - Worker: **dezignmail-email**
   - Save

### 8. Add custom domain to Pages (optional)

Cloudflare Dashboard → Workers & Pages → dezignmail → Custom Domains → Add

Then add a CNAME in DNS:
```
CNAME  @  dezignmail.pages.dev  (Proxied)
```

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ALLOWED_DOMAINS` | Comma-separated list of allowed email domains | `dezignmail.eu.cc` |
| `HOURS_TO_DELETE` | Hours before emails are auto-deleted | `3` |
| `TELEGRAM_LOG_ENABLE` | Enable Telegram logging | `false` |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token (if enabled) | — |
| `TELEGRAM_CHAT_ID` | Telegram chat ID (if enabled) | — |

---

## Database Schema

```sql
-- emails table
CREATE TABLE emails (
  id               TEXT PRIMARY KEY,
  from_address     TEXT NOT NULL,
  to_address       TEXT NOT NULL,
  subject          TEXT,
  received_at      INTEGER NOT NULL,
  html_content     TEXT,
  text_content     TEXT,
  has_attachments  INTEGER DEFAULT 0,
  attachment_count INTEGER DEFAULT 0
);

-- attachments table
CREATE TABLE attachments (
  id           TEXT PRIMARY KEY,
  email_id     TEXT NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  filename     TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size         INTEGER NOT NULL,
  r2_key       TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
```

---

## Deployment Info

| Resource | Details |
|----------|---------|
| **Pages project** | `dezignmail` |
| **Pages URL** | https://dezignmail.pages.dev |
| **Custom domain** | https://dezignmail.eu.cc |
| **Email Worker** | `dezignmail-email` |
| **D1 Database** | `dezignmail-d1` |
| **R2 Bucket** | `dezignmail-attachments` |
| **Email domains** | healthtek.eu.cc, dezignmail.eu.cc, dezignwisemail.eu.cc |

---

## Scripts

```bash
npm run build          # Build for production
npm run deploy         # Build + deploy to Cloudflare Pages
npm run dev            # Local development
npm run typecheck      # TypeScript type check
npm run db:schema      # Apply D1 schema
npm run db:indexes     # Apply D1 indexes
npm run db:create      # Create D1 database
npm run r2:create      # Create R2 bucket
```

---

## License

MIT — Built by [Dezignwise](https://dezignwise.com)

---

## Contact

- **Website:** [dezignmail.eu.cc](https://dezignmail.eu.cc)
- **Company:** Dezignwise
- **Email:** hello@dezignwise.com
- **Abuse:** abuse@dezignwise.com
