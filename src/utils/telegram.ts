import type { Env } from '../types'

/** Send a message to a Telegram chat (optional — no-op if not configured) */
export async function sendTelegram(text: string, env: Env): Promise<void> {
  if (!env.TELEGRAM_LOG_ENABLE || !env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return
  try {
    await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: Number(env.TELEGRAM_CHAT_ID),
        text,
        parse_mode: 'Markdown',
      }),
    })
  } catch (e) {
    console.error('[telegram] Failed to send message:', e)
  }
}
