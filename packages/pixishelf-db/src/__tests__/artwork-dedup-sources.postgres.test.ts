import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  assertArtworkDedupSourceGroups,
  assertArtworkDedupSources,
  captureArtworkDedupSourceGroups,
  captureArtworkDedupSources,
  type ArtworkDedupCapturedSource,
  type ArtworkDedupSourceIdentityInput
} from '../artwork-dedup-claims'
import { lockContentDirectories } from '../media-content-common'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url, log: [{ emit: 'event', level: 'query' }] }) : null
const prefix = `dedup-sources-${randomUUID()}`
const roots = { 'source-media:v1': `${prefix}-source`, 'archive-media:v1': `${prefix}-archive` }
const createdRoots: string[] = []
let queries = 0
db?.$on('query', () => {
  queries++
})
type QueryPlanNode = {
  Plans?: QueryPlanNode[]
  'Subplan Name'?: string
  'Actual Loops'?: number
  'Rows Removed by Join Filter'?: number
  'Rows Removed by Filter'?: number
}
function planNodes(node: QueryPlanNode): QueryPlanNode[] {
  return [node, ...(node.Plans ?? []).flatMap(planNodes)]
}
const provider = (suffix: string = randomUUID()): ArtworkDedupSourceIdentityInput => ({
  kind: 'PROVIDER',
  providerKey: prefix,
  externalId: suffix
})
const path = (
  suffix: string = randomUUID(),
  kind: 'PATH' | 'DIRECTORY' = 'PATH',
  logicalRoot: keyof typeof roots = 'source-media:v1'
): ArtworkDedupSourceIdentityInput => ({
  kind,
  logicalRoot,
  rootIdentity: roots[logicalRoot],
  canonicalPath: `${prefix}/${suffix}`
})
const capture = (identities: readonly ArtworkDedupSourceIdentityInput[]) =>
  db!.$transaction((tx) => captureArtworkDedupSources(tx, { identities }))
const assert = (sources: readonly ArtworkDedupCapturedSource[]) =>
  db!.$transaction((tx) => assertArtworkDedupSources(tx, { sources }))
function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}
async function whileHolding(acquire: (tx: Prisma.TransactionClient) => Promise<unknown>, check: () => Promise<void>) {
  const acquired = deferred(),
    release = deferred()
  const holding = db!.$transaction(
    async (tx) => {
      await acquire(tx)
      acquired.resolve()
      await release.promise
    },
    { timeout: 10000 }
  )
  try {
    await Promise.race([acquired.promise, holding])
    await check()
  } finally {
    release.resolve()
    await holding
  }
}

