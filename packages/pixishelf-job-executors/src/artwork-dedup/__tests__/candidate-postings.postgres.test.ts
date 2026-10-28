import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Prisma, PrismaClient } from '@pixishelf/db'
import { readCandidatePostings } from '../candidate-postings.ts'
import { VISUAL_LIMITS } from '../visual-matching.ts'

const url = process.env.ARTWORK_DEDUP_CANDIDATE_POSTINGS_EXCLUSIVE === '1' ? process.env.QUEUE_KERNEL_TEST_DATABASE_URL : undefined
if (url) {
  const target = new URL(url)
  if (target.hostname !== '127.0.0.1' || target.port !== '55432' || !target.pathname.startsWith('/f03_candidate_postings_'))
    throw new Error('Candidate posting tests require their dedicated f03_candidate_postings_* database on 127.0.0.1:55432')
}
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const suite = db ? describe.sequential : describe.skip
const prefix = `candidate-postings-${randomUUID()}`, runIds: string[] = []
let artistId: number
beforeAll(async () => { if (db) artistId = (await db.artist.create({ data: { name: prefix } })).id })
afterAll(async () => {
  if (!db) return
  await db.artworkDedupRun.deleteMany({ where: { id: { in: runIds } } })
  await db.artist.delete({ where: { id: artistId } })
  await db.$disconnect()
}, 30_000)

type Posting = { imageId: number; multiplicity: number }
type Plan = { 'Node Type': string; 'Index Cond'?: string; Filter?: string; 'Actual Rows': number; 'Actual Loops': number;
  'Rows Removed by Filter'?: number; 'Shared Hit Blocks': number; Plans?: Plan[] }
