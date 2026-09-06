/**
 * Cloudflare R2 helpers for attachment storage
 */

import { ATTACHMENT_LIMITS } from '../config/constants'

/** Build an R2 object key for an attachment */
export function buildR2Key(emailId: string, attachmentId: string, filename: string): string {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_')
  return `attachments/${emailId}/${attachmentId}/${safe}`
}

export async function storeAttachment(
  bucket: R2Bucket,
  key: string,
  data: ArrayBuffer,
  contentType: string,
  filename: string,
): Promise<{ success: boolean; error?: Error }> {
  try {
    if (data.byteLength > ATTACHMENT_LIMITS.MAX_SIZE) {
      return { success: false, error: new Error(`Attachment too large (${data.byteLength} bytes)`) }
    }
    if (!ATTACHMENT_LIMITS.ALLOWED_TYPES.includes(contentType as any)) {
      return { success: false, error: new Error(`Content type not allowed: ${contentType}`) }
    }
    await bucket.put(key, data, {
      httpMetadata: {
        contentType,
        contentDisposition: `attachment; filename="${filename}"`,
      },
      customMetadata: { originalFilename: filename, uploadedAt: Date.now().toString() },
    })
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

export async function getAttachment(
  bucket: R2Bucket,
  key: string,
): Promise<{ success: boolean; object?: R2ObjectBody; error?: Error }> {
  try {
    const obj = await bucket.get(key)
    if (!obj) return { success: false, error: new Error('Attachment not found in R2') }
    return { success: true, object: obj }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

export async function deleteAttachment(
  bucket: R2Bucket,
  key: string,
): Promise<{ success: boolean; error?: Error }> {
  try {
    await bucket.delete(key)
    return { success: true }
  } catch (e: unknown) {
    return { success: false, error: e instanceof Error ? e : new Error(String(e)) }
  }
}

export async function deleteEmailAttachments(
  bucket: R2Bucket,
  emailId: string,
): Promise<{ success: boolean; deletedCount: number; error?: Error }> {
  try {
    const prefix = `attachments/${emailId}/`
    const listed = await bucket.list({ prefix })
    if (listed.objects.length === 0) return { success: true, deletedCount: 0 }
    await Promise.all(listed.objects.map((o) => bucket.delete(o.key)))
    return { success: true, deletedCount: listed.objects.length }
  } catch (e: unknown) {
    return { success: false, deletedCount: 0, error: e instanceof Error ? e : new Error(String(e)) }
  }
}
