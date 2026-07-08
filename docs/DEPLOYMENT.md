# Dezignmail — Full Deployment Guide

## Architecture Overview

```
Email Sender
     │
     ▼ SMTP
mail.dezignwise.online (DigitalOcean VPS)
     │  Postfix catch-all
     │  → pipe → dezignmail-pipe.py
     │                  │ POST /api/receive
     ▼
dezignmail.pages.dev (Cloudflare Pages)
     │  Hono API
     ├─ /api/inbox/create     → Create new inbox session
     ├─ /api/inbox/:id        → Get session info / TTL
     ├─ /api/inbox/:id/messages → List messages
     ├─ /api/receive          → Webhook from Postfix
     └─ /                     → Frontend SPA
     │
     ▼ (optional)
Neon PostgreSQL (persistent storage)
```

---

## Part 1 — Cloudflare Pages Deployment

### 1.1 Prerequisites
- Cloudflare account (free tier works)
- Node.js 18+ and npm
- Wrangler CLI: `npm install -g wrangler`

### 1.2 Deploy to Cloudflare Pages

```bash
# Clone the repo
git clone https://github.com/your-username/dezignmail
cd dezignmail

# Install dependencies
npm install

# Login to Cloudflare
npx wrangler login

# Build and deploy
npm run deploy
# or
npx wrangler pages deploy dist --project-name dezignmail
```

Your app will be live at `https://dezignmail.pages.dev`

### 1.3 Environment Variables (optional)

```bash
# Set secrets for production
npx wrangler secret put NEON_DB_URL
# Enter your Neon connection string when prompted
```

---

## Part 2 — Neon PostgreSQL Setup (Optional)

The app uses in-memory storage by default. For persistence:

### 2.1 Create a Neon Database

