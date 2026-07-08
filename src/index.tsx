import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { serveStatic } from 'hono/cloudflare-workers'

type Bindings = {
  DB?: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

// Enable CORS for all API routes
app.use('/api/*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}))

// Serve static files
app.use('/static/*', serveStatic({ root: './public' }))

// ─── Utility Functions ──────────────────────────────────────────────────────

const ADJECTIVES = ['swift', 'dark', 'bright', 'cool', 'smart', 'fast', 'deep', 'sharp', 'sleek', 'bold']
const NOUNS = ['fox', 'hawk', 'wolf', 'bear', 'eagle', 'storm', 'blade', 'wave', 'spark', 'ghost']

function generateRandomEmail(domain: string = 'dezignwise.online'): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)]
  const num = Math.floor(Math.random() * 9000) + 1000
  return `${adj}.${noun}.${num}@${domain}`
}

function generateSessionId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < 32; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

function getDomainFromEmail(email: string): string {
  return email.split('@')[1] || 'dezignwise.online'
}

// ─── In-Memory Fallback Store (when DB not bound) ───────────────────────────

interface EmailMessage {
  id: string
  inbox_address: string
  from_address: string
  from_name: string
  subject: string
  body_text: string
  body_html: string
  received_at: string
  is_read: boolean
  has_attachments: boolean
  size: number
}

interface InboxSession {
  session_id: string
  email_address: string
  created_at: string
  expires_at: string
  ttl_seconds: number
  is_active: boolean
}

const memoryStore: {
  sessions: Map<string, InboxSession>
  emails: Map<string, EmailMessage[]>
} = {
  sessions: new Map(),
  emails: new Map()
}

// Pre-populate with demo data
function seedDemoData() {
  const now = new Date()
  const expires = new Date(now.getTime() + 10 * 60 * 1000)
  
  const demoSession: InboxSession = {
    session_id: 'demo-session-001',
    email_address: 'swift.fox.4782@dezignwise.online',
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    ttl_seconds: 600,
    is_active: true
  }
  memoryStore.sessions.set('demo-session-001', demoSession)
  
  const demoEmails: EmailMessage[] = [
    {
      id: 'msg-001',
      inbox_address: 'swift.fox.4782@dezignwise.online',
      from_address: 'welcome@github.com',
      from_name: 'GitHub',
      subject: 'Welcome to GitHub! Please verify your email',
      body_text: 'Hi there! Please click the link below to verify your email address...',
      body_html: '<h2>Welcome to GitHub!</h2><p>Please <a href="#">click here</a> to verify your email address.</p>',
      received_at: new Date(now.getTime() - 120000).toISOString(),
      is_read: false,
      has_attachments: false,
      size: 1248
    },
    {
      id: 'msg-002',
      inbox_address: 'swift.fox.4782@dezignwise.online',
      from_address: 'noreply@discord.com',
      from_name: 'Discord',
      subject: 'Your Discord verification code: 847291',
      body_text: 'Your Discord verification code is: 847291. This code expires in 10 minutes.',
      body_html: '<div style="font-family:sans-serif"><h3>Discord Verification</h3><p>Your code: <strong>847291</strong></p></div>',
      received_at: new Date(now.getTime() - 300000).toISOString(),
      is_read: true,
      has_attachments: false,
      size: 892
    },
    {
      id: 'msg-003',
      inbox_address: 'swift.fox.4782@dezignwise.online',
      from_address: 'security@twitter.com',
      from_name: 'Twitter Security',
      subject: 'Confirm your Twitter account',
      body_text: 'To complete your Twitter registration, please confirm your email address.',
      body_html: '<div><h2>Confirm your account</h2><p>Click below to confirm your Twitter account.</p><a href="#" style="background:#1DA1F2;color:#fff;padding:10px 20px;border-radius:100px;text-decoration:none">Confirm Email</a></div>',
      received_at: new Date(now.getTime() - 600000).toISOString(),
      is_read: false,
      has_attachments: false,
      size: 1567
    }
  ]
  memoryStore.emails.set('swift.fox.4782@dezignwise.online', demoEmails)
}

seedDemoData()

// ─── API Routes ─────────────────────────────────────────────────────────────

// POST /api/inbox/create - Create a new temporary inbox
app.post('/api/inbox/create', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const ttl = body.ttl || 600 // default 10 minutes
  const customAlias = body.custom_alias

  const sessionId = generateSessionId()
  const emailAddress = customAlias
    ? `${customAlias}@dezignwise.online`
    : generateRandomEmail()

  const now = new Date()
  const expires = new Date(now.getTime() + ttl * 1000)

  const session: InboxSession = {
    session_id: sessionId,
    email_address: emailAddress,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
    ttl_seconds: ttl,
    is_active: true
  }

  if (c.env?.DB) {
    try {
      await c.env.DB.prepare(`
        INSERT OR IGNORE INTO inbox_sessions (session_id, email_address, created_at, expires_at, ttl_seconds, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
      `).bind(sessionId, emailAddress, now.toISOString(), expires.toISOString(), ttl).run()
    } catch (e) {
      console.error('DB error:', e)
    }
  } else {
    memoryStore.sessions.set(sessionId, session)
    memoryStore.emails.set(emailAddress, [])
  }

  return c.json({
    success: true,
    session_id: sessionId,
    email_address: emailAddress,
    expires_at: expires.toISOString(),
    ttl_seconds: ttl,
    domain: getDomainFromEmail(emailAddress)
  })
})

// GET /api/inbox/:sessionId - Get inbox info
app.get('/api/inbox/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')

  let session: InboxSession | null = null

  if (c.env?.DB) {
    try {
      const row = await c.env.DB.prepare(
        'SELECT * FROM inbox_sessions WHERE session_id = ?'
      ).bind(sessionId).first<InboxSession>()
      session = row || null
    } catch (e) {
      console.error('DB error:', e)
    }
  } else {
    session = memoryStore.sessions.get(sessionId) || null
  }

  if (!session) {
    return c.json({ error: 'Session not found' }, 404)
  }

  const now = new Date()
  const expiresAt = new Date(session.expires_at)
  const timeLeft = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000))
  const isExpired = timeLeft === 0

  if (isExpired) {
    session.is_active = false
  }

  return c.json({
    session_id: session.session_id,
    email_address: session.email_address,
    created_at: session.created_at,
    expires_at: session.expires_at,
    time_left_seconds: timeLeft,
    is_active: !isExpired,
    domain: getDomainFromEmail(session.email_address)
  })
})

