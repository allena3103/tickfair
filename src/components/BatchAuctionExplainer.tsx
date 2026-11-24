/**
 * "How a batch auction works": the three steps and the clearing diagram.
 * Shared by the landing page section and the order ticket's modal so the
 * explanation lives in one place. Static markup only (the landing page is
 * prerendered).
 */
import { useId } from 'react'

const STEPS = [
  { n: '01', title: 'Collect', body: 'Every order sent in the same second joins one batch.' },
  { n: '02', title: 'Cross', body: 'The price that trades the most shares wins.' },
  { n: '03', title: 'Settle', body: 'Everyone fills at that one price. Ties split pro rata.' },
]

export function BatchAuctionSteps({ className }: { className?: string }) {
  return (
    <ol className={`border-l border-border ${className ?? ''}`}>
      {STEPS.map((s) => (
        <li key={s.n} className="relative pb-8 pl-6 last:pb-0">
          <span className="absolute -left-[5px] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
          <p className="font-mono text-xs text-muted-foreground">{s.n}</p>
          <p className="mt-1 text-lg font-semibold">{s.title}</p>
          <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
        </li>
      ))}
    </ol>
  )
}

/** Static supply/demand cross: demand steps down, supply steps up, one price clears. */
export function ClearingDiagram() {
  // Unique per instance: the landing section and the modal can both be mounted.
  const titleId = useId()
  return (
    <figure className="rounded-lg border border-border bg-card p-4">
      <svg viewBox="0 0 320 220" role="img" aria-labelledby={titleId} className="h-auto w-full font-mono">
        <title id={titleId}>Buy orders step down, sell orders step up; they cross at the clearing price 42.10</title>
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
        {/* each label sits just past the end of its own curve */}
        <text x="240" y="152" className="fill-up" fontSize="10">
          ▲ buyers
        </text>
        <text x="240" y="62" className="fill-down" fontSize="10">
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
