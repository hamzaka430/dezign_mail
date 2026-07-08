# Dezignmail — Temporary Email Service

**Real-looking disposable email on dezignwise.online**

## Overview
- **Name**: Dezignmail
- **Goal**: Provide short-lived disposable email inboxes that bypass most disposable-email detection
- **Domain**: dezignwise.online (with real MX, SPF, DKIM, DMARC records)
- **Design**: Dark-canvas UI based on Framer design language (DESIGN-framer.md)

## Features Completed
- ✅ Instant temporary inbox creation (no signup)
- ✅ Custom alias support (`yourname@dezignwise.online`)
- ✅ Configurable TTL (10 min / 1 hr / 24 hr)
- ✅ Inbox extend (+1 hour)
- ✅ Real-time polling (5s interval)
- ✅ Email detail view (HTML + plain text)
- ✅ Message delete
- ✅ Inbox delete
- ✅ REST API for external integrations
- ✅ Postfix mail server setup script
- ✅ DKIM/SPF/DMARC configuration
- ✅ Neon PostgreSQL schema (D1 compatible)
- ✅ Demo data pre-seeded

## URLs
- **Live Preview**: https://3000-i43txj3neqj6k9fhkz5nk-583b4d74.sandbox.novita.ai
- **API Health**: https://3000-i43txj3neqj6k9fhkz5nk-583b4d74.sandbox.novita.ai/api/health
- **Cloudflare Production**: https://dezignmail.pages.dev (after deploy)
- **GitHub**: https://github.com/your-username/dezignmail

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /api/inbox/create | Create new temporary inbox |
| GET | /api/inbox/:id | Get session info & time left |
| GET | /api/inbox/:id/messages | List all messages |
| GET | /api/inbox/:id/messages/:msgId | Get single message (marks read) |
| DELETE | /api/inbox/:id/messages/:msgId | Delete a message |
| DELETE | /api/inbox/:id | Delete entire inbox |
| POST | /api/inbox/:id/extend | Extend inbox TTL |
| POST | /api/receive | Webhook for Postfix delivery |
| GET | /api/health | Health check |
| GET | /api/domains | Available domains |

## Data Architecture
- **Sessions**: In-memory store (fallback) or Cloudflare D1 / Neon PostgreSQL
- **Emails**: Keyed by inbox_address, auto-cleaned on expiry
- **No persistent user data**: All data is ephemeral by design

## Tech Stack
- **Frontend**: Vanilla JS SPA, Framer-inspired dark UI, Inter font
- **Backend**: Hono (TypeScript) on Cloudflare Pages / Workers
- **Mail Server**: Postfix with catch-all + OpenDKIM (DigitalOcean VPS)
- **Database**: Cloudflare D1 (optional) / Neon PostgreSQL (optional)
- **Build**: Vite + @hono/vite-cloudflare-pages

## Quick Start

```bash
npm install
npm run build
npm run dev:sandbox  # local dev with wrangler
```

## Deployment
See `docs/DEPLOYMENT.md` for full DigitalOcean + Cloudflare Pages + DNS guide.

### TL;DR Deploy
```bash
npm run build && npx wrangler pages deploy dist --project-name dezignmail
```

## Not Yet Implemented
- Redis auto-expiry (TTL cleanup cron)
- Attachment download support
- Domain rotation (multiple domains)
- Webhook secret auth (Postfix → API)
- Admin dashboard
- Email search / filter

## Recommended Next Steps
1. Deploy Postfix on DigitalOcean (`scripts/setup-postfix.sh`)
2. Configure DNS records (`scripts/dns-records.txt`)
3. Deploy to Cloudflare Pages (`npm run deploy`)
4. Set up Neon DB for persistent storage
5. Add webhook secret to secure `/api/receive`
