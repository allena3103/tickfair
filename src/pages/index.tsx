/**
 * Design Direction
 *
 * Product: A shared trading floor where players trade three made-up stocks
 *   for 15-minute rounds, and every order sent in the same second fills at
 *   one fair price.
 * Emotion: The half-second before the departures board flips: your bet is
 *   in, and the whole room finds out at once.
 * Metaphor: A Swiss railway clock at night above a split-flap departures
 *   board. The red second hand pauses at twelve; every row flips together.
 * References: The SBB station clock (Hilfiker, 1944); Solari split-flap
 *   departure boards; the Braun ET66 calculator (Dieter Rams).
 * Signature: The batch sweep, a one-second bar that fills, snaps shut, and
 *   stamps a single clearing price.
 * Hero: Order chips drift into an open one-second window while the sweep
 *   fills; at the edge they collapse onto one price line and a print stamps
 *   onto the tape. Loops every 3 s; frozen on the cleared frame under
 *   reduced motion.
 *
 * Style Tile
 * - Color: Graphite-black dominant, warm off-white text, departure-board amber
 *   accent on CTAs and the sweep only; mint up, coral down, always with a sign.
 * - Type: IBM Plex Sans (headings + body) + IBM Plex Mono (every number). One
 *   engineered family reads as one instrument; mono keeps prices aligned.
 * - Theme: Dark. A trading floor is a board of lit numbers.
 * - Art direction: Modern minimalism, dense instrument panel: flat 1px rules,
 *   4px radius, no gradients or glass.
 * - Motion: Mechanical / technical: linear sweeps, instant snaps, no springs.
 * - Voice: Second person, never "we"; max 12-word sentences; no exclamation
 *   points.
 *
 * This is a STATIC page (top level of src/pages/): no providers, no hooks, no
 * auth fetch, no WebSocket. It is prerendered, so the hero animates with CSS
 * keyframes only (src/theme/tokens.css). Full brief: docs/design/direction.md.
 */

import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { Seo } from '../components/Seo'
import { APP_NAME } from '../constants'
import { seo } from '../seo'
import { TICKERS } from '../shared/contracts'
import { TICKER_INFO } from '../components/shell/tickers'
import { Delta } from '../theme/Delta'
import { useScrollToHash } from '../components/shell/useScrollToHash'
import { BatchAuctionSteps, ClearingDiagram } from '../components/BatchAuctionExplainer'

export default function Landing() {
  // Hash links (/#how-it-works) on direct load and from the header link: the
  // section renders after JS, so the browser's own anchor jump misses it.
  useScrollToHash()
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background text-foreground">
        <header className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <span className="font-mono text-sm font-semibold uppercase tracking-[0.2em]">{APP_NAME}</span>
          <nav className="flex items-center gap-1">
            <Link
              to="#how-it-works"
              data-testid="landing-how-link"
              className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              How it works
            </Link>
            <Link
              to="/trade"
              className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent"
            >
              Sign in
            </Link>
          </nav>
        </header>

        <Hero />
        <HowItWorks />
        <Rules />

        <section className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-col items-start gap-6 px-4 py-16 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">The next batch clears in one second.</h2>
            <PrimaryCta />
          </div>
        </section>

        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-muted-foreground sm:px-6">
            <span className="font-mono uppercase tracking-[0.2em]">{APP_NAME}</span>
            <span>Fake money. Made-up companies. Real order book.</span>
          </div>
        </footer>
      </div>
    </>
  )
}

function PrimaryCta() {
  return (
    <Link
      to="/trade"
      data-testid="landing-cta"
      className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
    >
      Sign in to trade
      <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
  )
}

function Hero() {
  return (
    <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-12 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:pt-20">
      <div>
        <p className="mb-5 font-mono text-xs uppercase tracking-[0.2em] text-primary">Batch auction · every 1 second</p>
        <h1 className="text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
          One second.
          <br />
          One price.
          <br />
          Everyone.
        </h1>
        <p className="mt-6 max-w-md text-base text-muted-foreground">
          You trade three made-up stocks against the room. Orders in the same second clear together. A faster
          connection buys you nothing.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-3">
          <PrimaryCta />
          <Link
            to="/home"
            className="rounded-md px-4 py-2.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Watch the floor
          </Link>
        </div>
      </div>
      <BatchSweep />
    </section>
  )
}

