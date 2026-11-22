/**
 * A signed change that stays readable without color: every value carries an
 * arrow and a sign (▲ +1.25 / ▼ −0.40 / · 0.00). Color only reinforces the
 * direction. Arrow, sign, and color all follow the *displayed* (rounded)
 * value, so they never disagree with the number (see displayDelta).
 */

import { cn } from '@/lib/utils'
import { displayDelta, type DeltaKind, type Direction } from './format'

const ARROW: Record<Direction, string> = { up: '▲', down: '▼', flat: '·' }

export const DIRECTION_TEXT: Record<Direction, string> = {
  up: 'text-up',
  down: 'text-down',
  flat: 'text-muted-foreground',
}

interface DeltaProps {
  /** Cents for `price` and `money`; a ratio for `percent`. */
  value: number
  kind?: DeltaKind
  /** `money` only: round to whole dollars. */
  whole?: boolean
  className?: string
}

export function Delta({ value, kind = 'price', whole, className }: DeltaProps) {
  const { direction, label } = displayDelta(value, kind, { whole })
  return (
    <span
      data-direction={direction}
      className={cn('inline-flex items-baseline gap-1 font-mono tabular-nums', DIRECTION_TEXT[direction], className)}
    >
      <span aria-hidden className="text-[0.7em]">
        {ARROW[direction]}
      </span>
      <span>{label}</span>
      <span className="sr-only">{direction === 'up' ? 'up' : direction === 'down' ? 'down' : 'unchanged'}</span>
    </span>
  )
}
