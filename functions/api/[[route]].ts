/**
 * Dezignmail — Cloudflare Pages Functions API
 *
 * Email reception is handled by Cloudflare Email Routing (see src/index.ts).
 * This file exposes the REST API consumed by the frontend.
 *
 * Bindings required (wrangler.toml):
 *   D1  — dezignmail-d1
 *   R2  — dezignmail-attachments
 *   ALLOWED_DOMAINS  — e.g. "healthtek.eu.cc"
 *   HOURS_TO_DELETE  — default 3
 */

import { Hono } from 'hono'
import { handle } from 'hono/cloudflare-pages'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import * as db from '../../src/database/d1'
import * as r2 from '../../src/database/r2'
import { getDomain, generateId, now } from '../../src/utils/helpers'
import type { Env } from '../../src/types'

/**
 * Lazy cleanup: runs non-blocking on inbox poll requests.
 * Replaces the cron trigger (unsupported on hosted deploy).
 * Deletes emails older than HOURS_TO_DELETE hours.
 */
async function lazyCleanup(env: Env): Promise<void> {
  try {
    const hours = Number(env.HOURS_TO_DELETE ?? 3)
    const cutoff = now() - hours * 3600
    const { deleted } = await db.deleteOldEmails(env.D1, cutoff)
    if (deleted > 0) console.log(`[cleanup] Deleted ${deleted} email(s) older than ${hours}h`)
  } catch (e) {
    console.warn('[cleanup] Lazy cleanup error (non-fatal):', e)
  }
}

const app = new Hono<{ Bindings: Env }>()

// ─── Middleware ───────────────────────────────────────────────────────────────

app.use('*', cors({
  origin: (origin) => {
    // In production restrict to allowed domains; permissive in dev
    return origin || '*'
  },
  allowMethods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
  maxAge: 86400,
}))

app.use('*', secureHeaders())

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAllowedDomains(env: Env): string[] {
  return (env.ALLOWED_DOMAINS || 'healthtek.eu.cc').split(',').map((d) => d.trim())
}

function isDomainAllowed(address: string, env: Env): boolean {
  const domain = getDomain(address)
  return getAllowedDomains(env).includes(domain)
}

function generateAddress(env: Env): string {
  const adj = ['swift', 'dark', 'bright', 'cool', 'smart', 'fast', 'deep', 'sharp', 'sleek', 'bold']
  const noun = ['fox', 'hawk', 'wolf', 'bear', 'eagle', 'storm', 'blade', 'wave', 'spark', 'ghost']
  const a = adj[Math.floor(Math.random() * adj.length)]
  const n = noun[Math.floor(Math.random() * noun.length)]
  const num = Math.floor(Math.random() * 9000) + 1000
  const domain = getAllowedDomains(env)[0]
  return `${a}.${n}.${num}@${domain}`
}

// ─── Email API Routes ─────────────────────────────────────────────────────────

/**
 * GET /api/domains — list allowed email domains
 */
app.get('/api/domains', (c) => {
  return c.json({ success: true, result: getAllowedDomains(c.env) })
})

/**
 * GET /api/health — connectivity check
 */
app.get('/api/health', async (c) => {
  let dbStatus = 'disconnected'
  try {
    await c.env.D1.prepare('SELECT 1').run()
    dbStatus = 'connected'
  } catch {
    dbStatus = 'error'
  }
  return c.json({ success: true, result: { status: 'ok', database: dbStatus, timestamp: new Date().toISOString() } })
})

/**
 * GET /api/address/generate — generate a random temporary address
 */
app.get('/api/address/generate', (c) => {
  return c.json({ success: true, result: { address: generateAddress(c.env) } })
})

/**
 * GET /api/emails/:address — list emails for an inbox address
 * Query params: limit (default 50), offset (default 0)
 */
