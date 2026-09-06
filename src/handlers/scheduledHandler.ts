/**
 * Cloudflare Scheduled (cron) handler
 * Runs every 2 hours — deletes emails older than HOURS_TO_DELETE
 */

import * as db from '../database/d1'
import { now } from '../utils/helpers'
import { sendTelegram } from '../utils/telegram'
import type { Env } from '../types'

export async function handleScheduled(
  _event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  const hours = Number(env.HOURS_TO_DELETE ?? 3)
  const cutoff = now() - hours * 3600

  const { success, deleted, error } = await db.deleteOldEmails(env.D1, cutoff)

  if (success) {
    const msg = `✅ [dezignmail] Cleanup done — ${deleted} email(s) deleted (older than ${hours}h)`
    console.log(msg)
    ctx.waitUntil(sendTelegram(msg, env))
  } else {
    const msg = `❌ [dezignmail] Cleanup failed: ${error?.message ?? 'Unknown error'}`
    console.error(msg)
    ctx.waitUntil(sendTelegram(msg, env))
    throw new Error(msg)
  }
}
