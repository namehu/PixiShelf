import { Prisma, type PrismaClient } from '@pixishelf/db'
import { exactImageCountSql, optimizedImageCountSql } from './statistics-queries'

export async function diagnoseStatistics(db: PrismaClient) {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`
      await tx.$executeRaw`SET LOCAL statement_timeout = '30s'`
      await tx.$executeRaw`SET LOCAL lock_timeout = '2s'`
      const triggers = await tx.$queryRaw<
        { name: string; enabled: string; type: number; function: string; definition: string }[]
      >`
      SELECT t.tgname AS name, t.tgenabled::text AS enabled, t.tgtype::int AS type,
        p.proname AS function, pg_get_triggerdef(t.oid) AS definition
      FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
      WHERE t.tgrelid = '"Image"'::regclass AND NOT t.tgisinternal
    `
      const indexes = await tx.$queryRaw<{ table: string; name: string; valid: boolean; definition: string }[]>`
      SELECT tab.relname AS table, idx.relname AS name, i.indisvalid AS valid, pg_get_indexdef(i.indexrelid) AS definition
      FROM pg_index i JOIN pg_class tab ON tab.oid = i.indrelid JOIN pg_class idx ON idx.oid = i.indexrelid
      WHERE i.indrelid IN ('"Image"'::regclass, '"Artwork"'::regclass, '"Tag"'::regclass,
        'artwork_artists'::regclass, 'artwork_artist_evidence'::regclass)
    `
      const [totals] = await tx.$queryRaw<{ exact: bigint; optimized: bigint; mismatchedArtworks: bigint }[]>`
      SELECT (SELECT COUNT(*) FROM "Image") AS exact,
        (SELECT count FROM (${optimizedImageCountSql}) optimized) AS optimized,
        (SELECT COUNT(*) FROM "Artwork" a LEFT JOIN (
          SELECT "artworkId", COUNT(*) AS actual FROM "Image" WHERE "artworkId" IS NOT NULL GROUP BY "artworkId"
        ) actual ON actual."artworkId" = a.id WHERE a."imageCount" <> COALESCE(actual.actual, 0)) AS "mismatchedArtworks"
    `
      const required = [
        ['artwork_image_count_trigger', 4],
        ['artwork_image_count_delete_trigger', 8],
        ['artwork_image_count_update_trigger', 16]
      ] as const
      const triggersReady = required.every(([name, type]) =>
        triggers.some(
          (t) =>
            t.name === name &&
            t.type === type &&
            ['O', 'A'].includes(t.enabled) &&
            t.function === 'update_artwork_image_count'
        )
      )
      const safeToEnable = Boolean(
        totals && totals.exact === totals.optimized && totals.mismatchedArtworks === 0n && triggersReady
      )
      const plans: Record<string, unknown> = {}
      for (const [name, sql] of [
        ['exact', exactImageCountSql],
        ['counter', optimizedImageCountSql]
      ] as const) {
        plans[name] = await tx.$queryRaw(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON) ${sql}`)
      }
      return { safeToEnable, triggersReady, totals, triggers, indexes, plans }
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 180_000, maxWait: 5_000 }
  )
}