app.get('/api/emails/:address', async (c) => {
  const address = decodeURIComponent(c.req.param('address')).toLowerCase()
  if (!isDomainAllowed(address, c.env)) {
    return c.json({ success: false, error: 'Domain not supported' }, 404)
  }

  // Lazy cleanup: runs non-blocking — replaces cron trigger
  c.executionCtx.waitUntil(lazyCleanup(c.env))

  const limit = Math.min(Number(c.req.query('limit') ?? 50), 100)
  const offset = Number(c.req.query('offset') ?? 0)

  const { emails, error } = await db.getEmailsByRecipient(c.env.D1, address, limit, offset)
  if (error) return c.json({ success: false, error: error.message }, 500)

  return c.json({ success: true, result: emails })
})

/**
 * GET /api/emails/:address/count — email count for an address
 */
app.get('/api/emails/:address/count', async (c) => {
  const address = decodeURIComponent(c.req.param('address')).toLowerCase()
  if (!isDomainAllowed(address, c.env)) {
    return c.json({ success: false, error: 'Domain not supported' }, 404)
  }

  const { count, error } = await db.countEmailsByRecipient(c.env.D1, address)
  if (error) return c.json({ success: false, error: error.message }, 500)

  return c.json({ success: true, result: { count } })
})

/**
 * DELETE /api/emails/:address — delete all emails for an address
 */
app.delete('/api/emails/:address', async (c) => {
  const address = decodeURIComponent(c.req.param('address')).toLowerCase()
  if (!isDomainAllowed(address, c.env)) {
    return c.json({ success: false, error: 'Domain not supported' }, 404)
  }

  // First get email IDs so we can clean up R2 attachments
  const { emails } = await db.getEmailsByRecipient(c.env.D1, address, 1000, 0)

  // Delete R2 attachments for all emails (non-blocking)
  c.executionCtx.waitUntil(
    Promise.all(emails.filter((e) => e.has_attachments).map((e) => r2.deleteEmailAttachments(c.env.R2, e.id))),
  )

  const { changes, error } = await db.deleteEmailsByRecipient(c.env.D1, address)
  if (error) return c.json({ success: false, error: error.message }, 500)

  return c.json({ success: true, result: { message: 'Deleted', deleted_count: changes } })
})

/**
 * GET /api/inbox/:emailId — get a single email by ID (full content)
 */
app.get('/api/inbox/:emailId', async (c) => {
  const { emailId } = c.req.param()
  const { email, error } = await db.getEmailById(c.env.D1, emailId)
  if (error) return c.json({ success: false, error: error.message }, 500)
  if (!email) return c.json({ success: false, error: 'Email not found' }, 404)
  return c.json({ success: true, result: email })
})

/**
 * DELETE /api/inbox/:emailId — delete a single email + its R2 attachments
 */
app.delete('/api/inbox/:emailId', async (c) => {
  const { emailId } = c.req.param()

  const { email } = await db.getEmailById(c.env.D1, emailId)
  if (!email) return c.json({ success: false, error: 'Email not found' }, 404)

  // Clean up R2 attachments in background
  if (email.has_attachments) {
    c.executionCtx.waitUntil(r2.deleteEmailAttachments(c.env.R2, emailId))
  }

  const { changes, error } = await db.deleteEmailById(c.env.D1, emailId)
  if (error) return c.json({ success: false, error: error.message }, 500)
  if (changes === 0) return c.json({ success: false, error: 'Email not found' }, 404)

  return c.json({ success: true, result: { message: 'Email deleted' } })
})

// ─── Attachment API Routes ────────────────────────────────────────────────────

/**
 * GET /api/inbox/:emailId/attachments — list attachments for an email
 */