1. Sign up at [neon.tech](https://neon.tech) (free tier: 512MB)
2. Create a project named `dezignmail`
3. Copy the connection string: `postgresql://user:pass@host/dezignmail`

### 2.2 Run Schema

```bash
# Using psql
psql "YOUR_NEON_CONNECTION_STRING" -f migrations/0001_initial_schema.sql

# Or using neon CLI
neon projects create dezignmail
neon connection-string --project dezignmail
```

### 2.3 Connect to Cloudflare D1 (Alternative)

```bash
# Create D1 database
npx wrangler d1 create dezignmail-production

# Update wrangler.jsonc with the database_id from output, then:
npx wrangler d1 migrations apply dezignmail-production
npx wrangler d1 execute dezignmail-production --file=./migrations/seed.sql
```

---

## Part 3 — DigitalOcean VPS (Mail Server)

### 3.1 Create Droplet

- Size: Basic — $6/month (1 GB RAM, 1 vCPU)
- OS: Ubuntu 22.04 LTS
- Region: Choose closest to your users

> ⚠️ Important: DigitalOcean blocks port 25 by default.
> Submit a ticket to enable outbound SMTP for your droplet.
> For receiving mail (inbound SMTP), port 25 inbound is open by default.

### 3.2 Configure Firewall

```bash
# On your DigitalOcean droplet:
ufw allow 22/tcp   # SSH
ufw allow 25/tcp   # SMTP (inbound)
ufw allow 587/tcp  # SMTP submission
ufw enable
```

### 3.3 Run Setup Script

```bash
# Upload and run
scp scripts/setup-postfix.sh root@YOUR_VPS_IP:/root/
ssh root@YOUR_VPS_IP
chmod +x setup-postfix.sh
./setup-postfix.sh
```

The script:
1. Installs Postfix, OpenDKIM, Python3
2. Configures catch-all mailbox for dezignwise.online
3. Sets up DKIM key pair
4. Creates the mail pipe script (forwards to Cloudflare Pages API)
5. Prints DNS records to add

### 3.4 Update API Endpoint

After deploying to Cloudflare Pages, update the pipe script:

```bash
ssh root@YOUR_VPS_IP
nano /usr/local/bin/dezignmail-pipe.py
# Change API_ENDPOINT to your actual Cloudflare Pages URL
# e.g. https://dezignmail.pages.dev/api/receive
```

---

## Part 4 — DNS Configuration (dezignwise.online)

Add these records in your DNS provider (Cloudflare, Namecheap, etc.):

| Type | Name | Value | Priority |
|------|------|-------|----------|
| A | mail | YOUR_VPS_IP | — |
| MX | @ | mail.dezignwise.online | 10 |
| TXT | @ | v=spf1 mx ip4:YOUR_VPS_IP -all | — |
| TXT | _dmarc | v=DMARC1; p=none; rua=mailto:postmaster@dezignwise.online | — |
| TXT | mail._domainkey | v=DKIM1; h=sha256; k=rsa; p=YOUR_DKIM_PUBLIC_KEY | — |

> The DKIM public key is printed at the end of `setup-postfix.sh`

---

## Part 5 — Testing

### 5.1 Test the API

```bash
# Health check
curl https://dezignmail.pages.dev/api/health

# Create inbox
curl -X POST https://dezignmail.pages.dev/api/inbox/create \
  -H "Content-Type: application/json" \
  -d '{"ttl": 600}'

# Simulate receiving email (replace SESSION_ID from above)
curl -X POST https://dezignmail.pages.dev/api/receive \
  -H "Content-Type: application/json" \
  -d '{
    "to": "test.email@dezignwise.online",
    "from": "sender@example.com",
    "from_name": "Test Sender",
    "subject": "Hello World",
    "body_text": "This is a test email.",
    "body_html": "<p>This is a <strong>test</strong> email.</p>",
    "size": 512
  }'

# Get messages
curl https://dezignmail.pages.dev/api/inbox/SESSION_ID/messages
```

### 5.2 Test Mail Delivery (from VPS)

```bash
ssh root@YOUR_VPS_IP

# Test pipe script directly
echo "From: test@example.com
To: swift.fox.9999@dezignwise.online
Subject: Direct Test

Hello from Postfix pipe test!" | /usr/local/bin/dezignmail-pipe.py

# Check logs
tail -n 50 /var/log/dezignmail-pipe.log
tail -n 50 /var/log/postfix/mail.log

# Send real test email
echo "Test" | mail -s "Integration Test" swift.fox.9999@dezignwise.online
```

### 5.3 Verify DNS

```bash
# Wait 5-60 minutes for DNS propagation, then:
dig MX dezignwise.online
dig TXT dezignwise.online
dig TXT mail._domainkey.dezignwise.online

# Online tools:
# https://mxtoolbox.com/EmailHeaders.aspx
# https://dmarcian.com/dmarc-inspector/
# https://mail-tester.com
```

---

## Part 6 — Auto-Expiry / Cron Cleanup

Add a cron job on the VPS to clean expired sessions via the API:

```bash
crontab -e
# Add:
*/10 * * * * curl -s -X POST https://dezignmail.pages.dev/api/cleanup > /dev/null 2>&1
```

Or for Neon PostgreSQL, add a scheduled function:

```sql
-- Run every hour to delete expired data
DELETE FROM email_messages 
WHERE inbox_address IN (
  SELECT email_address FROM inbox_sessions 
  WHERE expires_at < NOW() AND is_active = 0
);

DELETE FROM inbox_sessions 
WHERE expires_at < NOW() - INTERVAL '1 hour';
```

---

## Security Considerations

1. **Webhook Authentication**: Add a secret token to `/api/receive` calls from Postfix
2. **Rate Limiting**: Cloudflare provides rate limiting on Workers
3. **Content Filtering**: Strip dangerous HTML (XSS) in body rendering
4. **Inbox Isolation**: Sessions are isolated by session_id (UUID)
5. **HTTPS Only**: Cloudflare Pages enforces HTTPS
6. **No User Data Stored**: Emails auto-delete; no accounts, no tracking

---

## Cost Estimate

| Service | Plan | Cost |
|---------|------|------|
| Cloudflare Pages | Free | $0/month |
| Neon PostgreSQL | Free tier (512MB) | $0/month |
| DigitalOcean Droplet | Basic 1GB | ~$6/month |
| Domain (dezignwise.online) | Annual renewal | ~$10/year |
| **Total** | | **~$6/month** |
