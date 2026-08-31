import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { getDb } from './db'
import type { Env } from './types'

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors({
  origin: (origin) => origin, // In production you should dynamically validate against ALLOWED_DOMAINS
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}))

app.use('*', secureHeaders())

// ─── Utility Functions ──────────────────────────────────────────────────────
const ADJECTIVES = ['swift', 'dark', 'bright', 'cool', 'smart', 'fast', 'deep', 'sharp', 'sleek', 'bold']
const NOUNS = ['fox', 'hawk', 'wolf', 'bear', 'eagle', 'storm', 'blade', 'wave', 'spark', 'ghost']

function generateRandomEmail(domain: string = 'example.com'): string {
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
  return email.split('@')[1] || 'example.com'
}

// ─── In-Memory Fallback Store ───────────────────────────────────────────────
interface EmailMessage {
  id: string
  inbox_id?: string
  inbox_address: string
  from_address: string
  from_name?: string
  subject: string
  body_text: string
  body_html: string
  received_at: string
  is_read: boolean
  has_attachments?: boolean
  size?: number
}

interface InboxSession {
  id: string
  address: string
  alias?: string
  created_at: string
  expires_at: string
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
function seedDemoData(emailAddress: string) {
  const now = new Date()

  const demoEmails: EmailMessage[] = [
    {
      id: `msg-demo-${Date.now()}-1`,
      inbox_address: emailAddress,
      from_address: 'welcome@github.com',
      from_name: 'GitHub',
      subject: 'Welcome to GitHub! Please verify your email',
      body_text: 'Hi there! Please click the link below to verify your email address...',
      body_html: '<h2>Welcome to GitHub!</h2><p>Please <a href="#">click here</a> to verify your email address.</p>',
      received_at: new Date(now.getTime() - 120000).toISOString(),
      is_read: false,
    },
    {
      id: `msg-demo-${Date.now()}-2`,
      inbox_address: emailAddress,
      from_address: 'noreply@discord.com',
      from_name: 'Discord',
      subject: 'Your Discord verification code: 847291',
      body_text: 'Your Discord verification code is: 847291. This code expires in 10 minutes.',
      body_html: '<div style="font-family:sans-serif"><h3>Discord Verification</h3><p>Your code: <strong>847291</strong></p></div>',
      received_at: new Date(now.getTime() - 300000).toISOString(),
      is_read: true,
    },
    {
      id: `msg-demo-${Date.now()}-3`,
      inbox_address: emailAddress,
      from_address: 'security@twitter.com',
      from_name: 'Twitter Security',
      subject: 'Confirm your Twitter account',
      body_text: 'To complete your Twitter registration, please confirm your email address.',
      body_html: '<div><h2>Confirm your account</h2><p>Click below to confirm your Twitter account.</p><a href="#" style="background:#1DA1F2;color:#fff;padding:10px 20px;border-radius:100px;text-decoration:none">Confirm Email</a></div>',
      received_at: new Date(now.getTime() - 600000).toISOString(),
      is_read: false,
    }
  ]
  return demoEmails;
}

// ─── API Routes ─────────────────────────────────────────────────────────────

// POST /api/inbox/create - Create a new temporary inbox
app.post('/api/inbox/create', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const ttl = body.ttl || 600 // default 10 minutes
  const customAlias = body.custom_alias
  const isDemo = c.req.query("demo") === "true"

  const sessionId = generateSessionId()
  const primaryDomain = (c.env.ALLOWED_DOMAINS || 'example.com').split(',')[0].trim()
  const emailAddress = customAlias
    ? `${customAlias}@${primaryDomain}`
    : generateRandomEmail(primaryDomain)

  const now = new Date()
  const expires = new Date(now.getTime() + ttl * 1000)

  if (c.env.DATABASE_URL) {
    const db = getDb(c.env.DATABASE_URL)
    try {
      await db`
        INSERT INTO inboxes (id, address, alias, expires_at)
        VALUES (${sessionId}, ${emailAddress}, ${customAlias || null}, ${expires.toISOString()})
      `
      if (isDemo) {
        const demoEmails = seedDemoData(emailAddress);
        for (const msg of demoEmails) {
            await db`
                INSERT INTO messages (id, inbox_id, inbox_address, from_address, subject, body_html, body_text, received_at, is_read)
                VALUES (${msg.id}, ${sessionId}, ${emailAddress}, ${msg.from_address}, ${msg.subject}, ${msg.body_html || ''}, ${msg.body_text || ''}, ${msg.received_at}, ${msg.is_read})
            `
        }
      }
    } catch (e) {
      console.error('DB error:', e)
      return c.json({ success: false, error: 'Database error' }, 500)
    }
  } else {
    console.warn('[dezignmail] DATABASE_URL not set, using in-memory store')
    const session: InboxSession = {
      id: sessionId,
      address: emailAddress,
      alias: customAlias,
      created_at: now.toISOString(),
      expires_at: expires.toISOString(),
      is_active: true
    }
    memoryStore.sessions.set(sessionId, session)
    memoryStore.emails.set(emailAddress, isDemo ? seedDemoData(emailAddress) : [])
  }

  return c.json({
    success: true,
    data: {
      session_id: sessionId,
      email_address: emailAddress,
      expires_at: expires.toISOString(),
      ttl_seconds: ttl,
      domain: getDomainFromEmail(emailAddress)
    }
  }, 200)
})

