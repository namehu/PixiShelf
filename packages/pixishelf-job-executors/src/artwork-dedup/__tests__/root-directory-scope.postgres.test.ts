import { randomUUID } from 'node:crypto'
import { afterAll, describe, expect, it } from 'vitest'
import { Prisma, PrismaClient, assertArtworkDedupExecution, lockCreatorCatalog, type MediaContentLogicalRoot } from '@pixishelf/db'
import { QueryDirectoryScope } from '../root-directory-scope.ts'

const url = process.env.ARTWORK_DEDUP_ROOT_SCOPE_EXCLUSIVE === '1' ? process.env.QUEUE_KERNEL_TEST_DATABASE_URL : undefined
if (url) {
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.port !== '55432' || !target.pathname.startsWith('/f03_root_scope_'))
    throw new Error('Scope tests require their dedicated f03_root_scope_* database on 127.0.0.1:55432')
}
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const suite = url ? describe.sequential : describe.skip
const prefix = `root-scope-${randomUUID()}`
const runs: string[] = [], jobs: string[] = [], artworks: number[] = [], artists: number[] = [], createdRoots: string[] = []
afterAll(async () => {
  if (!db) return
  await db.artworkDedupRun.deleteMany({ where: { id: { in: runs } } })
  await db.systemJob.deleteMany({ where: { id: { in: jobs } } })
  await db.artwork.deleteMany({ where: { id: { in: artworks } } })
  await db.artist.deleteMany({ where: { id: { in: artists } } })
  await db.mediaContentDirectoryState.deleteMany({ where: { OR: [{ relativeDirectory: { startsWith: prefix } }, { id: { in: createdRoots } }] } })
  await db.$disconnect()
}, 60_000)

async function fixture(counts: number[], options: { bothRoots?: boolean; pathPadding?: number } = {}) {
  const id = `${prefix}-${randomUUID()}`
  const roots = new Map<MediaContentLogicalRoot, string>()
  for (const logicalRoot of ['archive-media:v1', 'source-media:v1'] as const) {
    let row = await db!.mediaContentDirectoryState.findUnique({ where: { logicalRoot_relativeDirectory: { logicalRoot, relativeDirectory: '' } } })
    if (!row) { row = await db!.mediaContentDirectoryState.create({ data: { logicalRoot, relativeDirectory: '', rootIdentity: prefix } }); createdRoots.push(row.id) }
    roots.set(logicalRoot, row.rootIdentity)
  }
  const artist = await db!.artist.create({ data: { name: id } }); artists.push(artist.id)
  const job = await db!.systemJob.create({ data: { type: 'ARTWORK_DEDUP_SCAN', definitionVersion: 5, executionLane: 'BACKGROUND_WRITER', triggerSource: 'SYSTEM', queuePriority: 900, effectivePriority: 900, payload: {}, availableAt: new Date('2100-01-01') } }); jobs.push(job.id)
  const run = await db!.artworkDedupRun.create({ data: { artistId: artist.id, requestedBy: id, idempotencyKey: id, jobId: job.id, mode: 'FULL', status: 'RUNNING', stage: 'VISUAL', includeSuspectedVersions: true } }); runs.push(run.id)
  const ids: number[] = [], directories: Array<{ id: string; logicalRoot: MediaContentLogicalRoot; rootIdentity: string; relativeDirectory: string }> = []
  for (const [group, count] of counts.entries()) {
    const artwork = await db!.artwork.create({ data: { title: id } }); artworks.push(artwork.id); ids.push(artwork.id)
    await db!.artworkDedupItem.create({ data: { runId: run.id, artworkId: artwork.id, status: 'COMPLETE', frozenMediaRevision: 0, snapshotRevision: 0n, mediaEpoch: 0n, memberCount: BigInt(count) } })
    const rows = Array.from({ length: count }, (_, index) => {
      const logicalRoot = options.bothRoots && index === count - 1 ? 'archive-media:v1' as const : 'source-media:v1' as const
      // Archive sorts last by directory ID, beyond the first 100-row page.
      return { id: `${id}-${group}-${String(index).padStart(5, '0')}`, logicalRoot, rootIdentity: roots.get(logicalRoot)!, relativeDirectory: `${id}/${group}/${String(index).padStart(5, '0')}${'x'.repeat(options.pathPadding ?? 0)}` }
    })
    directories.push(...rows)
    for (let start = 0; start < rows.length; start += 100) {
      const batch = rows.slice(start, start + 100)
      await db!.mediaContentDirectoryState.createMany({ data: batch })
      await db!.artworkDedupMedia.createMany({ data: batch.map((directory, index) => ({ runId: run.id, artworkId: artwork.id, imageId: start + index + 1,
        sourcePath: `${directory.relativeDirectory}/file`, sourceRevision: 0n, logicalRoot: directory.logicalRoot, rootIdentity: directory.rootIdentity,
        relativeDirectory: directory.relativeDirectory, directoryId: directory.id, directoryGeneration: 0n, canonicalPath: `${directory.relativeDirectory}/file`, size: 1n, sha256: 'a'.repeat(64) })) })
    }
  }
  const execution = { runId: run.id, jobId: job.id, executionVersion: 1 }
  return { ids, execution, directories, scope: new QueryDirectoryScope(execution) }
}
type Fixture = Awaited<ReturnType<typeof fixture>>
type Observation = { derivations: number; legacyScans: number; queries: Array<{ sql: string; values: unknown[] }> }
const observation = (): Observation => ({ derivations: 0, legacyScans: 0, queries: [] })
async function check(test: Fixture, ids = test.ids, observed = observation()) {
  return db!.$transaction(async tx => {
    await assertArtworkDedupExecution(tx, test.execution)
    const proxy = new Proxy(tx, { get(target, prop, receiver) {
      if (prop === '$queryRaw') return (sql: Prisma.Sql) => {
        observed.queries.push({ sql: sql.sql, values: sql.values })
        if (sql.sql.includes('SELECT DISTINCT m."artworkId",m."logicalRoot"')) observed.derivations++
        if (sql.sql.includes('SELECT DISTINCT m."logicalRoot"')) observed.legacyScans++
        return target.$queryRaw(sql)
      }
      if (prop === '$queryRawUnsafe') return (sql: string, ...values: unknown[]) => {
        observed.queries.push({ sql, values }); return target.$queryRawUnsafe(sql, ...values)
      }
      return Reflect.get(target, prop, receiver)
    } }) as Prisma.TransactionClient
    return test.scope.assert(proxy, ids)
  }, { timeout: 30_000 })
}

