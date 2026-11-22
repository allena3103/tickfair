import { describe, expect, it } from 'vitest'
import {
  directionOf,
  formatCents,
  formatClock,
  formatPrice,
  formatQty,
  formatRelativeTime,
  formatSignedCents,
  formatSignedPercent,
  formatSignedPrice,
  displayDelta,
} from './format'

const MINUS = '−'

describe('format', () => {
  it('formats cents as dollars', () => {
    expect(formatCents(10_000_000)).toBe('$100,000.00')
    expect(formatCents(10_000_049, { whole: true })).toBe('$100,000')
    expect(formatCents(-4_000)).toBe(`${MINUS}$40.00`)
    expect(formatCents(Number.NaN)).toBe('—')
  })

  it('formats prices and quantities for dense columns', () => {
    expect(formatPrice(4210)).toBe('42.10')
    expect(formatPrice(5)).toBe('0.05')
    expect(formatQty(12_500)).toBe('12,500')
  })

  it('always signs a change, so direction survives without color', () => {
    expect(formatSignedPrice(125)).toBe('+1.25')
    expect(formatSignedPrice(-40)).toBe(`${MINUS}0.40`)
    expect(formatSignedPrice(0)).toBe('0.00')
    expect(formatSignedCents(125_000)).toBe('+$1,250.00')
    expect(formatSignedCents(-4_000, { whole: true })).toBe(`${MINUS}$40`)
    expect(formatSignedCents(0)).toBe('$0.00')
    expect(formatSignedPercent(0.0125)).toBe('+1.25%')
    expect(formatSignedPercent(-0.5)).toBe(`${MINUS}50.00%`)
    expect(formatSignedPercent(-0.00001)).toBe('0.00%')
    expect(directionOf(3)).toBe('up')
    expect(directionOf(-3)).toBe('down')
    expect(directionOf(0)).toBe('flat')
  })

  it('derives the arrow from the displayed value, so tiny moves read as flat', () => {
    // percent: 0.004% displays as 0.00%
    expect(displayDelta(0.00004, 'percent')).toEqual({ direction: 'flat', label: '0.00%' })
    expect(displayDelta(-0.00004, 'percent')).toEqual({ direction: 'flat', label: '0.00%' })
    expect(displayDelta(0.00005, 'percent')).toEqual({ direction: 'up', label: '+0.01%' })
    expect(displayDelta(-0.00005, 'percent')).toEqual({ direction: 'down', label: `${MINUS}0.01%` })
    expect(displayDelta(0.0125, 'percent')).toEqual({ direction: 'up', label: '+1.25%' })
    // whole-dollar money: +/-49 cents displays as $0
    expect(displayDelta(49, 'money', { whole: true })).toEqual({ direction: 'flat', label: '$0' })
    expect(displayDelta(-49, 'money', { whole: true })).toEqual({ direction: 'flat', label: '$0' })
    expect(displayDelta(50, 'money', { whole: true })).toEqual({ direction: 'up', label: '+$1' })
    expect(displayDelta(-50, 'money', { whole: true })).toEqual({ direction: 'down', label: `${MINUS}$1` })
    expect(displayDelta(-125_000, 'money')).toEqual({ direction: 'down', label: `${MINUS}$1,250.00` })
    // price: sub-cent values round to whole cents
    expect(displayDelta(0.4, 'price')).toEqual({ direction: 'flat', label: '0.00' })
    expect(displayDelta(-0.4, 'price')).toEqual({ direction: 'flat', label: '0.00' })
    expect(displayDelta(125, 'price')).toEqual({ direction: 'up', label: '+1.25' })
    expect(displayDelta(-40)).toEqual({ direction: 'down', label: `${MINUS}0.40` })
    expect(displayDelta(Number.NaN, 'percent')).toEqual({ direction: 'flat', label: '—' })
  })

  it('formats relative time', () => {
    const now = 1_000_000_000_000
    expect(formatRelativeTime(now - 2_000, now)).toBe('just now')
    expect(formatRelativeTime(now - 42_000, now)).toBe('42s ago')
    expect(formatRelativeTime(now - 3 * 60_000, now)).toBe('3m ago')
    expect(formatRelativeTime(now - 2 * 3_600_000, now)).toBe('2h ago')
    expect(formatRelativeTime(now + 5_000, now)).toBe('just now')
  })

  it('formats a countdown clock', () => {
    expect(formatClock(754_000)).toBe('12:34')
    expect(formatClock(15 * 60_000)).toBe('15:00')
    expect(formatClock(3_725_000)).toBe('1:02:05')
    expect(formatClock(400)).toBe('0:01')
    expect(formatClock(-5)).toBe('0:00')
  })
})
