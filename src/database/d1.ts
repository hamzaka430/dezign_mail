/**
 * Cloudflare D1 database helpers for Dezignmail
 * Tables: emails, attachments
 */

export interface EmailRow {
  id: string
  from_address: string
  to_address: string
  subject: string | null
  received_at: number          // Unix timestamp (seconds)
  html_content: string | null
  text_content: string | null
  has_attachments: boolean
  attachment_count: number
}

export interface EmailSummary {
  id: string
  from_address: string
  to_address: string
  subject: string | null
  received_at: number
  has_attachments: boolean
  attachment_count: number
}

export interface AttachmentRow {
  id: string
  email_id: string
  filename: string
  content_type: string
  size: number
  r2_key: string
  created_at: number
}

export interface AttachmentSummary {
  id: string
  email_id: string
  filename: string
  content_type: string
  size: number
  created_at: number
}

// ─── Email operations ──────────────────────────────────────────────────────

export async function insertEmail(db: D1Database, data: EmailRow) {
  try {
    const { success, error } = await db
      .prepare(
        `INSERT INTO emails
           (id, from_address, to_address, subject, received_at, html_content, text_content, has_attachments, attachment_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        data.id,
        data.from_address,
        data.to_address,
        data.subject,
        data.received_at,
        data.html_content,
        data.text_content,
        data.has_attachments ? 1 : 0,
        data.attachment_count,
      )
      .run()
    return { success, error }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

export async function getEmailsByRecipient(
  db: D1Database,
  toAddress: string,
  limit: number,
  offset: number,
) {
  try {
    const { results } = await db
      .prepare(
        `SELECT id, from_address, to_address, subject, received_at, has_attachments, attachment_count
         FROM emails
         WHERE to_address = ?
         ORDER BY received_at DESC
         LIMIT ? OFFSET ?`,
      )
      .bind(toAddress, limit, offset)
      .all()

    const emails = (results as any[]).map((r) => ({
      ...r,
      has_attachments: Boolean(r.has_attachments),
    })) as EmailSummary[]

    return { emails, error: undefined }
  } catch (e: unknown) {
    return { emails: [] as EmailSummary[], error: e instanceof Error ? e : new Error(String(e)) }
  }
}

export async function getEmailById(db: D1Database, id: string) {
  try {
    const row = await db.prepare('SELECT * FROM emails WHERE id = ?').bind(id).first()
    if (!row) return { email: null, error: undefined }
    return {
      email: { ...row, has_attachments: Boolean((row as any).has_attachments) } as EmailRow,
      error: undefined,
    }
  } catch (e: unknown) {
    return { email: null, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

export async function countEmailsByRecipient(db: D1Database, toAddress: string) {
  try {
    const row = await db
      .prepare('SELECT COUNT(*) as count FROM emails WHERE to_address = ?')
      .bind(toAddress)
      .first<{ count: number }>()
    return { count: row?.count ?? 0, error: undefined }
  } catch (e: unknown) {
    return { count: 0, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

export async function deleteEmailsByRecipient(db: D1Database, toAddress: string) {
  try {
    const { meta, error } = await db
      .prepare('DELETE FROM emails WHERE to_address = ?')
      .bind(toAddress)
      .run()
    return { changes: meta?.changes ?? 0, error }
  } catch (e: unknown) {
    return { changes: 0, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

export async function deleteEmailById(db: D1Database, id: string) {
  try {
    const { meta, error } = await db
      .prepare('DELETE FROM emails WHERE id = ?')
      .bind(id)
      .run()
    return { changes: meta?.changes ?? 0, error }
  } catch (e: unknown) {
    return { changes: 0, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

export async function deleteOldEmails(db: D1Database, cutoffTimestamp: number) {
  try {
    const { success, meta, error } = await db
      .prepare('DELETE FROM emails WHERE received_at < ?')
      .bind(cutoffTimestamp)
      .run()
    return { success, deleted: meta?.changes ?? 0, error }
  } catch (e: unknown) {
    return { success: false, deleted: 0, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

// ─── Attachment operations ─────────────────────────────────────────────────

export async function insertAttachment(db: D1Database, data: AttachmentRow) {
  try {
    const { success, error } = await db
      .prepare(
        `INSERT INTO attachments (id, email_id, filename, content_type, size, r2_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(data.id, data.email_id, data.filename, data.content_type, data.size, data.r2_key, data.created_at)
      .run()
    return { success, error }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

export async function getAttachmentsByEmailId(db: D1Database, emailId: string) {
  try {
    const { results } = await db
      .prepare(
        `SELECT id, email_id, filename, content_type, size, created_at
         FROM attachments WHERE email_id = ?
         ORDER BY created_at ASC`,
      )
      .bind(emailId)
      .all()
    return { attachments: results as unknown as AttachmentSummary[], error: undefined }
  } catch (e: unknown) {
    return { attachments: [] as AttachmentSummary[], error: e instanceof Error ? e : new Error(String(e)) }
  }
}

export async function getAttachmentById(db: D1Database, id: string) {
  try {
    const row = await db.prepare('SELECT * FROM attachments WHERE id = ?').bind(id).first()
    return { attachment: (row as AttachmentRow | null), error: undefined }
  } catch (e: unknown) {
    return { attachment: null, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

export async function deleteAttachmentById(db: D1Database, id: string) {
  try {
    const { success, meta, error } = await db
      .prepare('DELETE FROM attachments WHERE id = ?')
      .bind(id)
      .run()
    return { success, changes: meta?.changes ?? 0, error }
  } catch (e: unknown) {
    return { success: false, changes: 0, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

export async function updateEmailAttachmentInfo(
  db: D1Database,
  emailId: string,
  hasAttachments: boolean,
  count: number,
) {
  try {
    const { success, error } = await db
      .prepare('UPDATE emails SET has_attachments = ?, attachment_count = ? WHERE id = ?')
      .bind(hasAttachments ? 1 : 0, count, emailId)
      .run()
    return { success, error }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e : new Error(String(e)) }
  }
}
