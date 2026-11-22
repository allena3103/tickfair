/**
 * Exchange collections (see BRIEF "RecordRoom collections").
 *
 * These are a one-way projection of ExchangeRoom state. Only server code
 * (X-App-Action through the tools API) writes them, so every role —
 * including admin — gets create/update/delete: false.
 *
 * `orders` and `fills` are private ('own' via userId). Note that `userBound`
 * stamps the *caller's* id on create, so the mirror must write these rows with
 * `X-User-Id` set to the trader's id, not the owner's.
 */

import type { CollectionSchema, ColumnDefinition, RolePermissions } from 'deepspace/schema'

const text = (name: string): ColumnDefinition => ({ name, storage: 'text', interpretation: 'plain' })
const num = (name: string): ColumnDefinition => ({ name, storage: 'number', interpretation: 'plain' })
const json = (name: string): ColumnDefinition => ({ name, storage: 'text', interpretation: { kind: 'json' } })
const select = (name: string, options: string[]): ColumnDefinition => ({
  name,
  storage: 'text',
  interpretation: { kind: 'select', options },
})
const owner = (name: string): ColumnDefinition => ({
  name,
  storage: 'text',
  interpretation: 'plain',
  userBound: true,
  immutable: true,
})

function readOnly(read: RolePermissions['read']): RolePermissions {
  return { read, create: false, update: false, delete: false }
}

/** Public: every role, including anonymous ('*'), may read. */
const PUBLIC_READ: Record<string, RolePermissions> = {
  '*': readOnly(true),
  viewer: readOnly(true),
  member: readOnly(true),
  admin: readOnly(true),
}

/** Private: only the row's owner may read, admins included (D7: orders are anonymous). */
const OWN_READ: Record<string, RolePermissions> = {
  '*': readOnly(false),
  viewer: readOnly('own'),
  member: readOnly('own'),
  admin: readOnly('own'),
}

export const tickersSchema: CollectionSchema = {
  name: 'tickers',
  columns: [text('symbol'), text('name'), text('sector'), num('lastCents'), num('openCents')],
  permissions: PUBLIC_READ,
}

export const ordersSchema: CollectionSchema = {
  name: 'orders',
  ownerField: 'userId',
  columns: [
    owner('userId'),
    text('ticker'),
    select('side', ['buy', 'sell']),
    select('type', ['limit', 'market']),
    num('qty'),
    num('limitCents'),
    num('filledQty'),
    num('avgFillCents'),
    select('status', ['open', 'partial', 'filled', 'cancelled']),
    num('batchId'),
    text('roundId'),
  ],
  permissions: OWN_READ,
}

export const fillsSchema: CollectionSchema = {
  name: 'fills',
  ownerField: 'userId',
  columns: [
    owner('userId'),
    text('orderId'),
    text('ticker'),
    select('side', ['buy', 'sell']),
    num('qty'),
    num('priceCents'),
    num('batchId'),
    text('roundId'),
  ],
  permissions: OWN_READ,
}

export const tapeSchema: CollectionSchema = {
  name: 'tape',
  columns: [text('ticker'), text('roundId'), num('batchId'), num('clearCents'), num('volume'), text('seed'), num('at')],
  permissions: PUBLIC_READ,
}

export const portfoliosSchema: CollectionSchema = {
  name: 'portfolios',
  columns: [text('userId'), text('displayName'), text('roundId'), num('cashCents'), json('holdings')],
  permissions: PUBLIC_READ,
}

export const newsSchema: CollectionSchema = {
  name: 'news',
  columns: [text('roundId'), text('ticker'), text('headline'), text('body'), num('publishedAt')],
  permissions: PUBLIC_READ,
}

export const roundsSchema: CollectionSchema = {
  name: 'rounds',
  columns: [
    num('startsAt'),
    num('endsAt'),
    select('status', ['live', 'done']),
    json('standings'),
    text('winnerId'),
  ],
  permissions: PUBLIC_READ,
}

export const exchangeSchemas: CollectionSchema[] = [
  tickersSchema,
  ordersSchema,
  fillsSchema,
  tapeSchema,
  portfoliosSchema,
  newsSchema,
  roundsSchema,
]