/** The signature element: one batch, slowed to a 3 s loop. */
function BatchSweep() {
  const chips = [
    { side: 'BUY', qty: 40, px: '42.18', delay: '0s' },
    { side: 'SELL', qty: 25, px: '42.04', delay: '0.12s' },
    { side: 'BUY', qty: 15, px: '42.10', delay: '0.24s' },
    { side: 'SELL', qty: 30, px: '42.10', delay: '0.36s' },
  ] as const
  return (
    <figure
      aria-label="Four orders arrive in the same second and clear at one price, 42.10"
      className="rounded-lg border border-border bg-card font-mono text-xs"
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5 text-muted-foreground">
        <span>
          <span className="text-foreground">ORBT</span> · batch 4,812
        </span>
        <span>window 1.000s</span>
      </div>

      <div className="relative grid min-h-[176px] grid-cols-2 gap-2 p-4">
        {chips.map((c, i) => (
          <div
            key={i}
            style={{ animationDelay: c.delay }}
            className="animate-chip-in flex items-center justify-between rounded-md border border-border bg-background px-3 py-2"
          >
            <span className={c.side === 'BUY' ? 'text-up' : 'text-down'}>
              {c.side === 'BUY' ? '▲' : '▼'} {c.side}
            </span>
            <span className="tabular-nums text-foreground">
              {c.qty} @ {c.px}
            </span>
          </div>
        ))}
        <div className="animate-clear-line pointer-events-none absolute inset-x-4 bottom-6 border-t border-dashed border-primary" />
        <div className="animate-print-stamp absolute bottom-2 right-4 rounded-sm bg-primary px-2 py-0.5 font-semibold text-primary-foreground">
          CLEAR 42.10 · 55 sh
        </div>
      </div>

      <div className="h-1 bg-muted">
        <div className="animate-batch-sweep h-full origin-left bg-primary" />
      </div>

      <ol className="divide-y divide-border">
        {[
          { b: '4,811', px: '42.04', d: -6, v: 120 },
          { b: '4,810', px: '42.10', d: 9, v: 85 },
          { b: '4,809', px: '42.01', d: 0, v: 40 },
        ].map((p) => (
          <li key={p.b} className="grid grid-cols-[1fr_auto_auto_auto] gap-4 px-4 py-2 tabular-nums text-muted-foreground">
            <span>batch {p.b}</span>
            <span className="text-foreground">{p.px}</span>
            <Delta value={p.d} className="w-14 justify-end" />
            <span className="w-14 text-right">{p.v} sh</span>
          </li>
        ))}
      </ol>
    </figure>
  )
}

function HowItWorks() {
  return (
    <section id="how-it-works" className="scroll-mt-16 border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">How a batch auction works</h2>
          <BatchAuctionSteps className="mt-8" />
        </div>
        <ClearingDiagram />
      </div>
    </section>
  )
}

function Rules() {
  const rules: [string, string][] = [
    ['Starting cash', '$100,000 fake dollars per round'],
    ['Rounds', '15 minutes live, then 2 minutes of results'],
    ['Positions', 'Long only. No margin, no shorting.'],
    ['Price band', '±10% of the last clear, per batch'],
    ['News', 'Made-up headlines move each stock. Read fast.'],
  ]
  return (
    <section className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">The rules</h2>
          <dl className="mt-8 divide-y divide-border border-y border-border text-sm">
            {rules.map(([k, v]) => (
              <div key={k} className="grid grid-cols-[9rem_1fr] gap-4 py-3">
                <dt className="font-mono text-xs uppercase tracking-wider text-muted-foreground">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">On the board</h2>
          <ul className="mt-8 divide-y divide-border border-y border-border">
            {TICKERS.map((t) => (
              <li key={t} className="flex items-baseline justify-between gap-4 py-3">
                <span className="font-mono text-lg font-semibold">{t}</span>
                <span className="flex-1 text-sm">{TICKER_INFO[t].name}</span>
                <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  {TICKER_INFO[t].sector}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