// GET /api/inbox/:sessionId - Get inbox info
app.get('/api/inbox/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')

  let session: InboxSession | null = null

  if (c.env.DATABASE_URL) {
    const db = getDb(c.env.DATABASE_URL)
    try {
      const rows = await db`SELECT * FROM inboxes WHERE id = ${sessionId} AND is_active = true`
      session = (rows[0] as unknown as InboxSession) || null
    } catch (e) {
      console.error('DB error:', e)
      return c.json({ success: false, error: 'Database error' }, 500)
    }
  } else {
    console.warn('[dezignmail] DATABASE_URL not set, using in-memory store')
    session = memoryStore.sessions.get(sessionId) || null
  }

  if (!session) {
    return c.json({ success: false, error: 'Session not found' }, 404)
  }

  const now = new Date()
  const expiresAt = new Date(session.expires_at)
  const timeLeft = Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000))
  const isExpired = timeLeft === 0

  if (isExpired) {
    session.is_active = false
  }

  return c.json({
    success: true,
    data: {
      session_id: session.id,
      email_address: session.address,
      created_at: session.created_at,
      expires_at: session.expires_at,
      time_left_seconds: timeLeft,
      is_active: !isExpired,
      domain: getDomainFromEmail(session.address)
    }
  }, 200)
})

// GET /api/inbox/:sessionId/messages - Get all messages for inbox
app.get('/api/inbox/:sessionId/messages', async (c) => {
  const sessionId = c.req.param('sessionId')

  let session: InboxSession | null = null

  if (c.env.DATABASE_URL) {
    const db = getDb(c.env.DATABASE_URL)
    try {
      const rows = await db`SELECT * FROM inboxes WHERE id = ${sessionId}`
      session = (rows[0] as unknown as InboxSession) || null
    } catch (e) {
      console.error('DB error:', e)
      return c.json({ success: false, error: 'Database error' }, 500)
    }
  } else {
    console.warn('[dezignmail] DATABASE_URL not set, using in-memory store')
    session = memoryStore.sessions.get(sessionId) || null
  }

  if (!session) {
    return c.json({ success: false, error: 'Session not found' }, 404)
  }

  let messages: EmailMessage[] = []

  if (c.env.DATABASE_URL) {
    const db = getDb(c.env.DATABASE_URL)
    try {
      const rows = await db`SELECT * FROM messages WHERE inbox_id = ${sessionId} ORDER BY received_at DESC`
      messages = (rows as unknown as EmailMessage[]) || []
    } catch (e) {
      console.error('DB error:', e)
      return c.json({ success: false, error: 'Database error' }, 500)
    }
  } else {
    messages = memoryStore.emails.get(session.address) || []
  }

  return c.json({
    success: true,
    data: {
      session_id: sessionId,
      email_address: session.address,
      message_count: messages.length,
      unread_count: messages.filter(m => !m.is_read).length,
      messages: messages
    }
  }, 200)
})

