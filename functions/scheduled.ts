/**
 * Cloudflare Scheduled (cron) trigger for Dezignmail
 * Registered via wrangler.toml triggers.crons
 *
 * Runs every 2 hours — deletes emails older than HOURS_TO_DELETE (default 3h)
 */

import { handleScheduled } from '../src/handlers/scheduledHandler'
import type { Env } from '../src/types'

export async function scheduled(
  event: ScheduledEvent,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  await handleScheduled(event, env, ctx)
}
