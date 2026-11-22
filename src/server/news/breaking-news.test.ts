import { describe, expect, it, vi } from 'vitest'
import type { ActionContext, ActionTools } from 'deepspace/worker'
import type { NewsDraw } from '../../shared/contracts.js'
import type { Env } from '../../../worker.js'
import { makeBreakingNews } from '../../actions/news.js'
import type { BreakingNewsDeps } from '../../actions/news.js'

const DRAW: NewsDraw = { ticker: 'VOLT', direction: 1, size: 'minor', deltaBps: 120, rampBatches: 10 }
const OWNER = 'owner-1'

function setup(over: Partial<BreakingNewsDeps> = {}) {
  let clock = 100_000
  const deps: BreakingNewsDeps = {
    draw: vi.fn((ticker) => (ticker ? { ...DRAW, ticker } : DRAW)),
    run: vi.fn(async () => ({ status: 'published' as const, newsId: 'n1', headline: 'h' })),
    latestNewsAt: vi.fn(async () => 0),
    now: () => clock,
    ...over,
  }
  const integration = vi.fn(async () => ({ success: true as const, data: {} }))
  const call = (userId: string, params: Record<string, unknown> = {}) =>
    makeBreakingNewsBound(userId, params)
  const action = makeBreakingNews(deps)
  function makeBreakingNewsBound(userId: string, params: Record<string, unknown>) {
    return action({
      userId,
      params,
      tools: { integration } as unknown as ActionTools,
      env: { OWNER_USER_ID: OWNER } as Env,
      callerJwt: 'x',
    } as ActionContext<Env>)
  }
  return { deps, call, integration, advance: (ms: number) => { clock += ms } }
}

describe('breakingNews', () => {
  it('refuses non-owners before any work', async () => {
    const { deps, call } = setup()
    expect(await call('someone-else')).toEqual({ success: false, error: 'forbidden' })
    expect(deps.run).not.toHaveBeenCalled()
    expect(deps.latestNewsAt).not.toHaveBeenCalled()
  })

  it('refuses everyone when OWNER_USER_ID is unset', async () => {
    const { deps } = setup()
    const action = makeBreakingNews(deps)
    const res = await action({ userId: '', params: {}, tools: {} as ActionTools, env: {} as Env, callerJwt: '' })
    expect(res).toEqual({ success: false, error: 'forbidden' })
  })

  it('runs the pipeline for the owner, pinning the ticker', async () => {
    const { deps, call } = setup()
    const res = await call(OWNER, { ticker: 'CURA' })
    expect(res).toEqual({ success: true, data: { published: true, newsId: 'n1', headline: 'h', shocked: true } })
    expect(deps.run).toHaveBeenCalledWith(expect.anything(), { ...DRAW, ticker: 'CURA' }, expect.any(Function))
  })

  it('rejects a bad ticker', async () => {
    const { call } = setup()
    expect(await call(OWNER, { ticker: 'AAPL' })).toEqual({ success: false, error: 'invalid_ticker' })
  })

  it('rate-limits to one call per 10 s, even when the first one skipped', async () => {
    const { call, advance } = setup({ run: vi.fn(async () => ({ status: 'skipped' as const, reason: 'invalid_json' })) })
    expect(await call(OWNER)).toEqual({ success: true, data: { published: false, reason: 'invalid_json' } })
    advance(9_999)
    expect(await call(OWNER)).toEqual({ success: false, error: 'rate_limited' })
    advance(1)
    expect((await call(OWNER)).success).toBe(true)
  })

  it('lets only one of two concurrent owner calls through', async () => {
    let release!: () => void
    const gate = new Promise<void>((r) => { release = r })
    const { deps, call } = setup({ latestNewsAt: vi.fn(async () => { await gate; return 0 }) })
    const both = Promise.all([call(OWNER), call(OWNER)])
    release()
    const results = await both
    expect(deps.run).toHaveBeenCalledTimes(1)
    expect(results.filter((r) => r.success)).toHaveLength(1)
    expect(results).toContainEqual({ success: false, error: 'rate_limited' })
  })

  it('rate-limits on a recent news record from another isolate', async () => {
    const { call } = setup({ latestNewsAt: vi.fn(async () => 95_000) })
    expect(await call(OWNER)).toEqual({ success: false, error: 'rate_limited' })
  })

  it('returns round_closed between rounds', async () => {
    const { call } = setup({ run: vi.fn(async () => ({ status: 'skipped' as const, reason: 'round_closed' })) })
    expect(await call(OWNER)).toEqual({ success: false, error: 'round_closed' })
  })

  it('passes integration failures to the pipeline as throws', async () => {
    let invokeErr: unknown
    const { call, integration } = setup({
      run: vi.fn(async (_env, _draw, invoke) => {
        await invoke('anthropic/chat-completion', {}).catch((e: unknown) => { invokeErr = e })
        return { status: 'skipped' as const, reason: 'llm_error' }
      }),
    })
    integration.mockResolvedValueOnce({ success: false, error: 'no credits', code: 'insufficient_credits' } as never)
    await call(OWNER)
    expect((invokeErr as Error).message).toBe('insufficient_credits')
  })
})