// GET /api/inbox/:sessionId/messages - Get all messages for inbox
app.get('/api/inbox/:sessionId/messages', async (c) => {
  const sessionId = c.req.param('sessionId')

  let session: InboxSession | null = null

  if (c.env?.DB) {
    try {
      const row = await c.env.DB.prepare(
        'SELECT * FROM inbox_sessions WHERE session_id = ?'
      ).bind(sessionId).first<InboxSession>()
      session = row || null
    } catch (e) {
      console.error('DB error:', e)
    }
  } else {
    session = memoryStore.sessions.get(sessionId) || null
  }

  if (!session) {
    return c.json({ error: 'Session not found' }, 404)
  }

  let messages: EmailMessage[] = []

  if (c.env?.DB) {
    try {
      const rows = await c.env.DB.prepare(
        'SELECT * FROM email_messages WHERE inbox_address = ? ORDER BY received_at DESC'
      ).bind(session.email_address).all<EmailMessage>()
      messages = rows.results || []
    } catch (e) {
      console.error('DB error:', e)
    }
  } else {
    messages = memoryStore.emails.get(session.email_address) || []
  }

  return c.json({
    session_id: sessionId,
    email_address: session.email_address,
    message_count: messages.length,
    unread_count: messages.filter(m => !m.is_read).length,
    messages: messages
  })
})

// GET /api/inbox/:sessionId/messages/:msgId - Get single message
app.get('/api/inbox/:sessionId/messages/:msgId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const msgId = c.req.param('msgId')

  let session: InboxSession | null = null

  if (c.env?.DB) {
    try {
      const row = await c.env.DB.prepare(
        'SELECT * FROM inbox_sessions WHERE session_id = ?'
      ).bind(sessionId).first<InboxSession>()
      session = row || null
    } catch (e) {
      console.error('DB error:', e)
    }
  } else {
    session = memoryStore.sessions.get(sessionId) || null
  }

  if (!session) {
    return c.json({ error: 'Session not found' }, 404)
  }

  let message: EmailMessage | null = null

  if (c.env?.DB) {
    try {
      const row = await c.env.DB.prepare(
        'SELECT * FROM email_messages WHERE id = ? AND inbox_address = ?'
      ).bind(msgId, session.email_address).first<EmailMessage>()
      message = row || null
      if (message) {
        await c.env.DB.prepare('UPDATE email_messages SET is_read = 1 WHERE id = ?').bind(msgId).run()
        message.is_read = true
      }
    } catch (e) {
      console.error('DB error:', e)
    }
  } else {
    const msgs = memoryStore.emails.get(session.email_address) || []
    message = msgs.find(m => m.id === msgId) || null
    if (message) message.is_read = true
  }

  if (!message) {
    return c.json({ error: 'Message not found' }, 404)
  }

  return c.json(message)
})

// DELETE /api/inbox/:sessionId/messages/:msgId - Delete a message
app.delete('/api/inbox/:sessionId/messages/:msgId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const msgId = c.req.param('msgId')

  let session: InboxSession | null = null
  if (c.env?.DB) {
    const row = await c.env.DB.prepare('SELECT * FROM inbox_sessions WHERE session_id = ?').bind(sessionId).first<InboxSession>()
    session = row || null
  } else {
    session = memoryStore.sessions.get(sessionId) || null
  }

  if (!session) return c.json({ error: 'Session not found' }, 404)

  if (c.env?.DB) {
    await c.env.DB.prepare('DELETE FROM email_messages WHERE id = ? AND inbox_address = ?').bind(msgId, session.email_address).run()
  } else {
    const msgs = memoryStore.emails.get(session.email_address) || []
    memoryStore.emails.set(session.email_address, msgs.filter(m => m.id !== msgId))
  }

  return c.json({ success: true, message: 'Message deleted' })
})

// DELETE /api/inbox/:sessionId - Delete entire inbox / session
app.delete('/api/inbox/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')

  if (c.env?.DB) {
    const row = await c.env.DB.prepare('SELECT * FROM inbox_sessions WHERE session_id = ?').bind(sessionId).first<InboxSession>()
    if (row) {
      await c.env.DB.prepare('DELETE FROM email_messages WHERE inbox_address = ?').bind(row.email_address).run()
      await c.env.DB.prepare('DELETE FROM inbox_sessions WHERE session_id = ?').bind(sessionId).run()
    }
  } else {
    const session = memoryStore.sessions.get(sessionId)
    if (session) {
      memoryStore.emails.delete(session.email_address)
      memoryStore.sessions.delete(sessionId)
    }
  }

  return c.json({ success: true, message: 'Inbox deleted' })
})

// POST /api/inbox/:sessionId/extend - Extend TTL
app.post('/api/inbox/:sessionId/extend', async (c) => {
  const sessionId = c.req.param('sessionId')
  const body = await c.req.json().catch(() => ({})) as any
  const extraSeconds = body.extra_seconds || 600

  let session: InboxSession | null = null
  if (c.env?.DB) {
    const row = await c.env.DB.prepare('SELECT * FROM inbox_sessions WHERE session_id = ?').bind(sessionId).first<InboxSession>()
    session = row || null
  } else {
    session = memoryStore.sessions.get(sessionId) || null
  }

  if (!session) return c.json({ error: 'Session not found' }, 404)

  const newExpiry = new Date(new Date(session.expires_at).getTime() + extraSeconds * 1000)

  if (c.env?.DB) {
    await c.env.DB.prepare('UPDATE inbox_sessions SET expires_at = ? WHERE session_id = ?').bind(newExpiry.toISOString(), sessionId).run()
  } else {
    session.expires_at = newExpiry.toISOString()
  }

  return c.json({ success: true, expires_at: newExpiry.toISOString() })
})

// POST /api/receive - Webhook endpoint for Postfix/mail server to deliver emails
app.post('/api/receive', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ error: 'Invalid payload' }, 400)

  const { to, from, from_name, subject, body_text, body_html, size } = body as any
  const inboxAddress = (to || '').toLowerCase().trim()
  if (!inboxAddress) return c.json({ error: 'Missing to address' }, 400)

  const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()

  const newMessage: EmailMessage = {
    id: msgId,
    inbox_address: inboxAddress,
    from_address: from || 'unknown@unknown.com',
    from_name: from_name || 'Unknown',
    subject: subject || '(no subject)',
    body_text: body_text || '',
    body_html: body_html || '',
    received_at: now,
    is_read: false,
    has_attachments: false,
    size: size || 0
  }

  if (c.env?.DB) {
    try {
      await c.env.DB.prepare(`
        INSERT INTO email_messages (id, inbox_address, from_address, from_name, subject, body_text, body_html, received_at, is_read, has_attachments, size)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)
      `).bind(msgId, inboxAddress, newMessage.from_address, newMessage.from_name, newMessage.subject, newMessage.body_text, newMessage.body_html, now, newMessage.size).run()
    } catch (e) {
      console.error('DB error storing message:', e)
    }
  } else {
    const msgs = memoryStore.emails.get(inboxAddress) || []
    msgs.unshift(newMessage)
    memoryStore.emails.set(inboxAddress, msgs)
  }

  return c.json({ success: true, message_id: msgId })
})

