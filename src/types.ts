export type Env = {
  // Cloudflare D1 - email storage
  D1: D1Database
  // Cloudflare R2 - attachment storage
  R2: R2Bucket
  // Cloudflare Pages static assets (auto-bound by Pages)
  ASSETS: Fetcher
  // Allowed email domains (comma-separated)
  ALLOWED_DOMAINS: string
  // Hours before emails are deleted by cron
  HOURS_TO_DELETE: number
  // Telegram logging (optional)
  TELEGRAM_LOG_ENABLE?: boolean
  TELEGRAM_BOT_TOKEN?: string
  TELEGRAM_CHAT_ID?: string
}
