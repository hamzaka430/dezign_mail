/**
 * Cloudflare Email Routing handler
 * This replaces the old Postfix VPS pipeline entirely.
 *
 * Cloudflare Email Routing receives SMTP mail for your domain
 * and calls this function with the raw message as a ReadableStream.
 *
 * Dependencies: postal-mime (npm install postal-mime)
 */

import PostalMime from 'postal-mime'
import { ATTACHMENT_LIMITS } from '../config/constants'
import * as db from '../database/d1'
import * as r2 from '../database/r2'
import { generateId, now, processEmailContent } from '../utils/helpers'
import type { Env } from '../types'

interface RawAttachment {
  filename: string | null
  mimeType?: string
  content?: string | ArrayBuffer | Uint8Array
}

function validateAttachments(attachments: RawAttachment[], emailId: string): RawAttachment[] {
  const valid: RawAttachment[] = []
  let totalSize = 0

  for (const att of attachments) {
    if (!att.filename) {
      console.warn(`[email] ${emailId}: skipping attachment without filename`)
      continue
    }
    if (valid.length >= ATTACHMENT_LIMITS.MAX_COUNT_PER_EMAIL) {
      console.warn(`[email] ${emailId}: too many attachments, stopping at ${valid.length}`)
      break
    }

    const size =
      att.content instanceof ArrayBuffer
        ? att.content.byteLength
        : att.content instanceof Uint8Array
        ? att.content.byteLength
        : new TextEncoder().encode(att.content ?? '').byteLength

    const ct = att.mimeType ?? 'application/octet-stream'
    if (!ATTACHMENT_LIMITS.ALLOWED_TYPES.includes(ct as any)) {
      console.warn(`[email] ${emailId}: skipping ${att.filename} — type ${ct} not allowed`)
      continue
    }
    if (size > ATTACHMENT_LIMITS.MAX_SIZE) {
      console.warn(`[email] ${emailId}: skipping ${att.filename} — too large (${size} bytes)`)
      continue
    }

    totalSize += size
    if (totalSize > ATTACHMENT_LIMITS.MAX_SIZE * ATTACHMENT_LIMITS.MAX_COUNT_PER_EMAIL) {
      console.warn(`[email] ${emailId}: total attachment size exceeded, stopping`)
      break
    }

    valid.push(att)
  }
  return valid
}

async function storeSingleAttachment(
  env: Env,
  emailId: string,
  att: RawAttachment,
): Promise<void> {
  if (!att.filename) return

  const attId = generateId()
  let content: ArrayBuffer
  let size: number

  if (att.content instanceof ArrayBuffer) {
    content = att.content
    size = content.byteLength
  } else if (att.content instanceof Uint8Array) {
    content = att.content.buffer as ArrayBuffer
    size = att.content.byteLength
  } else {
    const encoded = new TextEncoder().encode(att.content ?? '')
    content = encoded.buffer as ArrayBuffer
    size = encoded.byteLength
  }

  const key = r2.buildR2Key(emailId, attId, att.filename)
  const ct = att.mimeType ?? 'application/octet-stream'

  const { success: r2Ok, error: r2Err } = await r2.storeAttachment(env.R2, key, content, ct, att.filename)
  if (!r2Ok) {
    console.error(`[email] R2 store failed for ${att.filename}:`, r2Err)
    return
  }

  const { success: dbOk, error: dbErr } = await db.insertAttachment(env.D1, {
    id: attId,
    email_id: emailId,
    filename: att.filename,
    content_type: ct,
    size,
    r2_key: key,
    created_at: now(),
  })

  if (!dbOk) {
    console.error(`[email] D1 insert failed for attachment ${att.filename}:`, dbErr)
    await r2.deleteAttachment(env.R2, key)
  }
}

/**
 * Main Cloudflare Email Routing handler
 * Registered as `email` export in src/index.ts
 */
export async function handleEmail(
  message: ForwardableEmailMessage,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  try {
    const emailId = generateId()
    const parsed = await PostalMime.parse(message.raw)

    const { htmlContent, textContent } = processEmailContent(
      parsed.html ?? null,
      parsed.text ?? null,
    )

    const attachments = parsed.attachments ?? []
    const validAtts = validateAttachments(attachments, emailId)

    const { success, error } = await db.insertEmail(env.D1, {
      id: emailId,
      from_address: message.from,
      to_address: message.to,
      subject: parsed.subject ?? null,
      received_at: now(),
      html_content: htmlContent,
      text_content: textContent,
      has_attachments: validAtts.length > 0,
      attachment_count: validAtts.length,
    })

    if (!success) throw new Error(`D1 insertEmail failed: ${error}`)

    if (validAtts.length > 0) {
      ctx.waitUntil(
        Promise.all(validAtts.map((att) => storeSingleAttachment(env, emailId, att))),
      )
    }
  } catch (err) {
    console.error('[email] Failed to process incoming email:', err)
    throw err
  }
}