describe.skipIf(!db)('bounded deduplication source proofs', () => {
  beforeAll(async () => {
    for (const logicalRoot of Object.keys(roots) as (keyof typeof roots)[]) {
      const row = await db!.mediaContentDirectoryState.findUnique({
        where: { logicalRoot_relativeDirectory: { logicalRoot, relativeDirectory: '' } }
      })
      if (row) roots[logicalRoot] = row.rootIdentity
      else {
        const created = await db!.mediaContentDirectoryState.create({
          data: { logicalRoot, rootIdentity: roots[logicalRoot], relativeDirectory: '' }
        })
        createdRoots.push(created.id)
      }
    }
  })
  afterAll(async () => {
    if (!db) return
    await db.artworkDedupSourceIdentity.deleteMany({
      where: { OR: [{ providerKey: prefix }, { canonicalPath: { startsWith: `${prefix}/` } }] }
    })
    await db.mediaContentDirectoryState.deleteMany({
      where: { id: { in: createdRoots }, mediaSources: { none: {} }, writes: { none: {} } }
    })
    await db.$disconnect()
  })

  it('keeps group/input order, shares an identity across groups, and preserves bigint generations', async () => {
    const a = provider(),
      b = path()
    const groups = await db!.$transaction((tx) =>
      captureArtworkDedupSourceGroups(tx, { groups: [[b, a], [a], [a, b]] })
    )
    expect(groups.map((group) => group.map((source) => source.identity))).toEqual([[b, a], [a], [a, b]])
    expect(groups[0]![1]).toEqual(groups[1]![0])
    expect(groups[0]![0]).toEqual(groups[2]![1])
    await db!.artworkDedupSourceIdentity.update({
      where: { id: groups[1]![0]!.sourceId },
      data: { generation: 9007199254740993n }
    })
    const fresh = await capture([a, b])
    expect(fresh[0]!.generation).toBe(9007199254740993n)
    await expect(assert(fresh)).resolves.toBeUndefined()
    await expect(assert(groups[0]!)).rejects.toMatchObject({ code: 'SOURCE_GENERATION_CHANGED' })
  })

  it('validates one/two identities and the full page budget before mutation', async () => {
    const a = provider()
    for (const identities of [[], [a, a], [a, provider(), provider()]]) {
      await expect(capture(identities)).rejects.toBeInstanceOf(RangeError)
    }
    for (const groups of [[], Array.from({ length: 10001 }, () => [a])]) {
      await expect(db!.$transaction((tx) => captureArtworkDedupSourceGroups(tx, { groups }))).rejects.toBeInstanceOf(
        RangeError
      )
    }
    expect(
      await db!.artworkDedupSourceIdentity.count({
        where: { providerKey: prefix, externalId: a.kind === 'PROVIDER' ? a.externalId : '' }
      })
    ).toBe(0)
    queries = 0
    const groups = await db!.$transaction((tx) =>
      captureArtworkDedupSourceGroups(tx, { groups: Array.from({ length: 10000 }, () => [a]) })
    )
    expect(queries).toBeLessThanOrEqual(6)
    expect(groups).toHaveLength(10000)
    expect(new Set(groups.flat().map((source) => source.sourceId)).size).toBe(1)
    queries = 0
    await db!.$transaction((tx) => assertArtworkDedupSourceGroups(tx, { groups }))
    expect(queries).toBeLessThanOrEqual(5)
    for (const invalid of [[], Array.from({ length: 10001 }, () => groups[0]!)]) {
      await expect(
        db!.$transaction((tx) => assertArtworkDedupSourceGroups(tx, { groups: invalid }))
      ).rejects.toBeInstanceOf(RangeError)
    }
  })

  it('rejects malformed identities and proofs without coercion', async () => {
    const valid = (await capture([provider()]))[0]!
    const identities = [
      null,
      { ...valid.identity, extra: true },
      { ...path(), canonicalPath: '../unsafe' },
      { ...path(), canonicalPath: '' }
    ]
    for (const identity of identities)
      await expect(capture([identity as ArtworkDedupSourceIdentityInput])).rejects.toBeInstanceOf(TypeError)
    for (const generation of [-1n, 9223372036854775808n, 0, '0']) {
      await expect(assert([{ ...valid, generation: generation as bigint }])).rejects.toBeInstanceOf(RangeError)
    }
    await expect(assert([])).rejects.toBeInstanceOf(RangeError)
    await expect(assert([valid, valid, valid])).rejects.toBeInstanceOf(RangeError)
    await expect(assert([valid, valid])).rejects.toThrow('duplicate source ID')
    await expect(assert([{ ...valid, sourceId: '' }])).rejects.toBeInstanceOf(TypeError)
    await expect(assert([{ ...valid, sourceId: 'a'.repeat(129) }])).rejects.toBeInstanceOf(TypeError)
    await expect(assert([{ ...valid, extra: true } as ArtworkDedupCapturedSource])).rejects.toBeInstanceOf(TypeError)
  })

  it('rejects wrong, swapped, missing and internally inconsistent identity bindings without creating a source', async () => {
    const [a, b] = await capture([provider(), provider()])
    await expect(assert([{ ...a!, sourceId: b!.sourceId }])).rejects.toMatchObject({ code: 'SOURCE_IDENTITY_CHANGED' })
    await expect(
      assert([
        { ...a!, sourceId: b!.sourceId },
        { ...b!, sourceId: a!.sourceId }
      ])
    ).rejects.toMatchObject({ code: 'SOURCE_IDENTITY_CHANGED' })
    const missing = provider()
    await expect(assert([{ ...a!, identity: missing }])).rejects.toMatchObject({ code: 'SOURCE_IDENTITY_CHANGED' })
    expect(
      await db!.artworkDedupSourceIdentity.count({
        where: { providerKey: prefix, externalId: missing.kind === 'PROVIDER' ? missing.externalId : '' }
      })
    ).toBe(0)
    await db!.artworkDedupSourceIdentity.update({ where: { id: a!.sourceId }, data: { externalId: randomUUID() } })
    await expect(assert([a!])).rejects.toMatchObject({ code: 'SOURCE_IDENTITY_CHANGED' })
  })

  it.each(['HOLD', 'TOMBSTONE'])('rejects %s with an owner and rolls back earlier page writes', async (status) => {
    const [a, b] = await capture([provider(), provider()])
    await db!.artworkDedupSourceIdentity.update({
      where: { id: b!.sourceId },
      data: { status, ownerOperationId: randomUUID() }
    })
    await expect(
      db!.$transaction(async (tx) => {
        await tx.artwork.create({ data: { title: prefix } })
        await assertArtworkDedupSourceGroups(tx, { groups: [[a!], [b!]] })
      })
    ).rejects.toMatchObject({ code: 'SOURCE_HELD' })
    expect(await db!.artwork.count({ where: { title: prefix } })).toBe(0)
    await expect(capture([a!.identity, b!.identity])).rejects.toMatchObject({ code: 'SOURCE_HELD' })
    const fresh = provider()
    await expect(capture([fresh, b!.identity])).rejects.toMatchObject({ code: 'SOURCE_HELD' })
    expect(
      await db!.artworkDedupSourceIdentity.count({
        where: { providerKey: prefix, externalId: fresh.kind === 'PROVIDER' ? fresh.externalId : '' }
      })
    ).toBe(0)
  })

  it('rolls back a whole page on one stale or misbound proof, including shared identities with inconsistent proofs', async () => {
    const [a, b] = await capture([provider(), provider()])
    for (const bad of [
      { ...b!, sourceId: randomUUID() },
      { ...b!, generation: b!.generation + 1n }
    ]) {
      await expect(
        db!.$transaction(async (tx) => {
          await tx.artwork.create({ data: { title: prefix } })
          await assertArtworkDedupSourceGroups(tx, { groups: [[a!], [b!], [bad]] })
        })
      ).rejects.toMatchObject({
        code: bad.sourceId !== b!.sourceId ? 'SOURCE_IDENTITY_CHANGED' : 'SOURCE_GENERATION_CHANGED'
      })
      expect(await db!.artwork.count({ where: { title: prefix } })).toBe(0)
    }
    await expect(assert([{ ...a! }, { ...a!, sourceId: randomUUID() }])).rejects.toThrow('Duplicate source identity')
  })

  it('checks both overlap directions and full path segments, and rejects changed roots', async () => {
    const base = randomUUID()
    const [directory] = await capture([path(`${base}/a`, 'DIRECTORY')])
    await db!.artworkDedupSourceIdentity.update({
      where: { id: directory!.sourceId },
      data: { status: 'HOLD', ownerOperationId: randomUUID() }
    })
    await expect(capture([path(`${base}/a/file`), provider()])).rejects.toMatchObject({ code: 'SOURCE_HELD' })
    await expect(capture([path(`${base}/ab/file`)])).resolves.toHaveLength(1)
    const [child] = await capture([path(`${base}/c/file`)])
    await db!.artworkDedupSourceIdentity.update({
      where: { id: child!.sourceId },
      data: { status: 'TOMBSTONE', ownerOperationId: randomUUID() }
    })
    await expect(capture([path(`${base}/c`, 'DIRECTORY')])).rejects.toMatchObject({ code: 'SOURCE_HELD' })
    await expect(
      capture([{ ...path(), rootIdentity: randomUUID() } as ArtworkDedupSourceIdentityInput])
    ).rejects.toMatchObject({ status: 'ROOT_CHANGED' })
    await expect(
      capture([path(), { ...path('other'), rootIdentity: randomUUID() } as ArtworkDedupSourceIdentityInput])
    ).rejects.toMatchObject({ status: 'ROOT_CHANGED' })
  })

  it('preserves empty-root, exact-directory and other-root overlap boundaries', async () => {
    const rollback = new Error('rollback root-overlap fixture')
    await expect(
      db!.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'CREATE TEMP TABLE "ArtworkDedupSourceIdentity" (LIKE public."ArtworkDedupSourceIdentity" INCLUDING ALL) ON COMMIT DROP'
        )
        const archive = path('same/file', 'PATH', 'archive-media:v1')
        const [held] = await captureArtworkDedupSources(tx, { identities: [archive] })
        await tx.$executeRaw(
          Prisma.sql`UPDATE pg_temp."ArtworkDedupSourceIdentity" SET status='TOMBSTONE',"ownerOperationId"=${randomUUID()} WHERE id=${held!.sourceId}`
        )
        await expect(captureArtworkDedupSources(tx, { identities: [path('same/file')] })).resolves.toHaveLength(1)
        // A prior root identity stays held, but does not overlap the current root.
        await tx.$executeRaw(
          Prisma.sql`UPDATE pg_temp."ArtworkDedupSourceIdentity" SET "logicalRoot"='source-media:v1',"rootIdentity"='old-root-fixture' WHERE id=${held!.sourceId}`
        )
        await expect(
          captureArtworkDedupSources(tx, { identities: [path('same/file', 'DIRECTORY')] })
        ).resolves.toHaveLength(1)
        const root: ArtworkDedupSourceIdentityInput = {
          kind: 'DIRECTORY',
          logicalRoot: 'source-media:v1',
          rootIdentity: roots['source-media:v1'],
          canonicalPath: ''
        }
        const [rootProof] = await captureArtworkDedupSources(tx, { identities: [root] })
        await tx.$executeRaw(
          Prisma.sql`UPDATE pg_temp."ArtworkDedupSourceIdentity" SET status='HOLD',"ownerOperationId"=${randomUUID()} WHERE id=${rootProof!.sourceId}`
        )
        await expect(captureArtworkDedupSources(tx, { identities: [path('any/file')] })).rejects.toMatchObject({
          code: 'SOURCE_HELD'
        })
        await expect(captureArtworkDedupSources(tx, { identities: [root] })).rejects.toMatchObject({
          code: 'SOURCE_HELD'
        })
        throw rollback
      })
    ).rejects.toBe(rollback)
    await expect(
      db!.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'CREATE TEMP TABLE "ArtworkDedupSourceIdentity" (LIKE public."ArtworkDedupSourceIdentity" INCLUDING ALL) ON COMMIT DROP'
        )
        const exact = path('directory', 'DIRECTORY')
        const [held] = await captureArtworkDedupSources(tx, { identities: [exact] })
        await tx.$executeRaw(
          Prisma.sql`UPDATE pg_temp."ArtworkDedupSourceIdentity" SET status='TOMBSTONE',"ownerOperationId"=${randomUUID()} WHERE id=${held!.sourceId}`
        )
        await expect(captureArtworkDedupSources(tx, { identities: [exact] })).rejects.toMatchObject({
          code: 'SOURCE_HELD'
        })
        await expect(
          captureArtworkDedupSources(tx, {
            identities: [{ ...exact, canonicalPath: '' } as ArtworkDedupSourceIdentityInput]
          })
        ).rejects.toMatchObject({ code: 'SOURCE_HELD' })
        throw rollback
      })
    ).rejects.toBe(rollback)
  })

  it.each([
    ['PATH', 1000],
    ['PATH', 10000],
    ['DIRECTORY', 1000],
    ['DIRECTORY', 10000]
  ] as const)(
    'checks %s pages of %i independent identities without a root-only input × held-source filter',
    async (kind, inputCount) => {
      const heldCount = 1000
      const rollback = new Error('rollback source-overlap plan fixture')
      await expect(
        db!.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '8s'")
            await tx.$executeRawUnsafe(
              'CREATE TEMP TABLE "ArtworkDedupSourceIdentity" (LIKE public."ArtworkDedupSourceIdentity" INCLUDING ALL) ON COMMIT DROP'
            )
            const held = await captureArtworkDedupSourceGroups(tx, {
              groups: Array.from({ length: heldCount }, (_, index) => [
                path(`held/${index}/file`, index % 2 ? 'DIRECTORY' : 'PATH')
              ])
            })
            expect(held).toHaveLength(heldCount)
            expect(
              await tx.$executeRaw(
                Prisma.sql`UPDATE pg_temp."ArtworkDedupSourceIdentity" SET status='HOLD',"ownerOperationId"=${randomUUID()} WHERE kind='PATH'`
              )
            ).toBe(heldCount / 2)
            expect(
              await tx.$executeRaw(
                Prisma.sql`UPDATE pg_temp."ArtworkDedupSourceIdentity" SET status='TOMBSTONE',"ownerOperationId"=${randomUUID()} WHERE kind='DIRECTORY'`
              )
            ).toBe(heldCount / 2)
            await tx.$executeRawUnsafe('ANALYZE pg_temp."ArtworkDedupSourceIdentity"')
            const page = await captureArtworkDedupSourceGroups(tx, {
              groups: Array.from({ length: inputCount }, (_, index) => [path(`independent/${index}/file`, kind)])
            })
            expect(new Set(page.flat().map((source) => source.sourceId)).size).toBe(inputCount)
            await tx.$executeRawUnsafe('ANALYZE pg_temp."ArtworkDedupSourceIdentity"')
            let overlap: Prisma.Sql | undefined
            const observedTx = new Proxy(tx, {
              get(target, property) {
                if (property === '$queryRaw')
                  return (sql: Prisma.Sql) => {
                    if (sql.sql.includes('WITH source_paths AS MATERIALIZED')) overlap = sql
                    return target.$queryRaw(sql)
                  }
                return Reflect.get(target, property, target)
              }
            })
            queries = 0
            await assertArtworkDedupSourceGroups(observedTx, { groups: page })
            expect(queries).toBeLessThanOrEqual(7)
            expect(overlap).toBeDefined()
            const [result] = await tx.$queryRaw<
              Array<{ 'QUERY PLAN': Array<{ Plan: QueryPlanNode; 'Execution Time': number }> }>
            >(Prisma.sql`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${overlap!}`)
            const plan = result!['QUERY PLAN'][0]!
            const nodes = planNodes(plan.Plan)
            const filtered = nodes.reduce(
              (count, node) =>
                count +
                ((node['Rows Removed by Join Filter'] ?? 0) + (node['Rows Removed by Filter'] ?? 0)) *
                  (node['Actual Loops'] ?? 0),
              0
            )
            const joinRejected = nodes.reduce(
              (count, node) => count + (node['Rows Removed by Join Filter'] ?? 0) * (node['Actual Loops'] ?? 0),
              0
            )
            console.info(
              'source-overlap-plan',
              JSON.stringify({ kind, inputCount, heldCount, filtered, joinRejected, plan })
            )
            // Count work, not wall-clock speed: the prior root-only join rejects N × M candidates here.
            expect(filtered).toBeLessThanOrEqual(8 * (inputCount + heldCount))
            expect(joinRejected).toBe(0)
            if (kind === 'PATH')
              expect(nodes.find((node) => node['Subplan Name'] === 'CTE held_ancestors')?.['Actual Loops']).toBe(0)
            const [remaining] = await tx.$queryRaw<{ count: number }[]>(
              Prisma.sql`SELECT count(*)::integer count FROM pg_temp."ArtworkDedupSourceIdentity" WHERE status IN('HOLD','TOMBSTONE')`
            )
            expect(remaining!.count).toBe(heldCount)
            throw rollback
          },
          { timeout: 15000 }
        )
      ).rejects.toBe(rollback)
    },
    20000
  )

  it('serializes reversed provider pages for concurrent creation and assertion without ABBA', async () => {
    const inputs = Array.from({ length: 40 }, () => [provider(), provider()])
    const [forward, reverse] = await Promise.all([
      db!.$transaction((tx) => captureArtworkDedupSourceGroups(tx, { groups: inputs }), { timeout: 10000 }),
      db!.$transaction(
        (tx) =>
          captureArtworkDedupSourceGroups(tx, { groups: [...inputs].reverse().map((group) => [...group].reverse()) }),
        { timeout: 10000 }
      )
    ])
    expect(forward).toEqual([...reverse].reverse().map((group) => [...group].reverse()))
    await Promise.all([
      db!.$transaction((tx) => assertArtworkDedupSourceGroups(tx, { groups: forward }), { timeout: 10000 }),
      db!.$transaction((tx) => assertArtworkDedupSourceGroups(tx, { groups: reverse }), { timeout: 10000 })
    ])
    await whileHolding(
      (tx) => assertArtworkDedupSourceGroups(tx, { groups: forward }),
      async () => {
        await expect(
          db!.$transaction(async (tx) => {
            await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '100ms'")
            await assertArtworkDedupSourceGroups(tx, { groups: reverse })
          })
        ).rejects.toThrow(/lock timeout/)
      }
    )
  })

  it('acquires every root before any provider source and serializes inverse root/provider batches', async () => {
    const a = provider(),
      s = path(),
      r = path('archive', 'PATH', 'archive-media:v1')
    const proofs = await db!.$transaction((tx) => captureArtworkDedupSourceGroups(tx, { groups: [[a, s], [r]] }))
    const providerProof = proofs[0]![0]!
    await whileHolding(
      async (tx) => {
        await lockContentDirectories(tx, [
          { logicalRoot: 'source-media:v1', rootIdentity: roots['source-media:v1'], relativeDirectory: '' }
        ])
      },
      async () => {
        const started = deferred()
        let pid = 0
        const contender = db!.$transaction(async (tx) => {
          const [backend] = await tx.$queryRaw<{ pid: number }[]>(Prisma.sql`SELECT pg_backend_pid() pid`)
          pid = backend!.pid
          started.resolve()
          await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '2000ms'")
          await assertArtworkDedupSourceGroups(tx, { groups: proofs })
        })
        const outcome = contender.then(
          () => null,
          (error: unknown) => error
        )
        try {
          await started.promise
          const deadline = Date.now() + 1500
          let waiting = false
          while (!waiting && Date.now() < deadline) {
            const [state] = await db!.$queryRaw<{ waiting: boolean }[]>(
              Prisma.sql`SELECT cardinality(pg_blocking_pids(${pid}::integer))>0 waiting`
            )
            waiting = state!.waiting
          }
          expect(waiting).toBe(true)
          // A second session blocked on the root must not already own the provider row.
          await db!.$transaction(async (tx) => {
            await tx.$executeRawUnsafe("SET LOCAL lock_timeout = '200ms'")
            await tx.$queryRaw(
              Prisma.sql`SELECT id FROM "ArtworkDedupSourceIdentity" WHERE id=${providerProof.sourceId} FOR UPDATE`
            )
          })
          expect(await outcome).toMatchObject({ message: expect.stringMatching(/lock timeout/) })
        } finally {
          await outcome
        }
      }
    )
    await Promise.all([
      db!.$transaction((tx) => assertArtworkDedupSourceGroups(tx, { groups: proofs }), { timeout: 10000 }),
      db!.$transaction(
        (tx) => assertArtworkDedupSourceGroups(tx, { groups: [[proofs[1]![0]!], [...proofs[0]!].reverse()] }),
        { timeout: 10000 }
      )
    ])
  })
})
