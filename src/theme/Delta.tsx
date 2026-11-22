/**
 * A signed price change that stays readable without color: every value
 * carries an arrow and a sign (▲ +1.25 / ▼ −0.40 / · 0.00). Color only
 * reinforces the direction.
 */

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { directionOf, formatSignedPercent, formatSignedPrice, type Direction } from './format'

const ARROW: Record<Direction, string> = { up: '▲', down: '▼', flat: '·' }

export const DIRECTION_TEXT: Record<Direction, string> = {
  up: 'text-up',
  down: 'text-down',
  flat: 'text-muted-foreground',
}

interface DeltaProps {
  /** Change in cents, or a ratio when `percent` is set. */
  value: number
  percent?: boolean
  /** Custom text for the number (the arrow and color still follow `value`). */
  children?: ReactNode
  className?: string
}

export function Delta({ value, percent, children, className }: DeltaProps) {
  const dir = directionOf(value)
  const label = percent ? formatSignedPercent(value) : formatSignedPrice(value)
  return (
    <span
      data-direction={dir}
      className={cn('inline-flex items-baseline gap-1 font-mono tabular-nums', DIRECTION_TEXT[dir], className)}
    >
      <span aria-hidden className="text-[0.7em]">
        {ARROW[dir]}
      </span>
      <span>{children ?? label}</span>
      <span className="sr-only">{dir === 'up' ? 'up' : dir === 'down' ? 'down' : 'unchanged'}</span>
    </span>
  )
}
