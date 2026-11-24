/**
 * Integration Billing Config
 *
 * Configure who pays for each integration's API calls.
 *
 * - 'developer': The app owner pays (default).
 * - 'user': The calling user pays.
 *
 * The browser proxy (`/api/integrations/:name/:endpoint`) forwards only
 * 'user' integrations, for a signed-in caller billed to their own JWT.
 * 'developer' integrations, including any integration not listed here, run
 * only from server code (cron, server actions); browsers get 403.
 *
 * IMPORTANT: any integration backed by per-user connected accounts (Google,
 * Composio) must be 'user' — the api-worker resolves the account from the
 * JWT subject. With 'developer' the app owner's JWT is forwarded, so every
 * signed-in user connects and acts on the app owner's account. Server code
 * that acts for a user in the background (e.g. a cron job) uses
 * `callComposio(env, ..., { asUser })` from 'deepspace/worker' instead.
 */

export const integrations: Record<
  string,
  { billing: 'developer' | 'user' }
> = {
  google: { billing: 'user' },
  composio: { billing: 'user' },
  // News pipeline (cron + owner-only breakingNews): anthropic writes the item,
  // newsapi supplies real sector headlines as style inspiration, cloudflare
  // (Jev) checks the result. Owner-billed, so the browser proxy refuses them
  // (src/server/http-routes.ts); server code only.
  anthropic: { billing: 'developer' },
  newsapi: { billing: 'developer' },
  cloudflare: { billing: 'developer' },
}