// GET /api/inbox/:sessionId/messages/:msgId - Get single message
app.get('/api/inbox/:sessionId/messages/:msgId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const msgId = c.req.param('msgId')

  let session: InboxSession | null = null

  if (c.env.DATABASE_URL) {
    const db = getDb(c.env.DATABASE_URL)
    try {
      const rows = await db`SELECT * FROM inboxes WHERE id = ${sessionId}`
      session = (rows[0] as unknown as InboxSession) || null
    } catch (e) {
      console.error('DB error:', e)
      return c.json({ success: false, error: 'Database error' }, 500)
    }
  } else {
    console.warn('[dezignmail] DATABASE_URL not set, using in-memory store')
    session = memoryStore.sessions.get(sessionId) || null
  }

  if (!session) {
    return c.json({ success: false, error: 'Session not found' }, 404)
  }

  let message: EmailMessage | null = null

  if (c.env.DATABASE_URL) {
    const db = getDb(c.env.DATABASE_URL)
    try {
      const rows = await db`SELECT * FROM messages WHERE id = ${msgId}`
      message = (rows[0] as unknown as EmailMessage) || null
      if (message) {
        await db`UPDATE messages SET is_read = true WHERE id = ${msgId}`
        message.is_read = true
      }
    } catch (e) {
      console.error('DB error:', e)
      return c.json({ success: false, error: 'Database error' }, 500)
    }
  } else {
    const msgs = memoryStore.emails.get(session.address) || []
    message = msgs.find(m => m.id === msgId) || null
    if (message) message.is_read = true
  }

  if (!message) {
    return c.json({ success: false, error: 'Message not found' }, 404)
  }

  return c.json({ success: true, data: message }, 200)
})

// DELETE /api/inbox/:sessionId/messages/:msgId - Delete a message
app.delete('/api/inbox/:sessionId/messages/:msgId', async (c) => {
  const sessionId = c.req.param('sessionId')
  const msgId = c.req.param('msgId')

  if (c.env.DATABASE_URL) {
    const db = getDb(c.env.DATABASE_URL)
    try {
      await db`DELETE FROM messages WHERE id = ${msgId} AND inbox_id = ${sessionId}`
    } catch (e) {
      console.error('DB error:', e)
      return c.json({ success: false, error: 'Database error' }, 500)
    }
  } else {
    console.warn('[dezignmail] DATABASE_URL not set, using in-memory store')
    const session = memoryStore.sessions.get(sessionId)
    if (!session) return c.json({ success: false, error: 'Session not found' }, 404)
    const msgs = memoryStore.emails.get(session.address) || []
    memoryStore.emails.set(session.address, msgs.filter(m => m.id !== msgId))
  }

  return c.json({ success: true, data: { message: 'Message deleted' } }, 200)
})

// DELETE /api/inbox/:sessionId - Delete entire inbox / session
app.delete('/api/inbox/:sessionId', async (c) => {
  const sessionId = c.req.param('sessionId')

  if (c.env.DATABASE_URL) {
    const db = getDb(c.env.DATABASE_URL)
    try {
      await db`UPDATE inboxes SET is_active = false WHERE id = ${sessionId}`
    } catch (e) {
      console.error('DB error:', e)
      return c.json({ success: false, error: 'Database error' }, 500)
    }
  } else {
    console.warn('[dezignmail] DATABASE_URL not set, using in-memory store')
    const session = memoryStore.sessions.get(sessionId)
    if (session) {
      memoryStore.emails.delete(session.address)
      memoryStore.sessions.delete(sessionId)
    }
  }

  return c.json({ success: true, data: { message: 'Inbox deleted' } }, 200)
})

