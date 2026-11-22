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

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background text-foreground">
        <header className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
          <span className="font-mono text-sm font-semibold uppercase tracking-[0.2em]">{APP_NAME}</span>
          <Link
            to="/trade"
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent"
          >
            Sign in
          </Link>
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
  const steps = [
    { n: '01', title: 'Collect', body: 'Every order sent in the same second joins one batch.' },
    { n: '02', title: 'Cross', body: 'The price that trades the most shares wins.' },
    { n: '03', title: 'Settle', body: 'Everyone fills at that one price. Ties split pro rata.' },
  ]
  return (
    <section className="border-t border-border">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2">
        <div>
          <h2 className="text-3xl font-semibold tracking-tight">How a batch auction works</h2>
          <ol className="mt-8 border-l border-border">
            {steps.map((s) => (
              <li key={s.n} className="relative pb-8 pl-6 last:pb-0">
                <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
                <p className="font-mono text-xs text-muted-foreground">{s.n}</p>
                <p className="mt-1 text-lg font-semibold">{s.title}</p>
                <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
        <ClearingDiagram />
      </div>
    </section>
  )
}

/** Static supply/demand cross: demand steps down, supply steps up, one price clears. */
function ClearingDiagram() {
  return (
    <figure className="rounded-lg border border-border bg-card p-4">
      <svg viewBox="0 0 320 220" role="img" aria-labelledby="clear-title" className="h-auto w-full font-mono">
        <title id="clear-title">Buy orders step down, sell orders step up; they cross at the clearing price 42.10</title>
        {/* axes */}
        <path d="M40 16 V188 H308" className="fill-none stroke-border" strokeWidth="1" />
        {/* demand: buyers willing at each price, stepping down */}
        <path d="M40 40 H110 V80 H170 V120 H230 V160 H300" className="fill-none stroke-up" strokeWidth="2" />
        {/* supply: sellers willing at each price, stepping up */}
        <path d="M40 170 H100 V140 H160 V112 H220 V70 H300" className="fill-none stroke-down" strokeWidth="2" />
        {/* clearing price */}
        <path d="M40 112 H308" className="fill-none stroke-primary" strokeWidth="1" strokeDasharray="4 4" />
        <circle cx="170" cy="112" r="4" className="fill-primary" />
        <text x="48" y="104" className="fill-primary" fontSize="11">
          clears 42.10
        </text>
        <text x="236" y="54" className="fill-up" fontSize="10">
          ▲ buyers
        </text>
        <text x="236" y="182" className="fill-down" fontSize="10">
          ▼ sellers
        </text>
        <text x="4" y="20" className="fill-muted-foreground" fontSize="10">
          price
        </text>
        <text x="250" y="204" className="fill-muted-foreground" fontSize="10">
          shares
        </text>
      </svg>
      <figcaption className="mt-2 text-xs text-muted-foreground">
        Arrival order inside the second doesn&apos;t matter. The seed for every tie is published.
      </figcaption>
    </figure>
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
