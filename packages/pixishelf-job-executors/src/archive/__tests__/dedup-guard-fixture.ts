import type { Prisma } from '@pixishelf/db'
import { serializeArtworkDedupSourceSnapshot } from '@pixishelf/job-contracts'
import { vi } from 'vitest'

/** Original fixture proof plus exact source-lock query results; domain guards are not mocked. */
export function dedupGuardFixture(providerKey: string, externalId: string) {
  const key = `fixture-source:${providerKey}:${externalId}`
  const row = { id: key, identityKey: key, kind: 'PROVIDER', providerKey, externalId, logicalRoot: null, rootIdentity: null, canonicalPath: null, status: 'OPEN', ownerOperationId: null as string | null, generation: 3n }
  const snapshot = serializeArtworkDedupSourceSnapshot([{ identity: { kind: 'PROVIDER', providerKey, externalId }, sourceId: row.id, generation: row.generation }])
  const queryRaw = vi.fn(async (query: Prisma.Sql) => {
    const sql = query.strings.join('?')
    if (sql.includes('WITH keys AS')) {
      const slots = JSON.parse(query.values[0] as string) as { ordinal: number; kind: string; providerKey: string; externalId: string }[]
      return slots.map((slot) => {
        if (slot.kind !== 'PROVIDER' || slot.providerKey !== providerKey || slot.externalId !== externalId) throw new Error('Unexpected fixture source identity')
        return { ordinal: slot.ordinal, key }
      })
    }
    if (sql.includes('SELECT s.* FROM "ArtworkDedupSourceIdentity"')) {
      const records = JSON.parse(query.values[0] as string) as { identityKey: string }[]
      if (records.some((record) => record.identityKey !== key)) throw new Error('Unexpected fixture source key')
      return records.map(() => row)
    }
    if (sql.includes('SELECT id FROM "Artwork"') || /SELECT "id", "mediaRevision"\s+FROM "Artwork"/.test(sql)) {
      return query.values.filter((value) => typeof value === 'number').map((id) => ({ id, mediaRevision: 1 }))
    }
    if (sql.includes('SELECT EXISTS') && sql.includes(' held')) return [{ held: false }]
    throw new Error(`Unexpected dedup guard fixture query: ${sql}`)
  })
  return { row, snapshot, queryRaw, sourceIdentity: { findFirst: vi.fn(async () => row.status === 'OPEN' ? null : { id: row.id }), findMany: vi.fn(async () => [row]) }, claim: { findUnique: vi.fn(async () => null) } }
}