// GET /api/health - Health check
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'Dezignmail API',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    domain: 'dezignwise.online',
    features: ['temporary-inbox', 'custom-alias', 'auto-expiry', 'real-mx-records']
  })
})

// GET /api/domains - Available domains
app.get('/api/domains', (c) => {
  return c.json({
    domains: ['dezignwise.online'],
    default: 'dezignwise.online'
  })
})

// ─── Frontend Route ──────────────────────────────────────────────────────────
app.get('*', (c) => {
  return c.html(getIndexHtml())
})

function getIndexHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dezignmail — Disposable Email</title>
  <meta name="description" content="Free temporary email service. Get a disposable inbox in seconds. No signup required.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    /* ── Design System from DESIGN-framer.md ─────────────────────── */
    :root {
      --color-primary: #ffffff;
      --color-on-primary: #000000;
      --color-accent-blue: #0099ff;
      --color-ink: #ffffff;
      --color-ink-muted: #999999;
      --color-canvas: #090909;
      --color-surface-1: #141414;
      --color-surface-2: #1c1c1c;
      --color-hairline: #262626;
      --color-hairline-soft: #1a1a1a;
      --color-gradient-magenta: #d44df0;
      --color-gradient-violet: #6a4cf5;
      --color-gradient-orange: #ff7a3d;
      --color-gradient-coral: #ff5577;
      --color-success: #22c55e;

      --rounded-xs: 4px;
      --rounded-sm: 6px;
      --rounded-md: 10px;
      --rounded-lg: 15px;
      --rounded-xl: 20px;
      --rounded-xxl: 30px;
      --rounded-pill: 100px;
      --rounded-full: 9999px;

      --spacing-hair: 1px;
      --spacing-xxs: 4px;
      --spacing-xs: 8px;
      --spacing-sm: 12px;
      --spacing-md: 15px;
      --spacing-lg: 20px;
      --spacing-xl: 30px;
      --spacing-xxl: 40px;
      --spacing-section: 96px;
    }

    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      background: var(--color-canvas);
      color: var(--color-ink);
      font-family: 'Inter', -apple-system, system-ui, sans-serif;
      font-size: 15px;
      line-height: 1.3;
      letter-spacing: -0.15px;
      min-height: 100vh;
      font-feature-settings: 'cv11' 1, 'ss03' 1;
      -webkit-font-smoothing: antialiased;
    }

    /* ── Navigation ──────────────────────────────────────────────── */
    nav {
      background: var(--color-canvas);
      height: 56px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 var(--spacing-xl);
      border-bottom: 1px solid var(--color-hairline-soft);
      position: sticky;
      top: 0;
      z-index: 100;
      max-width: 1199px;
      margin: 0 auto;
      width: 100%;
    }
    .nav-wrapper {
      position: sticky;
      top: 0;
      background: var(--color-canvas);
      border-bottom: 1px solid var(--color-hairline-soft);
      z-index: 100;
    }
    .nav-logo {
      font-size: 18px;
      font-weight: 700;
      letter-spacing: -1px;
      color: var(--color-ink);
      text-decoration: none;
      display: flex;
      align-items: center;
      gap: var(--spacing-xs);
    }
    .nav-logo-dot {
      width: 8px; height: 8px;
      background: var(--color-accent-blue);
      border-radius: var(--rounded-full);
      display: inline-block;
    }
    .nav-actions { display: flex; gap: var(--spacing-sm); align-items: center; }
    .nav-link {
      color: var(--color-ink-muted);
      text-decoration: none;
      font-size: 14px;
      font-weight: 500;
      letter-spacing: -0.14px;
      transition: color 0.15s;
    }
    .nav-link:hover { color: var(--color-ink); }

    /* ── Buttons ──────────────────────────────────────────────────── */
    .btn-primary {
      background: var(--color-primary);
      color: var(--color-on-primary);
      border: none;
      border-radius: var(--rounded-pill);
      padding: 10px 15px;
      font-size: 14px;
      font-weight: 500;
      letter-spacing: -0.14px;
      cursor: pointer;
      transition: opacity 0.15s, transform 0.1s;
      font-family: inherit;
      line-height: 1;
    }
    .btn-primary:hover { opacity: 0.92; }
    .btn-primary:active { transform: scale(0.98); }

    .btn-secondary {
      background: var(--color-surface-1);
      color: var(--color-ink);
      border: none;
      border-radius: var(--rounded-pill);
      padding: 10px 15px;
      font-size: 14px;
      font-weight: 500;
      letter-spacing: -0.14px;
      cursor: pointer;
      transition: background 0.15s;
      font-family: inherit;
      line-height: 1;
    }
    .btn-secondary:hover { background: var(--color-surface-2); }

    .btn-icon {
      background: var(--color-surface-1);
      color: var(--color-ink);
      border: none;
      border-radius: var(--rounded-full);
      width: 36px; height: 36px;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer;
      transition: background 0.15s;
      font-size: 16px;
      flex-shrink: 0;
    }
    .btn-icon:hover { background: var(--color-surface-2); }

    .btn-danger {
      background: transparent;
      color: #ef4444;
      border: 1px solid #ef444433;
      border-radius: var(--rounded-pill);
      padding: 7px 13px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s;
      font-family: inherit;
    }
    .btn-danger:hover { background: #ef444422; }

    /* ── Layout ───────────────────────────────────────────────────── */
    .container { max-width: 1199px; margin: 0 auto; padding: 0 var(--spacing-xl); }

    /* ── Hero Section ─────────────────────────────────────────────── */
    .hero {
      padding: var(--spacing-section) 0 var(--spacing-xl);
      text-align: center;
    }
    .hero-eyebrow {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-xs);
      background: var(--color-surface-1);
      border-radius: var(--rounded-pill);
      padding: 6px 14px;
      font-size: 13px;
      font-weight: 500;
      color: var(--color-ink-muted);
      letter-spacing: -0.13px;
      margin-bottom: var(--spacing-lg);
    }
    .hero-eyebrow-dot {
      width: 6px; height: 6px;
      background: var(--color-success);
      border-radius: var(--rounded-full);
    }
    .hero-title {
      font-size: clamp(52px, 8vw, 85px);
      font-weight: 500;
      line-height: 0.95;
      letter-spacing: clamp(-2px, -0.05em, -4.25px);
      color: var(--color-ink);
      margin-bottom: var(--spacing-lg);
    }
    .hero-title span { color: var(--color-ink-muted); }
    .hero-subtitle {
      font-size: 18px;
      font-weight: 400;
      line-height: 1.3;
      letter-spacing: -0.18px;
      color: var(--color-ink-muted);
      max-width: 520px;
      margin: 0 auto var(--spacing-xxl);
    }

    /* ── Inbox Generator Card ─────────────────────────────────────── */
    .inbox-card {
      background: var(--color-surface-1);
      border-radius: var(--rounded-xl);
      padding: var(--spacing-xxl);
      max-width: 640px;
      margin: 0 auto var(--spacing-section);
      border: 1px solid var(--color-hairline);
    }
    .inbox-label {
      font-size: 12px;
      font-weight: 500;
      letter-spacing: -0.12px;
      color: var(--color-ink-muted);
      text-transform: uppercase;
      margin-bottom: var(--spacing-sm);
    }
    .inbox-address-row {
      display: flex;
      align-items: center;
      gap: var(--spacing-sm);
      background: var(--color-surface-2);
      border-radius: var(--rounded-md);
      padding: 12px 14px;
      margin-bottom: var(--spacing-lg);
    }
    .inbox-address-text {
      flex: 1;
      font-size: 16px;
      font-weight: 500;
      letter-spacing: -0.5px;
      color: var(--color-ink);
      word-break: break-all;
      font-family: 'SF Mono', 'Cascadia Code', monospace;
    }
    .ttl-row {
      display: flex;
      gap: var(--spacing-sm);
      margin-bottom: var(--spacing-lg);
      flex-wrap: wrap;
    }
    .ttl-btn {
      background: var(--color-canvas);
      color: var(--color-ink-muted);
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-pill);
      padding: 8px 14px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
      font-family: inherit;
    }
    .ttl-btn.active, .ttl-btn:hover {
      background: var(--color-surface-2);
      color: var(--color-ink);
      border-color: var(--color-hairline);
    }
    .custom-alias-row {
      display: flex;
      gap: var(--spacing-sm);
      margin-bottom: var(--spacing-lg);
    }
    .text-input {
      flex: 1;
      background: var(--color-surface-2);
      color: var(--color-ink);
      border: 1px solid var(--color-hairline);
      border-radius: var(--rounded-md);
      padding: 10px 14px;
      font-size: 15px;
      font-family: inherit;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    .text-input:focus {
      border-color: var(--color-accent-blue);
      box-shadow: 0 0 0 1px rgba(0,153,255,0.15);
    }
    .text-input::placeholder { color: var(--color-ink-muted); }
    .text-input-suffix {
      display: flex; align-items: center;
      background: var(--color-surface-2);
      border: 1px solid var(--color-hairline);
      border-left: none;
      border-radius: 0 var(--rounded-md) var(--rounded-md) 0;
      padding: 10px 14px;
      color: var(--color-ink-muted);
      font-size: 14px;
    }
    .text-input.with-suffix { border-radius: var(--rounded-md) 0 0 var(--rounded-md); border-right: none; }
    .inbox-actions { display: flex; gap: var(--spacing-sm); }
    .timer-bar-wrapper {
      margin-top: var(--spacing-lg);
      display: none;
    }
    .timer-bar-wrapper.visible { display: block; }
    .timer-label {
      display: flex;
      justify-content: space-between;
      font-size: 12px;
      color: var(--color-ink-muted);
      margin-bottom: var(--spacing-xs);
    }
    .timer-bar {
      height: 2px;
      background: var(--color-hairline);
      border-radius: var(--rounded-full);
      overflow: hidden;
    }
    .timer-bar-fill {
      height: 100%;
      background: var(--color-accent-blue);
      border-radius: var(--rounded-full);
      transition: width 1s linear;
    }

    /* ── Inbox View ───────────────────────────────────────────────── */
    #inbox-section { display: none; }
    #inbox-section.visible { display: block; }

    .inbox-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: var(--spacing-lg);
      flex-wrap: wrap;
      gap: var(--spacing-sm);
    }
    .inbox-title-group {}
    .inbox-title {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.8px;
      color: var(--color-ink);
      margin-bottom: 4px;
    }
    .inbox-subtitle { font-size: 13px; color: var(--color-ink-muted); }
    .inbox-toolbar { display: flex; gap: var(--spacing-sm); align-items: center; }

    .email-list {
      background: var(--color-surface-1);
      border-radius: var(--rounded-xl);
      border: 1px solid var(--color-hairline);
      overflow: hidden;
    }
    .email-list-empty {
      padding: var(--spacing-xxl) var(--spacing-xl);
      text-align: center;
      color: var(--color-ink-muted);
    }
    .email-list-empty-icon { font-size: 36px; margin-bottom: var(--spacing-md); opacity: 0.4; }
    .email-item {
      display: flex;
      gap: var(--spacing-md);
      padding: var(--spacing-md) var(--spacing-lg);
      border-bottom: 1px solid var(--color-hairline-soft);
      cursor: pointer;
      transition: background 0.15s;
      align-items: flex-start;
    }
    .email-item:last-child { border-bottom: none; }
    .email-item:hover { background: var(--color-surface-2); }
    .email-item.unread { background: rgba(0,153,255,0.03); }
    .email-item.unread:hover { background: rgba(0,153,255,0.06); }
    .email-unread-dot {
      width: 8px; height: 8px;
      background: var(--color-accent-blue);
      border-radius: var(--rounded-full);
      flex-shrink: 0;
      margin-top: 6px;
    }
    .email-read-dot {
      width: 8px; height: 8px;
      flex-shrink: 0;
      margin-top: 6px;
    }
    .email-item-body { flex: 1; min-width: 0; }
    .email-from {
      font-size: 14px;
      font-weight: 500;
      letter-spacing: -0.14px;
      color: var(--color-ink);
      margin-bottom: 2px;
    }
    .email-subject {
      font-size: 14px;
      font-weight: 400;
      color: var(--color-ink);
      margin-bottom: 3px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .email-preview {
      font-size: 13px;
      color: var(--color-ink-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .email-item-meta { text-align: right; flex-shrink: 0; }
    .email-time { font-size: 12px; color: var(--color-ink-muted); white-space: nowrap; }

    /* ── Email Detail Panel ───────────────────────────────────────── */
    #email-detail { display: none; }
    #email-detail.visible { display: block; }

    .detail-back {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-xs);
      color: var(--color-ink-muted);
      font-size: 14px;
      cursor: pointer;
      margin-bottom: var(--spacing-lg);
      transition: color 0.15s;
      border: none;
      background: none;
      font-family: inherit;
      padding: 0;
    }
    .detail-back:hover { color: var(--color-ink); }

    .email-detail-card {
      background: var(--color-surface-1);
      border-radius: var(--rounded-xl);
      border: 1px solid var(--color-hairline);
      overflow: hidden;
    }
    .email-detail-header {
      padding: var(--spacing-xl);
      border-bottom: 1px solid var(--color-hairline-soft);
    }
    .email-detail-subject {
      font-size: 22px;
      font-weight: 700;
      letter-spacing: -0.8px;
      color: var(--color-ink);
      margin-bottom: var(--spacing-md);
    }
    .email-meta-grid { display: flex; flex-direction: column; gap: var(--spacing-xs); }
    .email-meta-row { display: flex; gap: var(--spacing-md); font-size: 14px; }
    .email-meta-label { color: var(--color-ink-muted); min-width: 48px; }
    .email-meta-value { color: var(--color-ink); }
    .email-detail-actions {
      display: flex;
      gap: var(--spacing-sm);
      padding: var(--spacing-md) var(--spacing-xl);
      border-bottom: 1px solid var(--color-hairline-soft);
      background: var(--color-surface-2);
    }
    .email-body {
      padding: var(--spacing-xl);
      color: var(--color-ink);
      font-size: 15px;
      line-height: 1.6;
    }
    .email-body-html { color: var(--color-ink); }
    .email-body-html a { color: var(--color-accent-blue); }
    .email-body-text {
      font-family: monospace;
      white-space: pre-wrap;
      background: var(--color-surface-2);
      padding: var(--spacing-lg);
      border-radius: var(--rounded-md);
      font-size: 13px;
      overflow-x: auto;
    }

    /* ── Feature Cards Grid ───────────────────────────────────────── */
    .features-section {
      padding: var(--spacing-section) 0;
      border-top: 1px solid var(--color-hairline-soft);
    }
    .section-eyebrow {
      font-size: 13px;
      font-weight: 500;
      color: var(--color-ink-muted);
      letter-spacing: -0.13px;
      margin-bottom: var(--spacing-sm);
    }
    .section-title {
      font-size: clamp(36px, 5vw, 62px);
      font-weight: 500;
      letter-spacing: -3.1px;
      line-height: 1;
      color: var(--color-ink);
      margin-bottom: var(--spacing-xxl);
    }
    .card-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: var(--spacing-lg);
    }
    @media (max-width: 810px) { .card-grid { grid-template-columns: 1fr; } }

    .feature-card {
      background: var(--color-surface-1);
      border-radius: var(--rounded-xl);
      padding: var(--spacing-xl);
      border: 1px solid var(--color-hairline);
    }
    .feature-card-icon {
      font-size: 24px;
      margin-bottom: var(--spacing-md);
    }
    .feature-card-title {
      font-size: 18px;
      font-weight: 600;
      letter-spacing: -0.5px;
      color: var(--color-ink);
      margin-bottom: var(--spacing-xs);
    }
    .feature-card-desc {
      font-size: 14px;
      color: var(--color-ink-muted);
      line-height: 1.5;
    }

    /* Gradient spotlight card */
    .spotlight-card-violet {
      background: linear-gradient(135deg, var(--color-gradient-violet), #4a2ef5);
      border-radius: var(--rounded-xxl);
      padding: var(--spacing-xl);
      border: none;
      grid-column: span 2;
    }
    @media (max-width: 810px) { .spotlight-card-violet { grid-column: span 1; } }
    .spotlight-card-title {
      font-size: 24px;
      font-weight: 400;
      letter-spacing: -0.01px;
      color: var(--color-ink);
      margin-bottom: var(--spacing-sm);
    }
    .spotlight-card-desc {
      font-size: 15px;
      color: rgba(255,255,255,0.75);
      line-height: 1.5;
    }

    /* ── Toast ────────────────────────────────────────────────────── */
    #toast {
      position: fixed;
      bottom: var(--spacing-xl);
      left: 50%;
      transform: translateX(-50%) translateY(100px);
      background: var(--color-surface-2);
      color: var(--color-ink);
      padding: 12px 20px;
      border-radius: var(--rounded-pill);
      font-size: 14px;
      font-weight: 500;
      border: 1px solid var(--color-hairline);
      transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      z-index: 1000;
      white-space: nowrap;
    }
    #toast.show { transform: translateX(-50%) translateY(0); }

    /* ── Loading Spinner ──────────────────────────────────────────── */
    .spinner {
      display: inline-block;
      width: 16px; height: 16px;
      border: 2px solid var(--color-hairline);
      border-top-color: var(--color-ink);
      border-radius: var(--rounded-full);
      animation: spin 0.7s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    /* ── Footer ───────────────────────────────────────────────────── */
    footer {
      border-top: 1px solid var(--color-hairline-soft);
      padding: 64px var(--spacing-xl);
      margin-top: var(--spacing-section);
    }
    .footer-inner {
      max-width: 1199px;
      margin: 0 auto;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: var(--spacing-xxl);
      flex-wrap: wrap;
    }
    .footer-brand { max-width: 260px; }
    .footer-brand-name {
      font-size: 16px;
      font-weight: 700;
      letter-spacing: -0.8px;
      margin-bottom: var(--spacing-sm);
    }
    .footer-brand-desc { font-size: 13px; color: var(--color-ink-muted); line-height: 1.5; }
    .footer-links h4 {
      font-size: 13px;
      font-weight: 500;
      letter-spacing: -0.13px;
      color: var(--color-ink);
      margin-bottom: var(--spacing-md);
    }
    .footer-links ul { list-style: none; display: flex; flex-direction: column; gap: var(--spacing-sm); }
    .footer-links a {
      color: var(--color-ink-muted);
      text-decoration: none;
      font-size: 13px;
      transition: color 0.15s;
    }
    .footer-links a:hover { color: var(--color-ink); }
    .footer-bottom {
      max-width: 1199px;
      margin: var(--spacing-xxl) auto 0;
      padding-top: var(--spacing-lg);
      border-top: 1px solid var(--color-hairline-soft);
      font-size: 12px;
      color: var(--color-ink-muted);
    }

    /* ── Responsive Tweaks ────────────────────────────────────────── */
    @media (max-width: 810px) {
      .hero { padding: 56px 0 var(--spacing-xl); }
      .inbox-card { padding: var(--spacing-xl); margin: 0 0 var(--spacing-section); }
      .ttl-row { gap: var(--spacing-xs); }
      nav { padding: 0 var(--spacing-lg); }
      .container { padding: 0 var(--spacing-lg); }
    }
    @media (max-width: 480px) {
      .inbox-actions { flex-wrap: wrap; }
      .inbox-actions .btn-primary { flex: 1; text-align: center; }
    }
  </style>
</head>
<body>

<!-- Navigation -->
<div class="nav-wrapper">
  <nav>
    <a href="/" class="nav-logo">
      <span class="nav-logo-dot"></span>
      Dezignmail
    </a>
    <div class="nav-actions">
      <a href="#features" class="nav-link">Features</a>
      <a href="#how-it-works" class="nav-link">How it works</a>
      <button class="btn-primary" onclick="scrollToInbox()">Get Inbox</button>
    </div>
  </nav>
</div>

<!-- Hero Section -->
<section class="hero container" id="home">
  <div class="hero-eyebrow">
    <span class="hero-eyebrow-dot"></span>
    No signup · No spam · Instant inbox
  </div>
  <h1 class="hero-title">
    Disposable email,<br>
    <span>done right.</span>
  </h1>
  <p class="hero-subtitle">
    Get a real-looking temporary inbox on dezignwise.online in seconds. Complete with MX, SPF, DKIM, and DMARC records.
  </p>

  <!-- Inbox Generator Card -->
  <div class="inbox-card" id="inbox-generator">
    <div class="inbox-label">Your temporary email address</div>
    <div class="inbox-address-row" id="address-display-row">
      <span class="inbox-address-text" id="current-email">—</span>
      <button class="btn-icon" id="copy-btn" onclick="copyEmail()" title="Copy email">⎘</button>
      <button class="btn-icon" onclick="refreshEmail()" title="Generate new address">↻</button>
    </div>

    <!-- TTL Selection -->
    <div class="inbox-label">Inbox duration</div>
    <div class="ttl-row" id="ttl-row">
      <button class="ttl-btn active" data-ttl="600" onclick="selectTTL(this, 600)">10 min</button>
      <button class="ttl-btn" data-ttl="3600" onclick="selectTTL(this, 3600)">1 hour</button>
      <button class="ttl-btn" data-ttl="86400" onclick="selectTTL(this, 86400)">24 hours</button>
    </div>

    <!-- Custom alias -->
    <div class="inbox-label">Custom alias (optional)</div>
    <div class="custom-alias-row">
      <input type="text" class="text-input with-suffix" id="custom-alias" placeholder="your-name" maxlength="30">
      <div class="text-input-suffix">@dezignwise.online</div>
    </div>

    <div class="inbox-actions">
      <button class="btn-primary" onclick="createInbox()">
        <span id="create-btn-text">Create Inbox</span>
      </button>
      <button class="btn-secondary" id="view-btn" onclick="viewInbox()" style="display:none">
        Open Inbox
      </button>
    </div>

    <!-- Timer bar -->
    <div class="timer-bar-wrapper" id="timer-wrapper">
      <div class="timer-label">
        <span>Expires in</span>
        <span id="timer-text">—</span>
      </div>
      <div class="timer-bar">
        <div class="timer-bar-fill" id="timer-fill" style="width:100%"></div>
      </div>
    </div>
  </div>
</section>

<!-- Inbox Section -->
<section class="container" id="inbox-section">
  <div class="inbox-header">
    <div class="inbox-title-group">
      <div class="inbox-title" id="inbox-title-email">Inbox</div>
      <div class="inbox-subtitle" id="inbox-subtitle">Loading messages…</div>
    </div>
    <div class="inbox-toolbar">
      <button class="btn-icon" onclick="refreshMessages()" title="Refresh">↻</button>
      <button class="btn-secondary" onclick="extendInbox()">+1 Hour</button>
      <button class="btn-danger" onclick="deleteInbox()">Delete Inbox</button>
    </div>
  </div>

  <!-- Email List -->
  <div class="email-list" id="email-list">
    <div class="email-list-empty">
      <div class="email-list-empty-icon">✉</div>
      <div>No messages yet</div>
      <div style="font-size:13px;margin-top:8px;color:#666">Emails sent to your address will appear here</div>
    </div>
  </div>

  <!-- Email Detail -->
  <div id="email-detail">
    <button class="detail-back" onclick="closeDetail()">← Back to Inbox</button>
    <div class="email-detail-card">
      <div class="email-detail-header">
        <div class="email-detail-subject" id="detail-subject">—</div>
        <div class="email-meta-grid">
          <div class="email-meta-row">
            <span class="email-meta-label">From</span>
            <span class="email-meta-value" id="detail-from">—</span>
          </div>
          <div class="email-meta-row">
            <span class="email-meta-label">To</span>
            <span class="email-meta-value" id="detail-to">—</span>
          </div>
          <div class="email-meta-row">
            <span class="email-meta-label">Date</span>
            <span class="email-meta-value" id="detail-date">—</span>
          </div>
        </div>
      </div>
      <div class="email-detail-actions">
        <button class="btn-danger" id="detail-delete-btn">Delete</button>
      </div>
      <div class="email-body" id="detail-body">—</div>
    </div>
  </div>
</section>

<!-- Features Section -->
<section class="features-section container" id="features">
  <div class="section-eyebrow">Why Dezignmail</div>
  <h2 class="section-title">Email privacy,<br>no strings.</h2>

  <div class="card-grid">
    <!-- Spotlight card (gradient-violet) -->
    <div class="spotlight-card-violet">
      <div class="spotlight-card-title">Real MX records on dezignwise.online</div>
      <div class="spotlight-card-desc">
        Unlike most disposable services, Dezignmail uses a properly configured domain with
        SPF, DKIM, and DMARC records — meaning your temporary address passes most validation checks
        and is far less likely to be blocked outright.
      </div>
    </div>

    <div class="feature-card">
      <div class="feature-card-icon">⚡</div>
      <div class="feature-card-title">Instant inbox</div>
      <div class="feature-card-desc">No signup, no credit card, no email. Click "Create Inbox" and you're ready in under a second.</div>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">🎯</div>
      <div class="feature-card-title">Custom alias</div>
      <div class="feature-card-desc">Choose your own prefix like <code style="color:#0099ff">yourname@dezignwise.online</code> for a more convincing temporary address.</div>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">⏱</div>
      <div class="feature-card-title">Configurable TTL</div>
      <div class="feature-card-desc">10 minutes, 1 hour, or 24 hours. Extend any time. Inbox auto-deletes when expired — no trace left behind.</div>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">🔒</div>
      <div class="feature-card-title">Privacy first</div>
      <div class="feature-card-desc">No logs, no tracking, no account. Session data is completely ephemeral and deleted on expiry.</div>
    </div>
  </div>
</section>

<!-- How it works Section -->
<section class="features-section container" id="how-it-works" style="border-top:1px solid var(--color-hairline-soft)">
  <div class="section-eyebrow">Setup guide</div>
  <h2 class="section-title">Deploy your<br>own instance.</h2>

  <div class="card-grid">
    <div class="feature-card">
      <div class="feature-card-icon">1</div>
      <div class="feature-card-title">Configure DNS</div>
      <div class="feature-card-desc">Add MX, SPF, DKIM, and DMARC records to your domain. Point MX to your Postfix VPS IP.</div>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">2</div>
      <div class="feature-card-title">Setup Postfix</div>
      <div class="feature-card-desc">Install Postfix with catch-all mailbox. Configure it to pipe all incoming mail to the webhook API.</div>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">3</div>
      <div class="feature-card-title">Deploy Backend</div>
      <div class="feature-card-desc">Deploy this Cloudflare Pages app. Connect Neon PostgreSQL for persistent storage.</div>
    </div>
    <div class="feature-card">
      <div class="feature-card-icon">4</div>
      <div class="feature-card-title">Done</div>
      <div class="feature-card-desc">Share your inbox URL. Emails arrive in seconds via the Postfix → API pipeline.</div>
    </div>
  </div>
</section>

<!-- Footer -->
<footer>
  <div class="footer-inner">
    <div class="footer-brand">
      <div class="footer-brand-name">Dezignmail</div>
      <div class="footer-brand-desc">Disposable email service on dezignwise.online. Built with Hono, Cloudflare Pages, and Neon PostgreSQL.</div>
    </div>
    <div class="footer-links">
      <h4>Product</h4>
      <ul>
        <li><a href="#features">Features</a></li>
        <li><a href="#how-it-works">How it works</a></li>
        <li><a href="/api/health">API Status</a></li>
      </ul>
    </div>
    <div class="footer-links">
      <h4>API</h4>
      <ul>
        <li><a href="/api/health">Health</a></li>
        <li><a href="/api/domains">Domains</a></li>
        <li><a href="https://github.com" target="_blank">GitHub</a></li>
      </ul>
    </div>
    <div class="footer-links">
      <h4>Legal</h4>
      <ul>
        <li><a href="#">Privacy</a></li>
        <li><a href="#">Terms</a></li>
        <li><a href="#">Contact</a></li>
      </ul>
    </div>
  </div>
  <div class="footer-bottom">
    © 2024 Dezignmail. Powered by Cloudflare Pages · dezignwise.online
  </div>
</footer>

<!-- Toast -->
<div id="toast"></div>

<script>
// ── State ─────────────────────────────────────────────────────────────────
let state = {
  sessionId: null,
  emailAddress: null,
  expiresAt: null,
  ttlSeconds: 600,
  totalTtl: 600,
  messages: [],
  pollingInterval: null,
  timerInterval: null
}

// ── Init ──────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const saved = sessionStorage.getItem('dezignmail_session')
  if (saved) {
    try {
      const data = JSON.parse(saved)
      state.sessionId = data.sessionId
      state.emailAddress = data.emailAddress
      state.expiresAt = data.expiresAt
      state.totalTtl = data.totalTtl || 600
      updateAddressDisplay()
      document.getElementById('view-btn').style.display = 'inline-flex'
    } catch(e) {}
  }
  generatePreviewEmail()
})

