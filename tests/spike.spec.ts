/**
 * TEMPORARY spike spec (S1–S3). Reverted with the harness after SPIKE.md.
 * Writes measurements (no credentials, no tokens) to SPIKE_OUT.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { test, expect } from 'deepspace/testing'

const OUT =
  process.env.SPIKE_OUT ??
  'C:/Users/allen/AppData/Local/Temp/claude/f5d61f26635ef36c/5250b701-e769-4f76-a63b-d721d77b13a0/scratchpad/spike-out.json'
const APP_ID = /DEEPSPACE_APP_ID = "([^"]+)"/.exec(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'))![1]

test('exchange spike S1-S3', async ({ users, request }) => {
  test.setTimeout(480_000)
  const out: Record<string, unknown> = {}
  expect((await request.post('/api/spike/exchange/reset')).ok()).toBeTruthy()

  const [a] = await users(1)
  await a.page.goto('/home')
  await expect(a.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })

  // S1 + S2 run in the browser. Only booleans and timings leave the page.
  out.browser = await a.page.evaluate(async (appId) => {
    const base = `${location.origin.replace('http', 'ws')}/ws/exchange/exchange:${appId}`
    const res = await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })
    const { token } = (await res.json()) as { token: string }
    const sub = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).sub as string

    const open = (url: string) =>
      new Promise<{ ws: WebSocket; hello: { userId: string; anonymous: boolean } }>((resolve, reject) => {
        const ws = new WebSocket(url)
        const t = setTimeout(() => reject(new Error('no hello')), 10_000)
        ws.onmessage = (e) => {
          const m = JSON.parse(e.data)
          if (m.type === 'spike.hello') {
            clearTimeout(t)
            resolve({ ws, hello: m })
          }
        }
        ws.onerror = () => reject(new Error('ws error'))
      })

    const signed = await open(`${base}?token=${encodeURIComponent(token)}&userId=forged-user`)
    const anon = await open(`${base}?userId=forged-user`)
    const wrongRoom = await new Promise<string>((resolve) => {
      const ws = new WebSocket(`${location.origin.replace('http', 'ws')}/ws/exchange/exchange:someone-else`)
      ws.onopen = () => resolve('opened')
      ws.onerror = () => resolve('rejected')
    })

    const ticks: { seq: number; scheduled: number; fired: number; recv: number }[] = []
    await new Promise<void>((resolve) => {
      signed.ws.onmessage = (e) => {
        const m = JSON.parse(e.data)
        if (m.type !== 'spike.tick') return
        ticks.push({ seq: m.seq, scheduled: m.scheduled, fired: m.fired, recv: Date.now() })
        if (ticks.length >= 61) resolve()
      }
    })
    signed.ws.close()
    anon.ws.close()
    return {
      signed: { anonymous: signed.hello.anonymous, userIdMatchesJwtSub: signed.hello.userId === sub, forgedIgnored: signed.hello.userId !== 'forged-user' },
      anon: { anonymous: anon.hello.anonymous, forgedIgnored: anon.hello.userId !== 'forged-user', idPrefix: anon.hello.userId.slice(0, 5) },
      wrongRoom,
      ticks,
      closedAt: Date.now(),
    }
  }, APP_ID)
  writeFileSync(OUT, JSON.stringify(out, null, 2))

  // S2 idle stop: no sockets for 60s → alarm not re-armed.
  await new Promise((r) => setTimeout(r, 75_000))
  out.idle = await (await request.get('/api/spike/exchange/status')).json()
  writeFileSync(OUT, JSON.stringify(out, null, 2))

  // S3: writes from inside the alarm.
  const s3: unknown[] = []
  for (const n of [1, 10, 40, 200, 1000]) {
    await request.post('/api/spike/exchange/s3', { data: { n } })
    let result: string | null = null
    for (let i = 0; i < 240 && !result; i++) {
      await new Promise((r) => setTimeout(r, 500))
      result = ((await (await request.get('/api/spike/exchange/status')).json()) as { s3result: string | null }).s3result
    }
    s3.push(result ? JSON.parse(result) : { n, timeout: true })
    out.s3 = s3
    writeFileSync(OUT, JSON.stringify(out, null, 2))
  }
  out.afterS3 = await (await request.get('/api/spike/exchange/status')).json()
  writeFileSync(OUT, JSON.stringify(out, null, 2))
})

test('spike: action to DO path', async ({ users }) => {
  const [a] = await users(1)
  await a.page.goto('/home')
  await expect(a.page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })
  const result = await a.page.evaluate(async () => {
    const { token } = (await (await fetch('/api/auth/token', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' } })).json()) as { token: string }
    const call = async (name: string, body: unknown) => {
      const r = await fetch(`/api/actions/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })
      return { status: r.status, body: await r.json() }
    }
    return {
      placeLimit: await call('placeOrder', { ticker: 'ORBT', side: 'buy', type: 'limit', qty: 5, limitCents: 10_000 }),
      placeMarket: await call('placeOrder', { ticker: 'VOLT', side: 'sell', type: 'market', qty: 1 }),
      badTicker: await call('placeOrder', { ticker: 'AAPL', side: 'buy', type: 'limit', qty: 1, limitCents: 100 }),
      badQty: await call('placeOrder', { ticker: 'ORBT', side: 'buy', type: 'limit', qty: 1.5, limitCents: 100 }),
      cancel: await call('cancelOrder', { orderId: 'nope' }),
      forgedUser: await call('placeOrder', { ticker: 'ORBT', side: 'buy', type: 'limit', qty: 1, limitCents: 100, userId: 'someone-else' }),
    }
  })
  writeFileSync(OUT.replace('.json', '-actions.json'), JSON.stringify(result, null, 2))
  expect(result.placeLimit.body).toEqual({ success: false, error: 'round_closed' })
})
