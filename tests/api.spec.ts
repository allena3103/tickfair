import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import { test as dsTest, loadAllTestAccounts } from 'deepspace/testing'

test.describe('API tests', () => {
  test('auth proxy forwards to auth worker', async ({ request }) => {
    const res = await request.get('/api/auth/ok')
    expect(res.ok()).toBeTruthy()
  })

  test('WebSocket endpoint exists', async ({ page }) => {
    // /home is a dynamic page (under src/pages/(app)/), so mounting it boots
    // the providers and auto-connects the records WebSocket. The static
    // landing at '/' deliberately does neither — see smoke.spec.ts.
    await page.goto('/home')
    // Wait for the app to connect its WebSocket (it auto-connects on mount)
    await page.waitForSelector('[data-testid="app-navigation"]', { timeout: 15000 })
    // If the app loaded and connected, the WS endpoint works
  })
})

// ---------------------------------------------------------------------------
// News: owner-only `breakingNews` and the server-only Anthropic integration.
// No test here can reach a paid call: every request is refused before the
// LLM, and the proxy probe sends a body the integration's validator rejects.
// ---------------------------------------------------------------------------

/** Bearer for the page's signed-in session. Never logged. */
async function bearerFor(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const res = await fetch('/api/auth/token', { method: 'POST', credentials: 'include' })
    const json = (await res.json()) as { token?: string }
    return json.token ?? ''
  })
}

test.describe('News API', () => {
  test('breakingNews without auth is 401', async ({ request }) => {
    const res = await request.post('/api/actions/breakingNews', { data: {} })
    expect(res.status()).toBe(401)
  })

  test('anthropic proxy without auth is 401', async ({ request }) => {
    const res = await request.post('/api/integrations/anthropic/chat-completion', { data: {} })
    expect(res.status()).toBe(401)
  })
})

dsTest.describe('News API (signed in)', () => {
  dsTest.skip(loadAllTestAccounts().length < 1, 'Needs 1 usable test account')

  dsTest('breakingNews as a non-owner is forbidden', async ({ users }) => {
    const [a] = await users(1)
    await a.page.goto('/home')
    const token = await bearerFor(a.page)
    expect(token).not.toBe('')
    const res = await a.page.request.post('/api/actions/breakingNews', {
      headers: { Authorization: `Bearer ${token}` },
      data: { ticker: 'ORBT' },
    })
    expect(res.status()).toBe(200)
    expect(await res.json()).toEqual({ success: false, error: 'forbidden' })
  })

  dsTest('a signed-in client cannot call the anthropic integration', async ({ users }) => {
    const [a] = await users(1)
    await a.page.goto('/home')
    const token = await bearerFor(a.page)
    // `{}` has no `messages`, so even an unpatched proxy is refused by the
    // validator before any model runs. The app must refuse it first: 403.
    const res = await a.page.request.post('/api/integrations/anthropic/chat-completion', {
      headers: { Authorization: `Bearer ${token}` },
      data: {},
    })
    expect(res.status()).toBe(403)
  })
})
