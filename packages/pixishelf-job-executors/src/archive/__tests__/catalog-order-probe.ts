import { expect } from 'vitest'
import type { PrismaClient } from '@pixishelf/db'

/** Pause at the actual first catalog call. A separate PG transaction must still be
 * able to own catalog -> archive -> the original provider row, not merely a mock lock. */
export function archiveCatalogProbe(database: PrismaClient, sourceId: string) {
  let hits = 0
  return {
    hits: () => hits,
    wrap<T extends object>(transaction: T): T {
      let observed = false
      return new Proxy(transaction, {
        get(target, property, receiver) {
          const value = Reflect.get(target, property, receiver)
          if (property !== '$queryRawUnsafe') return value
          return async (...args: unknown[]) => {
            if (!observed && typeof args[0] === 'string' && args[0].includes('pg_advisory_xact_lock(7341902118)')) {
              observed = true
              await database.$transaction(async (other) => {
                await other.$executeRawUnsafe("SET LOCAL lock_timeout = '250ms'")
                await other.$queryRawUnsafe('SELECT pg_advisory_xact_lock(7341902118)::text')
                await other.$queryRawUnsafe('SELECT pg_advisory_xact_lock(7341902117)::text')
                const sources = await other.$queryRaw<
                  { id: string }[]
                >`SELECT id FROM "ArtworkDedupSourceIdentity" WHERE id=${sourceId} FOR UPDATE`
                expect(sources).toHaveLength(1)
              })
              hits++
            }
            return Reflect.apply(value as (...parameters: unknown[]) => unknown, target, args)
          }
        }
      })
    }
  }
}
