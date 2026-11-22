/**
 * Two traders on the real exchange (no mocks): they trade through the UI,
 * see the same prints and leaderboard, keep their orders private, and see
 * each other's ticker on the floor.
 *
 * Round phase is wall-clock driven, so no test assumes it (LESSONS 25):
 * `waitForLiveRound` waits out a results break, skips a round that is about
 * to end, and every test rechecks the round id before it finishes.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'

const usableTestAccounts = loadAllTestAccounts().length
test.skip(
  usableTestAccounts < 2,
  `Needs 2 usable test accounts, found ${usableTestAccounts}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" ' +
    '--password-stdin`, or fetch existing pool accounts with `npx deepspace test accounts recover --all`.',
)

/** Default break is 2 min; allow for it plus a full trade. */
test.setTimeout(240_000)

const MIN_LEFT_MS = 45_000

const terminal = (page: Page) => page.getByTestId('trade-terminal')

/** Wait for a connected, live round with enough time left; return its id. */
async function waitForLiveRound(page: Page): Promise<string> {
  const t = terminal(page)
  await expect(t).toBeVisible({ timeout: 20_000 })
  await expect(t).toHaveAttribute('data-connected', 'true', { timeout: 20_000 })
  await expect
    .poll(
      async () => {
        const phase = await t.getAttribute('data-phase')
        const endsAt = Number(await t.getAttribute('data-phase-ends-at'))
        return phase === 'live' && endsAt - Date.now() > MIN_LEFT_MS
      },
      // A break, or a live round too close to its end plus the break after it.
      { timeout: 200_000, intervals: [1_000] },
    )
    .toBe(true)
  return (await t.getAttribute('data-round-id')) as string
}

async function expectSameRound(page: Page, roundId: string) {
  await expect(terminal(page)).toHaveAttribute('data-round-id', roundId)
  await expect(terminal(page)).toHaveAttribute('data-phase', 'live')
}

async function selfId(page: Page): Promise<string> {
  const self = page.getByTestId('online-traders').locator('[data-testid="online-trader"][data-self="true"]')
  await expect(self).toHaveCount(1, { timeout: 20_000 })
  return (await self.getAttribute('data-user-id')) as string
}

/** Current price in the ticket, in cents (the ticket prefills the last trade). */
async function ticketPriceCents(page: Page): Promise<number> {
  const input = page.getByTestId('ticket-price')
  await expect(input).toHaveValue(/^\d+\.\d{2}$/, { timeout: 20_000 })
  return Math.round(Number(await input.inputValue()) * 100)
}

const dollars = (cents: number) => (cents / 100).toFixed(2)

/** Submit a limit order through the ticket and return its order id. */
async function placeLimit(page: Page, side: 'buy' | 'sell', qty: number, limitCents: number): Promise<string> {
  await page.getByTestId(`ticket-${side}`).click()
  await page.getByTestId('ticket-limit').click()
  await page.getByTestId('ticket-qty').fill(String(qty))
  await page.getByTestId('ticket-price').fill(dollars(limitCents))
  const submit = page.getByTestId('ticket-submit')
  await expect(submit).toBeEnabled({ timeout: 20_000 })
  await submit.click()
  const ok = page.getByTestId('ticket-ok')
  const err = page.getByTestId('ticket-error')
  await expect(ok.or(err)).toBeVisible({ timeout: 15_000 })
  if (await err.isVisible()) throw new Error(`order rejected: ${await err.textContent()}`)
  const id = await ok.getAttribute('data-order-id')
  expect(id).toMatch(/^o-/)
  return id as string
}

async function fillFor(page: Page, orderId: string) {
  const row = page.getByTestId('my-fills').locator(`[data-testid="fill-row"][data-order-id="${orderId}"]`).first()
  await expect(row).toBeVisible({ timeout: 20_000 })
  const price = (await row.locator('td').nth(4).textContent())?.trim() ?? ''
  return { row, price }
}

