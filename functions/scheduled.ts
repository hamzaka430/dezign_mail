import { getDb } from '../src/db'
import type { Env } from '../src/types'

export async function scheduled(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext
): Promise<void> {
  if (!env.DATABASE_URL) return

  const sql = getDb(env.DATABASE_URL)

  try {
    // Soft-delete expired inboxes
    await sql`
      UPDATE inboxes
      SET is_active = false
      WHERE expires_at < NOW() AND is_active = true
    `

    // Hard-delete messages older than 48 hours
    await sql`
      DELETE FROM messages
      WHERE received_at < NOW() - INTERVAL '48 hours'
    `

    console.log('[cron] Cleanup complete')
  } catch (err) {
    console.error('[cron] Cleanup failed:', err)
  }
}