// POST /api/inbox/:sessionId/extend - Extend TTL
app.post('/api/inbox/:sessionId/extend', async (c) => {
  const sessionId = c.req.param('sessionId')

  if (c.env.DATABASE_URL) {
    const db = getDb(c.env.DATABASE_URL)
    try {
      await db`UPDATE inboxes SET expires_at = expires_at + INTERVAL '1 hour' WHERE id = ${sessionId}`
      // Fetch the updated expires_at to return
      const rows = await db`SELECT expires_at FROM inboxes WHERE id = ${sessionId}`
      if (rows.length > 0) {
          return c.json({ success: true, data: { expires_at: rows[0].expires_at } }, 200)
      }
      return c.json({ success: false, error: 'Session not found' }, 404)
    } catch (e) {
      console.error('DB error:', e)
      return c.json({ success: false, error: 'Database error' }, 500)
    }
  } else {
    console.warn('[dezignmail] DATABASE_URL not set, using in-memory store')
    let session = memoryStore.sessions.get(sessionId) || null
    if (!session) return c.json({ success: false, error: 'Session not found' }, 404)
    const newExpiry = new Date(new Date(session.expires_at).getTime() + 3600 * 1000)
    session.expires_at = newExpiry.toISOString()
    return c.json({ success: true, data: { expires_at: newExpiry.toISOString() } }, 200)
  }
})

// POST /api/receive - Webhook endpoint for Postfix/mail server to deliver emails
app.post('/api/receive', async (c) => {
  const body = await c.req.json().catch(() => null)
  if (!body) return c.json({ success: false, error: 'Invalid payload' }, 400)

  const { to, from, from_name, subject, body_text, body_html, size } = body as any
  const inboxAddress = (to || '').toLowerCase().trim()
  if (!inboxAddress) return c.json({ success: false, error: 'Missing to address' }, 400)

  const msgId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()

  if (c.env.DATABASE_URL) {
    const db = getDb(c.env.DATABASE_URL)
    try {
      // Find inbox
      const inboxes = await db`SELECT id FROM inboxes WHERE address = ${inboxAddress} AND is_active = true AND expires_at > NOW()`
      if (inboxes.length === 0) {
        return c.json({ success: false, error: 'Inbox not found or expired' }, 404)
      }
      const inboxId = inboxes[0].id

      await db`
        INSERT INTO messages (id, inbox_id, inbox_address, from_address, subject, body_html, body_text)
        VALUES (${msgId}, ${inboxId}, ${inboxAddress}, ${from || 'unknown@unknown.com'}, ${subject || '(no subject)'}, ${body_html || ''}, ${body_text || ''})
      `
    } catch (e) {
      console.error('DB error storing message:', e)
      return c.json({ success: false, error: 'Database error' }, 500)
    }
  } else {
    console.warn('[dezignmail] DATABASE_URL not set, using in-memory store')
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
    const msgs = memoryStore.emails.get(inboxAddress) || []
    msgs.unshift(newMessage)
    memoryStore.emails.set(inboxAddress, msgs)
  }

  return c.json({ success: true, data: { message_id: msgId } }, 200)
})



app.get('/api/health', async (c) => {
  let dbStatus = 'disconnected'

  if (c.env.DATABASE_URL) {
    try {
      const sql = getDb(c.env.DATABASE_URL)
      await sql`SELECT 1`
      dbStatus = 'connected'
    } catch {
      dbStatus = 'error'
    }
  } else {
    dbStatus = 'in-memory'
  }

  return c.json({
    success: true,
    data: {
      status: 'ok',
      db: dbStatus,
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    }
  })
})

app.get('/api/domains', (c) => {
  const domains = (c.env.ALLOWED_DOMAINS || 'example.com').split(',').map(d => d.trim())
  return c.json({ success: true, data: { domains } })
})

export default app
