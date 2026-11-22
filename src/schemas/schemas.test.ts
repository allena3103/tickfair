import { describe, expect, it } from 'vitest'
import { lintSchemas } from 'deepspace/worker'
import { schemas } from '../schemas'
import { exchangeSchemas } from './exchange-schemas'

describe('schemas', () => {
  it('pass the SDK schema lint with zero warnings (same check RecordRoom runs at boot)', () => {
    expect(lintSchemas(schemas)).toEqual([])
  })

  it('give no client role any write on exchange collections', () => {
    for (const s of exchangeSchemas) {
      for (const [role, p] of Object.entries(s.permissions)) {
        expect({ coll: s.name, role, c: p.create, u: p.update, d: p.delete }).toEqual({
          coll: s.name, role, c: false, u: false, d: false,
        })
      }
    }
  })

  it('keep orders and fills private to their owner, admins included', () => {
    for (const name of ['orders', 'fills']) {
      const s = exchangeSchemas.find((x) => x.name === name)!
      expect(s.ownerField).toBe('userId')
      expect(s.columns.find((c) => c.name === 'userId')?.userBound).toBe(true)
      expect(s.permissions['*'].read).toBe(false)
      for (const role of ['viewer', 'member', 'admin']) expect(s.permissions[role].read).toBe('own')
    }
  })

  it('let anyone, including anonymous, read the public collections', () => {
    for (const name of ['tickers', 'tape', 'news', 'rounds', 'portfolios']) {
      const s = exchangeSchemas.find((x) => x.name === name)!
      for (const role of ['*', 'viewer', 'member', 'admin']) expect(s.permissions[role].read).toBe(true)
    }
  })
})