app.get('/api/inbox/:emailId/attachments', async (c) => {
  const { emailId } = c.req.param()
  const { email, error: emailErr } = await db.getEmailById(c.env.D1, emailId)
  if (emailErr) return c.json({ success: false, error: emailErr.message }, 500)
  if (!email) return c.json({ success: false, error: 'Email not found' }, 404)

  const { attachments, error } = await db.getAttachmentsByEmailId(c.env.D1, emailId)
  if (error) return c.json({ success: false, error: error.message }, 500)

  return c.json({ success: true, result: attachments })
})

/**
 * GET /api/attachments/:attachmentId — download a specific attachment
 */
app.get('/api/attachments/:attachmentId', async (c) => {
  const { attachmentId } = c.req.param()

  const { attachment, error: dbErr } = await db.getAttachmentById(c.env.D1, attachmentId)
  if (dbErr) return c.json({ success: false, error: dbErr.message }, 500)
  if (!attachment) return c.json({ success: false, error: 'Attachment not found' }, 404)

  const { success, object, error: r2Err } = await r2.getAttachment(c.env.R2, attachment.r2_key)
  if (!success || !object) return c.json({ success: false, error: r2Err?.message ?? 'Not found in storage' }, 404)

  c.header('Content-Type', attachment.content_type)
  c.header('Content-Disposition', `attachment; filename="${attachment.filename}"`)
  c.header('Content-Length', attachment.size.toString())
  return c.body(object.body)
})

/**
 * DELETE /api/attachments/:attachmentId — delete a specific attachment
 */
app.delete('/api/attachments/:attachmentId', async (c) => {
  const { attachmentId } = c.req.param()

  const { attachment, error: dbErr } = await db.getAttachmentById(c.env.D1, attachmentId)
  if (dbErr) return c.json({ success: false, error: dbErr.message }, 500)
  if (!attachment) return c.json({ success: false, error: 'Attachment not found' }, 404)

  await r2.deleteAttachment(c.env.R2, attachment.r2_key)

  const { success, error } = await db.deleteAttachmentById(c.env.D1, attachmentId)
  if (!success) return c.json({ success: false, error: error?.message ?? 'Delete failed' }, 500)

  // Update email attachment count
  const { attachments: remaining } = await db.getAttachmentsByEmailId(c.env.D1, attachment.email_id)
  await db.updateEmailAttachmentInfo(c.env.D1, attachment.email_id, remaining.length > 0, remaining.length)

  return c.json({ success: true, result: { message: 'Attachment deleted' } })
})

// ─── Legacy compat routes (keeps old frontend working during migration) ────────

/**
 * POST /api/inbox/create — backwards compat shim
 * The new model has no "sessions" — just use an email address directly.
 * Returns a generated address the client can poll with GET /api/emails/:address
 */
app.post('/api/inbox/create', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const alias = (body.custom_alias as string | undefined)?.trim()
  const primaryDomain = getAllowedDomains(c.env)[0]

  let address: string
  if (alias) {
    if (!/^[a-z0-9._-]{1,60}$/i.test(alias)) {
      return c.json({ success: false, error: 'Invalid alias. Use only letters, numbers, dots, hyphens.' }, 400)
    }
    address = `${alias.toLowerCase()}@${primaryDomain}`
  } else {
    address = generateAddress(c.env)
  }

  return c.json({
    success: true,
    data: {
      // session_id is now just the email address itself
      session_id: address,
      email_address: address,
      domain: getDomain(address),
    },
  })
})

/**
 * GET /api/inbox/:sessionId — legacy inbox status
 * New model: we don't have TTL/sessions; return active=true always
 */
app.get('/api/inbox/:sessionId', async (c) => {
  const raw = c.req.param('sessionId')
  // sessionId is the email address (URL-encoded)
  const address = decodeURIComponent(raw).toLowerCase()

  if (!isDomainAllowed(address, c.env)) {
    return c.json({ success: false, error: 'Domain not supported' }, 404)
  }

  const { count } = await db.countEmailsByRecipient(c.env.D1, address)

  return c.json({
    success: true,
    data: {
      session_id: address,
      email_address: address,
      is_active: true,
      time_left_seconds: null, // no TTL in new model
      message_count: count,
      domain: getDomain(address),
    },
  })
})

