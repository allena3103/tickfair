/**
 * Cron task definitions — registered into the AppCronRoom DO at construction
 * time (worker.ts). The DO alarm fires `runTask(name, env)` on the schedule
 * declared here; the DO itself records executions, tracks history, and
 * pushes status to admin clients via the `/ws/cron/:roomId` WebSocket.
 *
 * Each task declares EITHER `intervalMinutes` (run every N minutes) OR
 * `schedule` + `timezone` (5-field cron expression). CronRoom validates
 * the config at construction time and throws on ambiguous declarations.
 *
 * Example:
 *
 *   import type { CronTask } from 'deepspace/worker'
 *   import { buildCronContext } from 'deepspace/worker'
 *
 *   export const tasks: CronTask[] = [
 *     { name: 'heartbeat', intervalMinutes: 1 },
 *     { name: 'daily-report', schedule: '0 9 * * *', timezone: 'America/New_York' },
 *   ]
 *
 *   export async function runTask(name: string, env: Env): Promise<void> {
 *     const ctx = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
 *     if (name === 'heartbeat') {
 *       // …
 *     }
 *   }
 */


import type { CronTask } from 'deepspace/worker'
import { buildCronContext } from 'deepspace/worker'
import type { Env } from '../worker.js'
import { createRng, drawNewsEvent } from './engine/market/index.js'
import { runNewsEvent } from './server/news/runtime.js'
import { newsTick, randomSalt } from './server/news/tick.js'

/**
 * `news`: every minute (the platform minimum), fire with probability 0.5 from
 * a per-minute salted RNG. Only a live round reaches the paid LLM call
 * (`runNewsEvent` checks `rounds` first). Only admins can trigger, pause, or
 * resume it (see the `/ws/cron` resolver in src/server/realtime-routes.ts).
 */
export const tasks: CronTask[] = [{ name: 'news', intervalMinutes: 1 }]

export async function runTask(name: string, env: Env): Promise<void> {
  if (name === 'news') {
    const ctx = buildCronContext(env, env.OWNER_USER_ID, `app:${env.DEEPSPACE_APP_ID}`)
    await newsTick(env, {
      createRng,
      drawNewsEvent,
      run: runNewsEvent,
      invoke: (endpoint, body) => ctx.integrations.call(endpoint, body),
      now: Date.now(),
      salt: randomSalt(),
      log: (line) => console.log(line),
    })
  }
}
