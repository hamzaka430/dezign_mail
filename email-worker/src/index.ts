/**
 * dezignmail-email — Cloudflare Email Worker
 *
 * Receives inbound SMTP messages via Cloudflare Email Routing catch-all,
 * parses them with postal-mime, and stores them in the shared D1 + R2
 * that the dezignmail Pages app reads from.
 *
 * Bindings required (set in wrangler.toml):
 *   D1  — dezignmail-d1 (SQLite)
 *   R2  — dezignmail-attachments
 */

import PostalMime from 'postal-mime'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Env {
  D1: D1Database
  R2: R2Bucket
  ALLOWED_DOMAINS: string
  HOURS_TO_DELETE: number
}

interface AttachmentRow {
  id: string
  email_id: string
  filename: string
  content_type: string
  size: number
  r2_key: string
  created_at: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024  // 10 MB
const MAX_ATTACHMENTS     = 10
const ALLOWED_MIME_TYPES  = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'text/plain', 'text/csv', 'text/html',
  'application/zip',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/octet-stream',
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function now(): number {
  return Math.floor(Date.now() / 1000)
}

function generateId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/on\w+='[^']*'/gi, '')
    .replace(/javascript:/gi, '')
}

function processEmailContent(
  html: string | null,
  text: string | null,
): { htmlContent: string | null; textContent: string | null } {
  return {
    htmlContent: html ? sanitizeHtml(html) : null,
    textContent: text ?? null,
  }
}

function buildR2Key(emailId: string, attId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `emails/${emailId}/${attId}/${safe}`
}

// ─── D1 helpers ───────────────────────────────────────────────────────────────

async function insertEmail(db: D1Database, row: {
  id: string
  from_address: string
  to_address: string
  subject: string | null
  received_at: number
  html_content: string | null
  text_content: string | null
  has_attachments: boolean
  attachment_count: number
}): Promise<{ success: boolean; error?: string }> {
  try {
    await db.prepare(`
      INSERT INTO emails
        (id, from_address, to_address, subject, received_at,
         html_content, text_content, has_attachments, attachment_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      row.id,
      row.from_address,
      row.to_address,
      row.subject,
      row.received_at,
      row.html_content,
      row.text_content,
      row.has_attachments ? 1 : 0,
      row.attachment_count,
    ).run()
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message ?? String(e) }
  }
}

async function insertAttachment(db: D1Database, row: AttachmentRow): Promise<{ success: boolean; error?: string }> {
  try {
    await db.prepare(`
      INSERT INTO attachments (id, email_id, filename, content_type, size, r2_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      row.id, row.email_id, row.filename,
      row.content_type, row.size, row.r2_key, row.created_at,
    ).run()
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message ?? String(e) }
  }
}

// ─── R2 helpers ───────────────────────────────────────────────────────────────

async function storeAttachment(
  bucket: R2Bucket,
  key: string,
  body: ArrayBuffer,
  contentType: string,
  filename: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await bucket.put(key, body, {
      httpMetadata: { contentType },
      customMetadata: { filename },
    })
    return { success: true }
  } catch (e: any) {
    return { success: false, error: e?.message ?? String(e) }
  }
}

async function deleteR2Object(bucket: R2Bucket, key: string): Promise<void> {
  try { await bucket.delete(key) } catch { /* non-fatal */ }
}

// ─── Attachment processing ────────────────────────────────────────────────────

interface RawAtt {
  filename: string | null
  mimeType?: string
  content?: string | ArrayBuffer | Uint8Array
}

function getByteLength(content: string | ArrayBuffer | Uint8Array | undefined): number {
  if (!content) return 0
  if (content instanceof ArrayBuffer) return content.byteLength
  if (content instanceof Uint8Array) return content.byteLength
  return new TextEncoder().encode(content).byteLength
}

function toArrayBuffer(content: string | ArrayBuffer | Uint8Array | undefined): ArrayBuffer {
  if (!content) return new ArrayBuffer(0)
  if (content instanceof ArrayBuffer) return content
  if (content instanceof Uint8Array) return content.buffer as ArrayBuffer
  return new TextEncoder().encode(content).buffer as ArrayBuffer
}

function filterAttachments(attachments: RawAtt[], emailId: string): RawAtt[] {
  const valid: RawAtt[] = []
  let totalSize = 0
  for (const att of attachments) {
    if (!att.filename) continue
    if (valid.length >= MAX_ATTACHMENTS) break
    const ct = att.mimeType ?? 'application/octet-stream'
    if (!ALLOWED_MIME_TYPES.includes(ct)) {
      console.warn(`[email] ${emailId}: skipping ${att.filename} — type ${ct} not allowed`)
      continue
    }
    const size = getByteLength(att.content)
    if (size > MAX_ATTACHMENT_SIZE) {
      console.warn(`[email] ${emailId}: skipping ${att.filename} — too large (${size} bytes)`)
      continue
    }
    totalSize += size
    if (totalSize > MAX_ATTACHMENT_SIZE * MAX_ATTACHMENTS) break
    valid.push(att)
  }
  return valid
}

async function storeOneAttachment(env: Env, emailId: string, att: RawAtt): Promise<void> {
  if (!att.filename) return
  const attId   = generateId()
  const key     = buildR2Key(emailId, attId, att.filename)
  const ct      = att.mimeType ?? 'application/octet-stream'
  const body    = toArrayBuffer(att.content)
  const size    = body.byteLength

  const { success: r2Ok, error: r2Err } = await storeAttachment(env.R2, key, body, ct, att.filename)
  if (!r2Ok) { console.error(`[email] R2 store failed for ${att.filename}:`, r2Err); return }

  const { success: dbOk, error: dbErr } = await insertAttachment(env.D1, {
    id: attId, email_id: emailId, filename: att.filename,
    content_type: ct, size, r2_key: key, created_at: now(),
  })
  if (!dbOk) {
    console.error(`[email] D1 insert failed for ${att.filename}:`, dbErr)
    await deleteR2Object(env.R2, key)
  }
}

// ─── Email handler (exported as `email`) ─────────────────────────────────────

export default {
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    try {
      const emailId = generateId()
      console.log(`[email] Processing ${emailId} from=${message.from} to=${message.to}`)

      const parsed = await PostalMime.parse(message.raw)

      const { htmlContent, textContent } = processEmailContent(
        parsed.html ?? null,
        parsed.text ?? null,
      )

      const validAtts = filterAttachments(parsed.attachments ?? [], emailId)

      const { success, error } = await insertEmail(env.D1, {
        id:               emailId,
        from_address:     message.from,
        to_address:       message.to,
        subject:          parsed.subject ?? null,
        received_at:      now(),
        html_content:     htmlContent,
        text_content:     textContent,
        has_attachments:  validAtts.length > 0,
        attachment_count: validAtts.length,
      })

      if (!success) throw new Error(`D1 insertEmail failed: ${error}`)

      if (validAtts.length > 0) {
        ctx.waitUntil(
          Promise.all(validAtts.map(att => storeOneAttachment(env, emailId, att))),
        )
      }

      console.log(`[email] Stored ${emailId} — ${validAtts.length} attachment(s)`)
    } catch (err) {
      console.error('[email] Failed to process incoming email:', err)
      throw err   // re-throw so Cloudflare retries delivery
    }
  },
}