// ── Helpers ───────────────────────────────────────────────────────────────
function generatePreviewEmail() {
  const adj = ['swift','dark','bright','cool','smart','fast','deep','sharp'][Math.floor(Math.random()*8)]
  const noun = ['fox','hawk','wolf','bear','eagle','storm','blade','wave'][Math.floor(Math.random()*8)]
  const num = Math.floor(Math.random() * 9000) + 1000
  document.getElementById('current-email').textContent = adj+'.'+noun+'.'+num+'@dezignwise.online'
}

function updateAddressDisplay() {
  if (state.emailAddress) {
    document.getElementById('current-email').textContent = state.emailAddress
  }
}

function selectTTL(btn, ttl) {
  document.querySelectorAll('.ttl-btn').forEach(b => b.classList.remove('active'))
  btn.classList.add('active')
  state.ttlSeconds = ttl
}

function scrollToInbox() {
  document.getElementById('inbox-generator').scrollIntoView({ behavior: 'smooth' })
}

// ── Create Inbox ──────────────────────────────────────────────────────────
async function createInbox() {
  const btn = document.getElementById('create-btn-text')
  btn.innerHTML = '<span class="spinner"></span>'

  const alias = document.getElementById('custom-alias').value.trim()
  try {
    const res = await fetch('/api/inbox/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ttl: state.ttlSeconds,
        custom_alias: alias || undefined
      })
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed')

    state.sessionId = data.session_id
    state.emailAddress = data.email_address
    state.expiresAt = data.expires_at
    state.totalTtl = data.ttl_seconds

    sessionStorage.setItem('dezignmail_session', JSON.stringify({
      sessionId: state.sessionId,
      emailAddress: state.emailAddress,
      expiresAt: state.expiresAt,
      totalTtl: state.totalTtl
    }))

    updateAddressDisplay()
    document.getElementById('view-btn').style.display = 'inline-flex'
    startTimer()
    showToast('Inbox created! ✓')
  } catch(e) {
    showToast('Error: ' + e.message)
  } finally {
    btn.textContent = 'Create Inbox'
  }
}

