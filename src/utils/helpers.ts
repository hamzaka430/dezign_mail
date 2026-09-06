/** Return current Unix timestamp in seconds */
export function now(): number {
  return Math.floor(Date.now() / 1000)
}

/** Extract domain part from an email address */
export function getDomain(email: string): string {
  const parts = email.split('@')
  return (parts.length > 1 ? parts.pop() : email)?.trim() ?? email
}

/** Generate a simple random ID (32 hex chars) */
export function generateId(): string {
  const arr = new Uint8Array(16)
  crypto.getRandomValues(arr)
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Sanitize HTML — strips scripts, event handlers, iframes, objects */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/<iframe\b[^>]*>/gi, '')
    .replace(/<object\b[^>]*>/gi, '')
    .replace(/<embed\b[^>]*>/gi, '')
}

/** Convert plain text to a simple HTML wrapper */
export function textToHtml(text: string): string | null {
  if (!text.trim()) return null
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
  return `<pre style="font-family:sans-serif;white-space:pre-wrap">${escaped}</pre>`
}

/** Process raw html + text into safe, consistent pair */
export function processEmailContent(
  html: string | null,
  text: string | null,
): { htmlContent: string | null; textContent: string | null } {
  const safeHtml = html ? sanitizeHtml(html) : null

  if (safeHtml && text) return { htmlContent: safeHtml, textContent: text }
  if (safeHtml && !text) return { htmlContent: safeHtml, textContent: null }
  if (!safeHtml && text) return { htmlContent: textToHtml(text), textContent: text }
  return { htmlContent: null, textContent: null }
}