const nodes = (plan: Plan): Plan[] => [plan, ...(plan.Plans ?? []).flatMap(nodes)]
const canonical = (rows: Posting[]) => [...rows].sort((a, b) => a.imageId - b.imageId || a.multiplicity - b.multiplicity)
const key = (n: number) => `0:0:${n.toString(16).padStart(4, '0')}`
async function run(tx: Prisma.TransactionClient = db!) {
  const id = randomUUID()
  await tx.artworkDedupRun.create({ data: { id, artistId, requestedBy: prefix, idempotencyKey: id, mode: 'FULL', status: 'COMPLETED', stage: 'DONE' } })
  runIds.push(id)
  return id
}
async function rows(runId: string, postingKey: string, count: number, offset = 0, multiplicity = 1, tx: Prisma.TransactionClient = db!) {
  await tx.$executeRaw(Prisma.sql`INSERT INTO "ArtworkDedupVisualPosting" ("runId",key,"imageId",multiplicity)
    SELECT ${runId},${postingKey},n+${offset},${multiplicity} FROM generate_series(1,${count}::int) n`)
}
async function capture(tx: Prisma.TransactionClient, runId: string, keys: string[]) {
  const statements: Prisma.Sql[] = []
  const proxy = new Proxy(tx, { get(target, prop, receiver) {
    if (prop === '$queryRaw') return (sql: Prisma.Sql) => { statements.push(sql); return target.$queryRaw(sql) }
    return Reflect.get(target, prop, receiver)
  } }) as Prisma.TransactionClient
  return { rows: await readCandidatePostings(proxy, runId, keys), statements }
}
async function plan(tx: Prisma.TransactionClient, sql: Prisma.Sql) {
  const result = await tx.$queryRaw<Array<{ 'QUERY PLAN': Array<{ Plan: Plan }> }>>(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`)
  return result[0]!['QUERY PLAN'][0]!.Plan
}
function expectSeek(root: Plan) {
  const all = nodes(root)
  expect(root['Node Type']).toBe('Limit')
  expect(all.some(node => node['Node Type'] === 'Nested Loop')).toBe(true)
  expect(all.some(node => node['Node Type'].includes('Sort'))).toBe(false)
  const indexes = all.filter(node => node['Node Type'] === 'Index Scan' || node['Node Type'] === 'Index Only Scan')
  expect(indexes.length).toBeGreaterThan(0)
  for (const index of indexes) {
    expect(index['Index Cond']).toContain('"runId"')
    expect(index['Index Cond']).toContain('key =')
    expect(index.Filter).toBeUndefined()
  }
  return indexes
}

suite('bounded scalar candidate posting seeks', () => {
  it('does no SQL for zero keys and rejects more than the four-view key bound', async () => {
    const runId = await run()
    const empty = await capture(db!, runId, [])
    expect(empty).toEqual({ rows: [], statements: [] })
    await expect(readCandidatePostings(db!, runId, Array.from({ length: 161 }, (_, i) => key(i)))).rejects.toThrow('Visual posting key budget')
  })

  it('retains the last of 160 keys and counts duplicate input keys once but same-image postings separately', async () => {
    const runId = await run(), keys = Array.from({ length: 160 }, (_, i) => key(i))
    await db!.artworkDedupVisualPosting.createMany({ data: [
      { runId, key: keys[0]!, imageId: 90, multiplicity: 2 },
      { runId, key: keys[1]!, imageId: 90, multiplicity: 3 },
      { runId, key: keys.at(-1)!, imageId: 1, multiplicity: 4 }
    ] })
    const current = await capture(db!, runId, [...keys, keys[0]!, keys[1]!])
    const legacy = await db!.artworkDedupVisualPosting.findMany({ where: { runId, key: { in: keys } }, take: VISUAL_LIMITS.queryPostings + 1, select: { imageId: true, multiplicity: true } })
    expect(current.statements).toHaveLength(1)
    expect(canonical(current.rows)).toEqual(canonical(legacy))
    expect(current.rows).toHaveLength(3)
    expect(current.rows.reduce((sum, posting) => sum + posting.multiplicity, 0)).toBe(9)
    expect([...new Set(current.rows.map(posting => posting.imageId))].sort((a, b) => a - b)).toEqual([1, 90])
  })

  it('returns the complete 20000-row multiset including the last key before the sentinel is needed', async () => {
    const runId = await run()
    await rows(runId, key(0), 10000)
    await rows(runId, key(159), 10000, 10000)
    const keys = Array.from({ length: 160 }, (_, i) => key(i))
    const current = await readCandidatePostings(db!, runId, keys)
    const legacy = await db!.artworkDedupVisualPosting.findMany({ where: { runId, key: { in: keys } }, take: VISUAL_LIMITS.queryPostings + 1, select: { imageId: true, multiplicity: true } })
    expect(current).toHaveLength(20000)
    expect(canonical(current)).toEqual(canonical(legacy))
    expect(current.reduce((sum, posting) => sum + posting.multiplicity, 0)).toBe(20000)
    await rows(runId, key(159), 1, 20000)
    expect(await readCandidatePostings(db!, runId, keys)).toHaveLength(20001)
  }, 30_000)

  it.each(['early-key', 'across-keys'] as const)('lazily stops all index scans at the global 20001 sentinel for dense %s buckets', async mode => {
    const runId = await run(), keys = [key(0), key(1), key(2), key(3)]
    const counts = mode === 'early-key' ? [25000, 25000, 25000, 25000] : [6667, 6667, 10000, 10000]
    for (const [i, count] of counts.entries()) await rows(runId, keys[i]!, count)
    const current = await capture(db!, runId, keys)
    expect(current.rows).toHaveLength(20001)
    const root = await plan(db!, current.statements[0]!)
    const indexes = expectSeek(root)
    expect(root['Actual Rows']).toBe(20001)
    // Counts are chosen so EXPLAIN's integer per-loop average is exact.
    expect(indexes.reduce((sum, node) => sum + node['Actual Rows'] * node['Actual Loops'], 0)).toBe(20001)
    const values = nodes(root).find(node => node['Node Type'] === 'Values Scan')!
    expect(values['Actual Rows']).toBe(mode === 'early-key' ? 1 : 3)
    console.info('F03_POSTING_CAP ' + JSON.stringify({ mode, returned: current.rows.length, consumedKeys: values['Actual Rows'], indexRows: indexes.reduce((sum, node) => sum + node['Actual Rows'] * node['Actual Loops'], 0), sharedHits: root['Shared Hit Blocks'] }))
  }, 30_000)

  it('keeps multiplicity overflow visible even when fewer than 20001 rows are returned', async () => {
    const runId = await run()
    await rows(runId, key(0), 2500, 0, 4)
    await rows(runId, key(159), 2501, 0, 4)
    const current = await readCandidatePostings(db!, runId, [key(0), key(0), key(159)])
    expect(current).toHaveLength(5001)
    expect(current.reduce((sum, posting) => sum + posting.multiplicity, 0)).toBe(20004)
    expect(new Set(current.map(posting => posting.imageId)).size).toBe(2501)
  })

  it('uses both primary-key prefixes for a new run absent from historical statistics', async () => {
    const history = await run()
    await db!.$executeRaw(Prisma.sql`INSERT INTO "ArtworkDedupVisualPosting" ("runId",key,"imageId",multiplicity)
      SELECT ${history},'0:0:'||lpad(to_hex(n%65536),4,'0'),n,1 FROM generate_series(1,100000) n`)
    // Test-only history setup. The new run remains uncommitted below, so even
    // autoanalyze cannot include it. Production never requests ANALYZE.
    await db!.$executeRawUnsafe('ANALYZE "ArtworkDedupVisualPosting"')
    const rollback = new Error('rollback stale-statistics fixture')
    await expect(db!.$transaction(async tx => {
      const runId = await run(tx), keys = Array.from({ length: 40 }, (_, i) => key(i))
      await tx.$executeRaw(Prisma.sql`INSERT INTO "ArtworkDedupVisualPosting" ("runId",key,"imageId",multiplicity)
        SELECT ${runId},'0:0:'||lpad(to_hex(CASE WHEN n<=2000 THEN n%40 ELSE 1024+n%40 END),4,'0'),n,1 FROM generate_series(1,4000) n`)
      const current = await capture(tx, runId, keys)
      const legacySql = Prisma.sql`SELECT "imageId",multiplicity FROM "ArtworkDedupVisualPosting"
        WHERE "runId"=${runId} AND key IN (${Prisma.join(keys)}) ORDER BY "runId",key,"imageId" LIMIT 20001`
      const legacy = await tx.$queryRaw<Posting[]>(legacySql)
      expect(canonical(current.rows)).toEqual(canonical(legacy))
      const oldPlan = await plan(tx, legacySql), newPlan = await plan(tx, current.statements[0]!)
      const oldIndex = nodes(oldPlan).find(node => node['Node Type'] === 'Index Scan')!
      expect(oldIndex['Index Cond']).not.toContain('key =')
      expect(oldIndex.Filter).toContain('key = ANY')
      expect(oldIndex['Rows Removed by Filter']).toBe(2000)
      expectSeek(newPlan)
      expect(newPlan['Actual Rows']).toBe(2000)
      console.info('F03_POSTING_STALE_STATISTICS ' + JSON.stringify({ history: 100000, newRun: 4000, returned: current.rows.length,
        oldRemoved: oldIndex['Rows Removed by Filter'], oldSharedHits: oldPlan['Shared Hit Blocks'], newSharedHits: newPlan['Shared Hit Blocks'], newShape: nodes(newPlan).map(node => node['Node Type']) }))
      throw rollback
    }, { timeout: 30_000 })).rejects.toBe(rollback)
  }, 30_000)
})