/**
 * GET /api/inbox/:sessionId/messages — legacy messages list
 */
app.get('/api/inbox/:sessionId/messages', async (c) => {
  const address = decodeURIComponent(c.req.param('sessionId')).toLowerCase()
  if (!isDomainAllowed(address, c.env)) {
    return c.json({ success: false, error: 'Domain not supported' }, 404)
  }

  const { emails, error } = await db.getEmailsByRecipient(c.env.D1, address, 50, 0)
  if (error) return c.json({ success: false, error: error.message }, 500)

  return c.json({
    success: true,
    data: {
      session_id: address,
      email_address: address,
      message_count: emails.length,
      unread_count: 0, // no read tracking in new model
      messages: emails.map((e) => ({
        id: e.id,
        inbox_address: e.to_address,
        from_address: e.from_address,
        from_name: e.from_address,
        subject: e.subject ?? '(no subject)',
        body_text: '',
        body_html: '',
        received_at: new Date(e.received_at * 1000).toISOString(),
        is_read: false,
        has_attachments: e.has_attachments,
      })),
    },
  })
})

/**
 * GET /api/inbox/:sessionId/messages/:msgId — legacy single message
 */
app.get('/api/inbox/:sessionId/messages/:msgId', async (c) => {
  const { msgId } = c.req.param()
  const { email, error } = await db.getEmailById(c.env.D1, msgId)
  if (error) return c.json({ success: false, error: error.message }, 500)
  if (!email) return c.json({ success: false, error: 'Email not found' }, 404)

  return c.json({
    success: true,
    data: {
      id: email.id,
      inbox_address: email.to_address,
      from_address: email.from_address,
      from_name: email.from_address,
      subject: email.subject ?? '(no subject)',
      body_text: email.text_content ?? '',
      body_html: email.html_content ?? '',
      received_at: new Date(email.received_at * 1000).toISOString(),
      is_read: true,
      has_attachments: email.has_attachments,
      attachment_count: email.attachment_count,
    },
  })
})

/**
 * DELETE /api/inbox/:sessionId/messages/:msgId — legacy delete single email
 */
app.delete('/api/inbox/:sessionId/messages/:msgId', async (c) => {
  const { msgId } = c.req.param()

  const { email } = await db.getEmailById(c.env.D1, msgId)
  if (email?.has_attachments) {
    c.executionCtx.waitUntil(r2.deleteEmailAttachments(c.env.R2, msgId))
  }

  const { error } = await db.deleteEmailById(c.env.D1, msgId)
  if (error) return c.json({ success: false, error: error.message }, 500)

  return c.json({ success: true, data: { message: 'Email deleted' } })
})

/**
 * DELETE /api/inbox/:sessionId — legacy delete entire inbox
 */
app.delete('/api/inbox/:sessionId', async (c) => {
  const address = decodeURIComponent(c.req.param('sessionId')).toLowerCase()
  if (!isDomainAllowed(address, c.env)) {
    return c.json({ success: false, error: 'Domain not supported' }, 404)
  }

  const { emails } = await db.getEmailsByRecipient(c.env.D1, address, 1000, 0)
  c.executionCtx.waitUntil(
    Promise.all(emails.filter((e) => e.has_attachments).map((e) => r2.deleteEmailAttachments(c.env.R2, e.id))),
  )

  await db.deleteEmailsByRecipient(c.env.D1, address)
  return c.json({ success: true, data: { message: 'Inbox deleted' } })
})

/**
 * POST /api/inbox/:sessionId/extend — no-op in new model (no TTL)
 */
app.post('/api/inbox/:sessionId/extend', (c) => {
  return c.json({ success: true, data: { message: 'Inboxes have no expiry in the new model.' } })
})

export const onRequest = handle(app)