test('A buys, B sells into it: both see the print, the board, and only their own orders', async ({ users }) => {
  const [a, b] = await users(2)
  await Promise.all([a.page.goto('/trade'), b.page.goto('/trade')])
  const roundId = await waitForLiveRound(a.page)
  await waitForLiveRound(b.page)
  const [idA, idB] = await Promise.all([selfId(a.page), selfId(b.page)])
  expect(idA).not.toBe(idB)

  // Both stay on ORBT (the default tab).
  const px = await ticketPriceCents(b.page)

  // Long-only: B buys a few shares first so B has something to sell.
  const bBuy = await placeLimit(b.page, 'buy', 5, Math.round(px * 1.04))
  await fillFor(b.page, bBuy)
  await expect(b.page.getByTestId('positions').locator('[data-testid="position-row"][data-ticker="ORBT"]')).toBeVisible({
    timeout: 20_000,
  })

  // The crossing pair: A bids above the market, B offers below it.
  const pxNow = await ticketPriceCents(a.page)
  const [aBuy, bSell] = await Promise.all([
    placeLimit(a.page, 'buy', 3, Math.round(pxNow * 1.04)),
    placeLimit(b.page, 'sell', 3, Math.round(pxNow * 0.96)),
  ])
  const aFill = await fillFor(a.page, aBuy)
  await fillFor(b.page, bSell)
  expect(aFill.price).toMatch(/^\d[\d,]*\.\d{2}$/)

  // Both see that print on the tape.
  for (const page of [a.page, b.page]) {
    await expect(
      page.getByTestId('tape').locator('[data-testid="tape-row"]').filter({ hasText: 'ORBT' }).filter({ hasText: aFill.price }).first(),
    ).toBeVisible({ timeout: 20_000 })
  }

  // Both leaderboards list both traders, and agree on A's equity.
  for (const page of [a.page, b.page]) {
    for (const id of [idA, idB]) {
      await expect(page.getByTestId('leaderboard').locator(`[data-testid="leaderboard-row"][data-user-id="${id}"]`)).toBeVisible({
        timeout: 20_000,
      })
    }
  }
  const equityOf = (page: Page) =>
    page.getByTestId('leaderboard').locator(`[data-testid="leaderboard-row"][data-user-id="${idA}"] td`).nth(2).textContent()
  await expect(async () => {
    const [onA, onB] = await Promise.all([equityOf(a.page), equityOf(b.page)])
    expect(onA).toMatch(/^\$[\d,]+$/)
    expect(onA).toBe(onB)
  }).toPass({ timeout: 20_000 })
  await expect(a.page.getByTestId('positions').locator('[data-testid="position-row"][data-ticker="ORBT"]')).toBeVisible()

  // Privacy: A's resting order shows for A, and nowhere in B's DOM.
  const resting = await placeLimit(a.page, 'buy', 2, Math.round(pxNow * 0.92))
  try {
    const row = a.page.locator(`[data-testid="open-order"][data-order-id="${resting}"]`)
    await expect(row).toBeVisible({ timeout: 20_000 })
    await b.page.waitForTimeout(2_000) // a couple of batches for any leak to show up
    expect(await b.page.content()).not.toContain(resting)
    await expect(b.page.locator(`[data-order-id="${resting}"]`)).toHaveCount(0)

    // Cancel it through the UI; the row leaves A's open orders.
    await row.getByTestId('cancel-order').click()
    await expect(row).toHaveCount(0, { timeout: 20_000 })
  } finally {
    // If the cancel above failed, don't leave a resting order behind.
    const leftover = a.page.locator(`[data-testid="open-order"][data-order-id="${resting}"] [data-testid="cancel-order"]`)
    if ((await leftover.count()) > 0 && (await leftover.isEnabled())) await leftover.click()
  }

  await expectSameRound(a.page, roundId)
  await expectSameRound(b.page, roundId)
})

test('presence: B sees A move to CURA', async ({ users }) => {
  const [a, b] = await users(2)
  await Promise.all([a.page.goto('/trade'), b.page.goto('/trade')])
  await Promise.all([expect(terminal(a.page)).toBeVisible({ timeout: 20_000 }), expect(terminal(b.page)).toBeVisible({ timeout: 20_000 })])
  const idA = await selfId(a.page)

  const aOnB = b.page.getByTestId('online-traders').locator(`[data-testid="online-trader"][data-user-id="${idA}"]`)
  await expect(aOnB).toContainText('ORBT', { timeout: 20_000 })

  await a.page.getByTestId('ticker-tab-CURA').click()
  await expect(a.page.getByTestId('ticker-tab-CURA')).toHaveAttribute('aria-selected', 'true')
  await expect(aOnB).toContainText('CURA', { timeout: 20_000 })
  await expect(aOnB).toHaveAttribute('data-on-floor', 'true')
})

test('each browser renders its own signed-in account', async ({ users }) => {
  const [a, b] = await users(2)
  await Promise.all([a.page.goto('/home'), b.page.goto('/home')])
  for (const user of [a, b]) {
    await expect(user.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })
    await expect(user.page.getByTestId('nav-user-name')).toHaveText(/\S/, { timeout: 15_000 })
    await user.page.getByRole('button', { name: 'Account menu' }).click()
    await expect(user.page.getByTestId('nav-user-email')).toHaveText(user.email, { timeout: 15_000 })
  }
})

/**
 * Opt-in: saves /trade screenshots at 1280 and 390 px during a live round.
 * Run with TRADE_SCREENSHOTS_DIR=<folder> set; skipped otherwise.
 */
test('screenshots of /trade during a live round', async ({ users }) => {
  const dir = process.env.TRADE_SCREENSHOTS_DIR
  test.skip(!dir, 'Set TRADE_SCREENSHOTS_DIR to save screenshots.')
  const [a] = await users(1)
  await a.page.setViewportSize({ width: 1280, height: 900 })
  await a.page.goto('/trade')
  const roundId = await waitForLiveRound(a.page)
  // A few batches so the chart and tape have history.
  await expect(a.page.getByTestId('tape').locator('[data-testid="tape-row"]').nth(5)).toBeVisible({ timeout: 30_000 })
  await a.page.screenshot({ path: `${dir}/trade-1280.png` })
  await a.page.screenshot({ path: `${dir}/trade-1280-full.png`, fullPage: true })
  await a.page.setViewportSize({ width: 390, height: 844 })
  await a.page.waitForTimeout(1_500)
  await a.page.screenshot({ path: `${dir}/trade-390.png` })
  await expectSameRound(a.page, roundId)
})
