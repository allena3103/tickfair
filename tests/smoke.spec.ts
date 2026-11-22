import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'
import { captureConsoleErrors } from './helpers/errors'

/**
 * Smoke tests for the ui-shell surfaces:
 *   - '/'        static landing: no providers, no auth fetch, no records socket.
 *   - '/home'    the floor overview inside the (app) providers.
 *   - '/rounds'  past rounds (empty until the exchange runtime writes some).
 *   - '/trade'   the terminal: gated signed out; signed in it renders real engine data.
 *   - presence   two signed-in users see each other in OnlineTraders.
 *
 * The "static contract" test guards the per-page opt-out: if someone moves
 * the providers back up into _app.tsx, it fails.
 */

async function waitForApp(page: Page) {
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15_000 })
}

test.describe('landing (static)', () => {
  test('renders real content without JS errors', async ({ page }) => {
    const errors = captureConsoleErrors(page)
    await page.goto('/')
    await waitForApp(page)
    await expect(page.getByTestId('static-landing')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/One second\.\s*One price\.\s*Everyone\./)
    await expect(page.getByRole('heading', { name: 'How a batch auction works' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'The rules' })).toBeVisible()
    await expect(page.getByText('$100,000 fake dollars per round')).toBeVisible()
    await expect(page.getByTestId('landing-cta').first()).toHaveAttribute('href', '/trade')
    // Scaffold placeholder copy is gone.
    await expect(page.getByText('A DeepSpace app with a static front door')).toHaveCount(0)
    // No providers on this page, so no auth overlay and no app chrome.
    await expect(page.getByTestId('auth-overlay')).toHaveCount(0)
    await expect(page.getByTestId('app-navigation')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('carries one title, one description, one canonical', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByTestId('static-landing')).toBeVisible()
    await expect(page).toHaveTitle(/\S/)
    expect(await page.locator('head meta[name="description"]').count()).toBe(1)
    expect(await page.locator('head link[rel="canonical"]').count()).toBe(1)
  })

  test('static contract: fires no auth request, opens no websocket', async ({ page }) => {
    const offenders: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/api/auth/')) offenders.push(req.url())
    })
    // Only DO room routes count; vite's HMR socket is a dev artifact.
    page.on('websocket', (ws) => {
      if (new URL(ws.url()).pathname.startsWith('/ws/')) offenders.push(`ws: ${ws.url()}`)
    })
    await page.goto('/')
    await expect(page.getByTestId('static-landing')).toBeVisible()
    await page.waitForTimeout(1500)
    expect(offenders).toEqual([])
  })
})