// ── Timer ─────────────────────────────────────────────────────────────────
function startTimer() {
  document.getElementById('timer-wrapper').classList.add('visible')
  if (state.timerInterval) clearInterval(state.timerInterval)
  updateTimer()
  state.timerInterval = setInterval(updateTimer, 1000)
}

function updateTimer() {
  if (!state.expiresAt) return
  const now = new Date()
  const exp = new Date(state.expiresAt)
  const left = Math.max(0, Math.floor((exp - now) / 1000))
  const pct = Math.min(100, (left / state.totalTtl) * 100)

  const h = Math.floor(left / 3600)
  const m = Math.floor((left % 3600) / 60)
  const s = left % 60
  let txt = ''
  if (h > 0) txt += h+'h '
  if (m > 0 || h > 0) txt += m+'m '
  txt += s+'s'

  document.getElementById('timer-text').textContent = left === 0 ? 'Expired' : txt
  document.getElementById('timer-fill').style.width = pct + '%'
  document.getElementById('timer-fill').style.background = left < 60 ? '#ef4444' : '#0099ff'

  if (left === 0) clearInterval(state.timerInterval)
}

// ── View Inbox ────────────────────────────────────────────────────────────
async function viewInbox() {
  if (!state.sessionId) { showToast('Create an inbox first'); return; }
  document.getElementById('inbox-section').classList.add('visible')
  document.getElementById('inbox-title-email').textContent = state.emailAddress
  document.getElementById('inbox-section').scrollIntoView({ behavior: 'smooth' })
  startPolling()
  await refreshMessages()
}