suite('QUERY root directory scope', () => {
  it('locks catalog then both roots before any directory page on cache misses and hits', async () => {
    const test = await fixture([102], { bothRoots: true })
    for (let attempt = 0; attempt < 2; attempt++) {
      const observed = observation()
      expect(await check(test, test.ids, observed)).toBe(true)
      expect(observed.derivations).toBe(attempt === 0 ? 1 : 0)
      const catalog = observed.queries.findIndex(row => row.sql.includes('7341902118'))
      const roots = observed.queries.findIndex(row => row.sql.includes('"relativeDirectory" =') && row.sql.includes('FOR UPDATE'))
      const directory = observed.queries.findIndex(row => row.sql.includes('("logicalRoot", "relativeDirectory") IN'))
      expect(catalog).toBeGreaterThanOrEqual(0)
      expect(roots).toBeGreaterThan(catalog)
      expect(directory).toBeGreaterThan(roots)
      expect(observed.queries[roots]!.values).toEqual(['archive-media:v1', 'source-media:v1'])
      expect(observed.queries.filter(row => row.sql.includes('AS "exists"'))).toHaveLength(2)
    }
    // Actual contention: a catalog holder can finish before the scope requests
    // either root; the second transaction must not deadlock in reverse order.
    let catalogHeld!: () => void, scopeRequested!: () => void
    const ready = new Promise<void>(resolve => { catalogHeld = resolve })
    const waiting = new Promise<void>(resolve => { scopeRequested = resolve })
    const writer = db!.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1500ms'")
      await lockCreatorCatalog(tx); catalogHeld(); await waiting
      await tx.$queryRaw(Prisma.sql`SELECT id FROM "MediaContentDirectoryState" WHERE "relativeDirectory"='' ORDER BY "logicalRoot" COLLATE "C" FOR UPDATE`)
    }, { timeout: 5000 })
    await ready
    const scope = db!.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '1500ms'")
      await assertArtworkDedupExecution(tx, test.execution)
      const proxy = new Proxy(tx, { get(target, prop, receiver) {
        if (prop === '$queryRawUnsafe') return (sql: string, ...values: unknown[]) => {
          if (sql.includes('7341902118')) scopeRequested()
          return target.$queryRawUnsafe(sql, ...values)
        }
        return Reflect.get(target, prop, receiver)
      } }) as Prisma.TransactionClient
      expect(await test.scope.assert(proxy, test.ids)).toBe(true)
    }, { timeout: 5000 })
    await Promise.all([writer, scope])
  }, 30_000)

  it('invalidates the full item identity including zero versus null and the frozen membership signature', async () => {
    const test = await fixture([1]), observed = observation()
    expect(await check(test, test.ids, observed)).toBe(true)
    expect(await check(test, test.ids, observed)).toBe(true)
    expect(observed.derivations).toBe(1)
    for (const data of [{ snapshotRevision: null }, { snapshotRevision: 0n }, { membersSignature: 'b'.repeat(64) }]) {
      await db!.artworkDedupItem.update({ where: { runId_artworkId: { runId: test.execution.runId, artworkId: test.ids[0]! } }, data })
      expect(await check(test, test.ids, observed)).toBe(true)
    }
    expect(observed.derivations).toBe(4)
    // A changed frozen directory binding accompanied by its item snapshot must
    // be re-derived; the old cached list cannot hide the new stale generation.
    await db!.$transaction(async tx => {
      await tx.artworkDedupMedia.updateMany({ where: { runId: test.execution.runId }, data: { directoryGeneration: 1n } })
      await tx.artworkDedupItem.updateMany({ where: { runId: test.execution.runId }, data: { membersSignature: 'c'.repeat(64) } })
    })
    expect(await check(test, test.ids, observed)).toBe(false)
    expect(observed.derivations).toBe(5)
  })

  it('evicts the least recently used artwork at 128 entries', async () => {
    const test = await fixture(Array<number>(129).fill(1)), observed = observation()
    for (let start = 0; start < 128; start += 50) expect(await check(test, test.ids.slice(start, Math.min(start + 50, 128)), observed)).toBe(true)
    expect(observed.derivations).toBe(3)
    expect(await check(test, [test.ids[0]!], observed)).toBe(true)
    expect(await check(test, [test.ids[128]!], observed)).toBe(true)
    expect(await check(test, [test.ids[0]!], observed)).toBe(true)
    expect(observed.derivations).toBe(4)
    expect(await check(test, [test.ids[1]!], observed)).toBe(true)
    expect(observed.derivations).toBe(5)
  }, 60_000)

  it.each(['directory-count', 'metadata-bytes'] as const)('falls back without truncating when %s exceeds the cache budget', async budget => {
    const test = budget === 'directory-count' ? await fixture([2001]) : await fixture([300], { pathPadding: 3600 })
    const observed = observation()
    expect(await check(test, test.ids, observed)).toBe(true)
    expect(observed.derivations).toBe(1)
    expect(observed.legacyScans).toBeGreaterThan(0)
    await db!.mediaContentDirectoryState.update({ where: { id: test.directories.at(-1)!.id }, data: { generation: 1n } })
    expect(await check(test, test.ids, observed)).toBe(false)
    expect(observed.derivations).toBe(2)
    expect(observed.legacyScans).toBeGreaterThan(1)
  }, 90_000)

  it('evicts directory-heavy entries and falls back when a combined batch exceeds 2000 descriptors', async () => {
    const test = await fixture([1001, 1001]), observed = observation()
    expect(await check(test, [test.ids[0]!], observed)).toBe(true)
    expect(await check(test, [test.ids[1]!], observed)).toBe(true)
    expect(await check(test, [test.ids[0]!], observed)).toBe(true)
    expect(observed.derivations).toBe(3)
    expect(observed.legacyScans).toBe(0)
    expect(await check(test, test.ids, observed)).toBe(true)
    expect(observed.derivations).toBe(4)
    expect(observed.legacyScans).toBeGreaterThan(0)
  }, 90_000)
})