test.describe('landing hash links', () => {
  for (const [w, h] of [
    [390, 844],
    [1280, 600],
  ] as const) {
    test(`direct load of /#how-it-works scrolls to the section at ${w}x${h}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h })
      await page.goto('/#how-it-works')
      const section = page.locator('#how-it-works')
      await expect(section.getByRole('heading', { name: 'How a batch auction works' })).toBeInViewport({
        timeout: 10_000,
      })
      expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0)
    })
  }

  test('the in-page "How it works" link scrolls to the section', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    const heading = page.locator('#how-it-works').getByRole('heading', { name: 'How a batch auction works' })
    await expect(page.getByTestId('static-landing')).toBeVisible()
    await expect(heading).not.toBeInViewport()
    await page.getByTestId('landing-how-link').click()
    await expect(page).toHaveURL(/\/#how-it-works$/)
    await expect(heading).toBeInViewport({ timeout: 10_000 })
  })
})

test.describe('app shell (signed out)', () => {
  test('app root, header, and nav are present on /home', async ({ page }) => {
    const errors = captureConsoleErrors(page)
    await page.goto('/home')
    await waitForApp(page)
    const nav = page.getByTestId('app-navigation')
    await expect(nav).toBeVisible({ timeout: 15_000 })
    await expect(nav.getByRole('link', { name: 'Trade' })).toHaveAttribute('href', '/trade')
    await expect(nav.getByRole('link', { name: 'Rounds' })).toHaveAttribute('href', '/rounds')
    await expect(page.getByTestId('round-status')).toBeVisible()
    await expect(page.getByTestId('online-count')).toBeVisible()
    await expect(page.getByTestId('nav-sign-in-button')).toBeVisible()
    await expect(page.getByTestId('nav-user-name')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'The floor' })).toBeVisible()
    await expect(page.getByText('placeholder page')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('/home feeds settle into their empty states', async ({ page }) => {
    await page.goto('/home')
    for (const id of ['leaderboard', 'news-feed', 'tape', 'online-traders']) {
      const panel = page.getByTestId(id)
      await expect(panel).toBeVisible({ timeout: 15_000 })
      // Loading resolves to empty (or real rows, once the exchange is live).
      await expect(panel.locator('[data-state="loading"]')).toHaveCount(0, { timeout: 15_000 })
      await expect(panel.locator('[data-state="error"]')).toHaveCount(0)
    }
    await expect(page.getByTestId('online-traders')).toContainText('Sign in to show up on the floor.')
  })

  test('/rounds renders its empty state', async ({ page }) => {
    const errors = captureConsoleErrors(page)
    await page.goto('/rounds')
    await expect(page.getByRole('heading', { level: 1, name: 'Past rounds' })).toBeVisible({ timeout: 15_000 })
    const list = page.getByTestId('rounds-list')
    await expect(list.locator('[data-state="loading"]')).toHaveCount(0, { timeout: 15_000 })
    const rows = await list.getByTestId('round-row').count()
    if (rows === 0) await expect(list.getByText('No finished rounds yet')).toBeVisible()
    await expect(page.getByTestId('app-navigation').getByRole('link', { name: 'Rounds' })).toHaveAttribute(
      'aria-current',
      'page',
    )
    expect(errors).toEqual([])
  })

  test('the sign-in button opens the auth overlay', async ({ page }) => {
    await page.goto('/home')
    await page.getByTestId('nav-sign-in-button').click()
    await expect(page.getByTestId('auth-overlay')).toBeVisible({ timeout: 10_000 })
  })

  test('/trade is gated when signed out', async ({ page }) => {
    await page.goto('/trade')
    await waitForApp(page)
    await expect(page.getByText('Sign in to continue').or(page.getByTestId('auth-overlay')).first()).toBeVisible({
      timeout: 15_000,
    })
    // No terminal content, and no exchange socket, behind the gate.
    await expect(page.getByTestId('trade-terminal')).toHaveCount(0)
    await expect(page.getByTestId('order-ticket')).toHaveCount(0)
    await expect(page.getByTestId('depth-ladder')).toHaveCount(0)
  })

  test('unknown route shows 404', async ({ page }) => {
    await page.goto('/nonexistent-page-xyz')
    await waitForApp(page)
    await expect(page.locator('text=404')).toBeVisible()
  })
})

test.describe('presence', () => {
  const usable = loadAllTestAccounts().length
  test.skip(usable < 2, `Needs 2 usable test accounts, found ${usable}.`)

  test('two signed-in traders see each other in OnlineTraders', async ({ users }) => {
    const [a, b] = await users(2)
    await Promise.all([a.page.goto('/home'), b.page.goto('/home')])

    const selfId = async (page: Page) => {
      const self = page.getByTestId('online-traders').locator('[data-testid="online-trader"][data-self="true"]')
      await expect(self).toHaveCount(1, { timeout: 20_000 })
      return (await self.getAttribute('data-user-id')) as string
    }
    const [idA, idB] = await Promise.all([selfId(a.page), selfId(b.page)])
    expect(idA).not.toBe(idB)

    // Each sees the other live on the floor (PresenceRoom), not just a heartbeat.
    for (const [viewer, otherId] of [
      [a.page, idB],
      [b.page, idA],
    ] as const) {
      await expect(
        viewer.locator(`[data-testid="online-trader"][data-user-id="${otherId}"][data-on-floor="true"]`),
      ).toHaveCount(1, { timeout: 20_000 })
      // Exactly the two floor connections (this run's server has no one else).
      await expect(viewer.getByTestId('online-count')).toHaveText(/^\D*2\D*$/, { timeout: 20_000 })
    }

    // When B leaves, A's floor list drops B's live marker and the count falls
    // right away. B's heartbeat is still fresh, so B may stay listed, but only
    // under "recently active" and not counted.
    await b.page.goto('/')
    await expect(
      a.page.locator(`[data-testid="online-trader"][data-user-id="${idB}"][data-on-floor="true"]`),
    ).toHaveCount(0, { timeout: 20_000 })
    await expect(a.page.getByTestId('online-count')).toHaveText(/^\D*1\D*$/, { timeout: 20_000 })

    // On the terminal, your own row shows the ticker you're watching, not "on floor".
    await a.page.goto('/trade')
    const mine = a.page
      .getByTestId('online-traders')
      .locator('[data-testid="online-trader"][data-self="true"] [data-testid="online-trader-status"]')
    await expect(mine).toHaveText('ORBT', { timeout: 20_000 })
  })
})

test.describe('trade terminal (signed in)', () => {
  const usable = loadAllTestAccounts().length
  test.skip(usable < 1, `Needs 1 usable test account, found ${usable}.`)

  test('ticket, ladder, chart, and leaderboard render with real engine data', async ({ users }) => {
    const [a] = await users(1)
    const page = a.page
    const errors = captureConsoleErrors(page)
    await page.goto('/trade')
    const terminal = page.getByTestId('trade-terminal')
    await expect(terminal).toBeVisible({ timeout: 20_000 })
    // The engine's snapshot arrived over the socket (either phase is fine).
    await expect(terminal).toHaveAttribute('data-connected', 'true', { timeout: 20_000 })
    await expect(terminal).toHaveAttribute('data-round-id', /^r-/)
    await expect(terminal).toHaveAttribute('data-phase', /^(live|break)$/)

    // Live prices from the engine in the tabs and the chart header.
    for (const t of ['ORBT', 'CURA', 'VOLT']) {
      await expect(page.getByTestId(`ticker-tab-${t}`)).toContainText(/\d+\.\d{2}/)
    }
    await expect(page.getByTestId('chart-last')).toHaveText(/^\d[\d,]*\.\d{2}$/)

    await expect(page.getByTestId('order-ticket')).toBeVisible()
    await expect(page.getByTestId('fairness-hint')).toContainText('same 1-second batch')
    const ladder = page.getByTestId('depth-ladder')
    await expect(ladder).toBeVisible()
    await expect(ladder.locator('[data-state="loading"]')).toHaveCount(0, { timeout: 15_000 })
    if ((await terminal.getAttribute('data-phase')) === 'live') {
      // Bots quote every batch, so a live book has levels.
      await expect(ladder.locator('[data-testid="ladder-bid"], [data-testid="ladder-ask"]').first()).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.getByTestId('ticket-submit')).toBeEnabled({ timeout: 15_000 })
    } else {
      await expect(page.getByTestId('ticket-submit')).toBeDisabled()
    }

    const board = page.getByTestId('leaderboard')
    await expect(board).toBeVisible()
    await expect(board.locator('[data-state="loading"]')).toHaveCount(0, { timeout: 15_000 })
    await expect(board.locator('[data-state="error"]')).toHaveCount(0)
    for (const id of ['positions', 'open-orders', 'my-fills', 'tape', 'news-feed', 'online-traders']) {
      await expect(page.getByTestId(id)).toBeVisible()
    }
    expect(errors).toEqual([])
  })

  test('an old ticket error clears as soon as you edit the ticket (BUG-3)', async ({ users }) => {
    test.setTimeout(240_000)
    const [a] = await users(1)
    const page = a.page
    await page.goto('/trade')
    const terminal = page.getByTestId('trade-terminal')
    await expect(terminal).toHaveAttribute('data-connected', 'true', { timeout: 20_000 })
    // Sending needs a live round; wait out a results break rather than assume the phase (LESSONS 25).
    await expect(terminal).toHaveAttribute('data-phase', 'live', { timeout: 200_000 })

    // 200,000 shares passes the ticket's own checks; the server rejects it as invalid_qty.
    const qty = page.getByTestId('ticket-qty')
    await qty.fill('200000')
    await page.getByTestId('ticket-submit').click()
    const error = page.getByTestId('ticket-error')
    await expect(error).toHaveText('Enter a whole number of shares, up to 100,000.', { timeout: 15_000 })

    // Each kind of edit clears it: quantity, price, side, and order type.
    const edits = [
      () => qty.fill('5'),
      () => page.getByTestId('ticket-price').fill('1.00'),
      () => page.getByTestId('ticket-sell').click(),
      () => page.getByTestId('ticket-market').click(),
    ]
    for (const edit of edits) {
      await page.getByTestId('ticket-buy').click()
      await page.getByTestId('ticket-limit').click()
      await qty.fill('200000')
      await page.getByTestId('ticket-price').fill((await page.getByTestId('chart-last').textContent())!.replace(/,/g, ''))
      await page.getByTestId('ticket-submit').click()
      await expect(error).toBeVisible({ timeout: 15_000 })
      await edit()
      await expect(error).toHaveCount(0)
    }
  })

  test('terminal queries are not re-subscribed on every print (PERF)', async ({ users }, testInfo) => {
    test.setTimeout(360_000)
    const [a] = await users(1)
    const page = a.page
    type Sub = { subscriptionId: string; query: { collection: string; where?: Record<string, unknown>; orderBy?: string; orderDir?: string; limit?: number } }
    const subs: { at: number; sub: Sub }[] = []
    const tapeChanges: number[] = []
    page.on('websocket', (ws) => {
      ws.on('framereceived', (f) => {
        if (typeof f.payload !== 'string' || !f.payload.includes('core.record_change')) return
        try {
          const msg = JSON.parse(f.payload) as { type: string; payload?: { collection?: string } }
          if (msg.type === 'core.record_change' && msg.payload?.collection === 'tape') tapeChanges.push(Date.now())
        } catch {
          // not JSON
        }
      })
      ws.on('framesent', (f) => {
        if (typeof f.payload !== 'string' || !f.payload.includes('core.subscribe')) return
        try {
          const msg = JSON.parse(f.payload) as { type: string; payload: Sub }
          if (msg.type === 'core.subscribe') subs.push({ at: Date.now(), sub: msg.payload })
        } catch {
          // not JSON
        }
      })
    })
    await page.goto('/trade')
    const terminal = page.getByTestId('trade-terminal')
    await expect(terminal).toHaveAttribute('data-connected', 'true', { timeout: 20_000 })
    // Prints only flow in a live round. The 3 s settle plus the 30 s window must
    // not straddle a round end, so wait for a live phase with at least 50 s left
    // (waiting out a break or a round that is about to end; LESSONS 25).
    await expect
      .poll(
        async () =>
          (await terminal.getAttribute('data-phase')) === 'live' &&
          Number(await terminal.getAttribute('data-phase-ends-at')) - Date.now() > 50_000,
        { timeout: 240_000, intervals: [1_000] },
      )
      .toBe(true)
    const roundId = await terminal.getAttribute('data-round-id')
    await expect(page.getByTestId('chart-last')).toHaveText(/\d/, { timeout: 15_000 })
    await page.waitForTimeout(3_000) // initial subscriptions settle

    // Counted per query fingerprint, not per subscriptionId, so a re-subscribe
    // under a fresh id still counts as a repeat of the same query.
    const fingerprint = (q: Sub['query']) =>
      JSON.stringify([q.collection, q.where ?? null, q.orderBy ?? null, q.orderDir ?? null, q.limit ?? null])
    // ui-trading's queries: the chart's tape (has a ticker), orders, fills, portfolios.
    const groups = {
      chartTape: (q: Sub['query']) => q.collection === 'tape' && q.where?.ticker !== undefined,
      orders: (q: Sub['query']) => q.collection === 'orders',
      fills: (q: Sub['query']) => q.collection === 'fills',
      portfolios: (q: Sub['query']) => q.collection === 'portfolios',
    }
    // Not vacuous: every group was subscribed (and so captured) before the window.
    for (const [name, pick] of Object.entries(groups)) {
      expect(subs.filter((x) => pick(x.sub.query)).length, `${name} subscribed before the window`).toBeGreaterThanOrEqual(1)
    }

    const start = Date.now()
    const batchBefore = Number((await page.getByTestId('batch-id').textContent())?.replace('#', ''))
    await page.waitForTimeout(30_000)
    const batchAfter = Number((await page.getByTestId('batch-id').textContent())?.replace('#', ''))
    // The window really covered live batches, in one round, with tape changes arriving.
    expect(batchAfter - batchBefore).toBeGreaterThanOrEqual(20)
    await expect(terminal).toHaveAttribute('data-round-id', roundId as string)
    expect(tapeChanges.filter((t) => t >= start).length, 'tape record changes in the window').toBeGreaterThanOrEqual(1)

    const inWindow = subs.filter((s) => s.at >= start)
    const countBy = (pick: (q: Sub['query']) => boolean) => {
      const per = new Map<string, number>()
      for (const { sub } of inWindow) if (pick(sub.query)) per.set(fingerprint(sub.query), (per.get(fingerprint(sub.query)) ?? 0) + 1)
      return Math.max(0, ...per.values())
    }
    const mine = Object.fromEntries(Object.entries(groups).map(([name, pick]) => [name, countBy(pick)]))
    // ui-shell's Tape panel (no ticker in where); reported, not asserted.
    const feedTape = countBy((q) => q.collection === 'tape' && q.where?.ticker === undefined)
    testInfo.annotations.push({ type: 'core.subscribe in 30s', description: JSON.stringify({ ...mine, feedTape }) })
    console.log(`[perf] core.subscribe re-sends per query in 30s: ${JSON.stringify({ ...mine, feedTape })}`)
    // At most one re-send each (a socket reconnect re-sends every subscription once).
    for (const [name, n] of Object.entries(mine)) expect(n, name).toBeLessThanOrEqual(1)
  })

  test('the fairness note links to the batch auction explanation', async ({ users }) => {
    const [a] = await users(1)
    const page = a.page
    await page.goto('/trade')
    const link = page.getByTestId('fairness-hint').getByRole('link', { name: 'How it works' })
    await expect(link).toBeVisible({ timeout: 20_000 })
    await link.click()
    await expect(page).toHaveURL(/\/#how-it-works$/)
    const section = page.locator('#how-it-works')
    await expect(section.getByRole('heading', { name: 'How a batch auction works' })).toBeVisible({ timeout: 15_000 })
    await expect(section).toBeInViewport()
  })
})