function startPolling() {
  if (state.pollingInterval) clearInterval(state.pollingInterval)
  state.pollingInterval = setInterval(refreshMessages, 5000)
}

async function refreshMessages() {
  if (!state.sessionId) return
  try {
    const res = await fetch('/api/inbox/'+state.sessionId+'/messages')
    const data = await res.json()
    if (!res.ok) return

    state.messages = data.messages || []
    renderEmailList()
    document.getElementById('inbox-subtitle').textContent =
      data.message_count + ' message' + (data.message_count !== 1 ? 's' : '') +
      ' · ' + data.unread_count + ' unread'
  } catch(e) {
    console.error(e)
  }
}

function renderEmailList() {
  const list = document.getElementById('email-list')
  if (!state.messages.length) {
    list.innerHTML = \`<div class="email-list-empty">
      <div class="email-list-empty-icon">✉</div>
      <div>No messages yet</div>
      <div style="font-size:13px;margin-top:8px;color:#666">Emails sent to your address will appear here.<br>Checking every 5 seconds…</div>
    </div>\`
    return
  }

  list.innerHTML = state.messages.map(m => \`
    <div class="email-item \${m.is_read ? '' : 'unread'}" onclick="openMessage('\${m.id}')">
      <div class="\${m.is_read ? 'email-read-dot' : 'email-unread-dot'}"></div>
      <div class="email-item-body">
        <div class="email-from">\${escHtml(m.from_name || m.from_address)}</div>
        <div class="email-subject">\${escHtml(m.subject)}</div>
        <div class="email-preview">\${escHtml((m.body_text || '').slice(0,100))}</div>
      </div>
      <div class="email-item-meta">
        <div class="email-time">\${formatTime(m.received_at)}</div>
      </div>
    </div>
  \`).join('')
}

// ── Message Detail ────────────────────────────────────────────────────────
async function openMessage(msgId) {
  try {
    const res = await fetch('/api/inbox/'+state.sessionId+'/messages/'+msgId)
    const msg = await res.json()
    if (!res.ok) return

    document.getElementById('detail-subject').textContent = msg.subject
    document.getElementById('detail-from').textContent = (msg.from_name ? msg.from_name+' <' : '') + msg.from_address + (msg.from_name ? '>' : '')
    document.getElementById('detail-to').textContent = msg.inbox_address
    document.getElementById('detail-date').textContent = new Date(msg.received_at).toLocaleString()

    if (msg.body_html) {
      document.getElementById('detail-body').innerHTML = '<div class="email-body-html">'+msg.body_html+'</div>'
    } else {
      document.getElementById('detail-body').innerHTML = '<pre class="email-body-text">'+escHtml(msg.body_text)+'</pre>'
    }

    document.getElementById('detail-delete-btn').onclick = () => deleteMessage(msgId)

    document.getElementById('email-list').style.display = 'none'
    document.getElementById('email-detail').classList.add('visible')

    // Mark as read in local state
    const m = state.messages.find(x => x.id === msgId)
    if (m) m.is_read = true
    renderEmailList()
  } catch(e) { showToast('Error loading message') }
}

function closeDetail() {
  document.getElementById('email-detail').classList.remove('visible')
  document.getElementById('email-list').style.display = ''
}

async function deleteMessage(msgId) {
  try {
    await fetch('/api/inbox/'+state.sessionId+'/messages/'+msgId, { method: 'DELETE' })
    closeDetail()
    await refreshMessages()
    showToast('Message deleted')
  } catch(e) { showToast('Error deleting message') }
}

// ── Inbox Actions ─────────────────────────────────────────────────────────
async function extendInbox() {
  if (!state.sessionId) return
  try {
    const res = await fetch('/api/inbox/'+state.sessionId+'/extend', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ extra_seconds: 3600 })
    })
    const data = await res.json()
    if (res.ok) {
      state.expiresAt = data.expires_at
      state.totalTtl += 3600
      startTimer()
      showToast('Extended by 1 hour ✓')
    }
  } catch(e) { showToast('Error extending inbox') }
}

async function deleteInbox() {
  if (!confirm('Delete this inbox and all messages permanently?')) return
  try {
    await fetch('/api/inbox/'+state.sessionId, { method: 'DELETE' })
    state.sessionId = null; state.emailAddress = null; state.expiresAt = null
    sessionStorage.removeItem('dezignmail_session')
    if (state.pollingInterval) clearInterval(state.pollingInterval)
    if (state.timerInterval) clearInterval(state.timerInterval)
    document.getElementById('inbox-section').classList.remove('visible')
    document.getElementById('view-btn').style.display = 'none'
    document.getElementById('timer-wrapper').classList.remove('visible')
    generatePreviewEmail()
    showToast('Inbox deleted')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch(e) { showToast('Error deleting inbox') }
}

async function refreshEmail() {
  if (state.sessionId) { showToast('Delete current inbox first'); return; }
  generatePreviewEmail()
}

// ── Copy ──────────────────────────────────────────────────────────────────
async function copyEmail() {
  const email = document.getElementById('current-email').textContent
  try {
    await navigator.clipboard.writeText(email)
    showToast('Copied! ' + email)
  } catch(e) {
    showToast('Copy: ' + email)
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────
function escHtml(str) {
  return (str||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function formatTime(iso) {
  const d = new Date(iso)
  const now = new Date()
  const diff = (now - d) / 1000
  if (diff < 60) return 'just now'
  if (diff < 3600) return Math.floor(diff/60)+'m ago'
  if (diff < 86400) return Math.floor(diff/3600)+'h ago'
  return d.toLocaleDateString()
}

let toastTimer
function showToast(msg) {
  const el = document.getElementById('toast')
  el.textContent = msg
  el.classList.add('show')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000)
}
</script>
</body>
</html>`
}

export default app
