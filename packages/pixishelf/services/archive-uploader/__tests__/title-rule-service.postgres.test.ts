// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient, Prisma, bindDiscoveryCreators, lockDiscoveryCreators } from '@pixishelf/db'
import { type ArchiveTitleRules, archiveTitleRulePreviewPayloadSchema } from '@pixishelf/job-contracts'
import {
  executeArchiveTitleRulePreview,
  executeArchiveUploaderScan,
  type ArchiveUploaderScanResult
} from '@pixishelf/job-executors'
import { MutableQueueClock, PostgresQueueRepository, type ClaimedJob, type QueueDatabase } from '@pixishelf/job-runtime'
import {
  previewTitleRules,
  getTitleRulePreview,
  listTitleRulePreviewItems,
  applyTitleRules,
  reviewTitleItems,
  getTitleReviewCounts,
  cancelTitleRulePreview,
  previewTitleCreatorCleanup,
  cleanupTitleCreators
} from '../title-rule-service'
import {
  createArchiveTitleSource,
  listArchiveUploaderScanItems,
  addArchiveUploaderScanItems,
  triggerArchiveUploaderScan
} from '../archive-uploader-service'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const suite = url ? describe.sequential : describe.skip
const prefix = `title-rules-${randomUUID()}`
const sources: string[] = []
const artists: number[] = []
const rules: ArchiveTitleRules = {
  version: 1,
  any: [
    { operator: 'CONTAINS', text: '[RAG]' },
    { operator: 'CONTAINS', text: '[r18AnimeGirls/RAG]' }
  ],
  all: [],
  none: []
}
const clock = new MutableQueueClock(new Date())
const repo = () =>
  new PostgresQueueRepository(db! as unknown as QueueDatabase, {
    clock,
    leaseDurationMs: 60_000,
    transactionTimeoutMs: 20_000
  })
const caps = [
  {
    jobType: 'ARCHIVE_TITLE_RULE_PREVIEW' as const,
    executionLane: 'ARCHIVE_RESOLVE' as const,
    definitionVersions: [1, 2]
  }
]
const deps = () => ({ database: db!, sourceKind: 'ALL' as const })
const fence = (job: ClaimedJob) => ({
  jobId: job.id,
  workerId: job.workerId,
  executionToken: job.executionToken,
  attempt: job.attempt
})

async function source(extra: Partial<Parameters<typeof createArchiveTitleSource>[0]> = {}) {
  const value = await createArchiveTitleSource({ displayName: prefix, keyword: randomUUID(), ...extra }, deps())
  sources.push(value.id)
  return value
}
async function candidates(sourceId: string, count: number) {
  const start = BigInt(`0x${randomUUID().replaceAll('-', '').slice(0, 11)}`)
  const rows = Array.from({ length: count }, (_, index) => ({
    id: randomUUID(),
    sourceId,
    providerKey: 'e-hentai',
    externalId: String(start + BigInt(index)),
    canonicalUrl: `https://e-hentai.org/g/${start + BigInt(index)}/fixture123/`,
    title: index % 2 ? '[Other] Ragnarok' : '[RAG] Fixture',
    uploaderName: 'Alice',
    matchTitles: { origin: 'REMOTE', titles: [index % 2 ? '[Other] Ragnarok' : '[RAG] Fixture'] },
    relationships: [],
    classification: 'NEW' as const,
    matchesQuery: true,
    firstSeenAt: new Date(),
    lastSeenAt: new Date()
  }))
  await db!.archiveUploaderCatalogItem.createMany({ data: rows })
  return rows
}
async function preview(sourceId: string, customRules = rules) {
  const current = await db!.archiveUploaderSource.findUniqueOrThrow({ where: { id: sourceId } })
  return {
    sourceId,
    ...(await previewTitleRules(
      { sourceId, rules: customRules, rulesVersion: current.rulesVersion, requestId: randomUUID() },
      prefix,
      db!
    ))
  }
}
async function step(rollback = false) {
  clock.advance(1000)
  const repository = repo()
  const job = await repository.claim(`${prefix}-worker`, 'ARCHIVE_RESOLVE', caps)
  expect(job).not.toBeNull()
  const context = {
    job: job!,
    payload: archiveTitleRulePreviewPayloadSchema.parse(job!.payload),
    signal: new AbortController().signal,
    finalizeInTransaction: (operation: Parameters<typeof repository.withFencedExecutionTransaction>[1]) =>
      repository.withFencedExecutionTransaction(fence(job!), async (scope) => {
        await operation(scope)
        if (rollback) throw new Error('injected commit failure')
      })
  }
  await executeArchiveTitleRulePreview(context as unknown as Parameters<typeof executeArchiveTitleRulePreview>[0], () =>
    clock.now()
  )
  return job!
}
async function finish(input: { sourceId: string; revisionId: string }) {
  for (let batch = 0; batch < 20; batch++) {
    const result = await getTitleRulePreview(input, db!)
    if (result.status !== 'PENDING') return result
    await step()
  }
  throw new Error('preview did not finish in 20 bounded batches')
}
async function cleanup() {
  if (!db) return
  await db.archiveBulkOperation.deleteMany({ where: { requestedByUserId: prefix } })
  await db.archiveUploaderIgnoredItem.deleteMany({ where: { sourceId: { in: sources } } })
  await db.archiveUploaderSource.deleteMany({ where: { id: { in: sources } } })
  const jobs = await db.systemJob.findMany({ where: { requestedByUserId: prefix }, select: { id: true } })
  await db.jobResourceLease.deleteMany({ where: { ownerJobId: { in: jobs.map((job) => job.id) } } })
  await db.archiveIntakeSubmission.deleteMany({ where: { requestedByUserId: prefix } })
  await db.systemJob.deleteMany({ where: { requestedByUserId: prefix } })
  await db.discoveryPendingCreator.deleteMany({ where: { artistId: { in: artists } } })
  await db.discoveryCreatorSuppression.deleteMany({ where: { artistId: { in: artists } } })
  await db.artist.deleteMany({ where: { id: { in: artists } } })
  sources.length = 0
  artists.length = 0
}

suite('title rule preview, review and intake on isolated PostgreSQL', () => {
  beforeEach(async () => {
    await cleanup()
    clock.set(new Date())
  })
  afterAll(async () => {
    await cleanup()
    await db?.$disconnect()
  })

  it('evaluates more than 1,000 candidates in resumable batches and switches every row atomically', async () => {
    const s = await source()
    const rows = await candidates(s.id, 1105)
    await db!.archiveUploaderSource.update({
      where: { id: s.id },
      data: { historyCursor: 'old-v3-cursor', latestSeenExternalId: '99999' }
    })
    await reviewTitleItems(
      { sourceId: s.id, itemIds: [rows[1]!.id], decision: 'INCLUDE', rulesVersion: 1, requestId: randomUUID() },
      prefix,
      db!
    )
    const input = await preview(s.id)
    await step()
    expect(await getTitleRulePreview(input, db!)).toMatchObject({ checkedCount: 250, status: 'PENDING' })
    expect(await db!.archiveUploaderCatalogItem.count({ where: { sourceId: s.id, matchesQuery: true } })).toBe(1105)
    expect(await finish(input)).toMatchObject({
      status: 'READY',
      checkedCount: 1105,
      acceptedCount: 554,
      filteredCount: 551,
      newlyFilteredCount: 551,
      manualCount: 1
    })
    let cursor: string | null = null
    const ids: string[] = []
    do {
      const page = await listTitleRulePreviewItems({ ...input, cursor, limit: 100, view: 'NEWLY_FILTERED' }, db!)
      ids.push(...page.items.map((row) => row.catalogItemId))
      cursor = page.nextCursor
    } while (cursor)
    expect(new Set(ids).size).toBe(551)
    await expect(applyTitleRules(input, db!)).resolves.toEqual({ applied: true, rulesVersion: 2 })
    await expect(applyTitleRules(input, db!)).resolves.toEqual({ applied: true, rulesVersion: 2 })
    expect(await db!.archiveUploaderSource.findUnique({ where: { id: s.id } })).toMatchObject({
      historyCursor: 'old-v3-cursor',
      latestSeenExternalId: '99999',
      rulesVersion: 2
    })
    expect(await getTitleReviewCounts({ sourceId: s.id }, db!)).toEqual({
      accepted: 554,
      filtered: 551,
      unreviewed: 551,
      excluded: 0
    })
    const filtered = await listArchiveUploaderScanItems(
      { sourceId: s.id, matchView: 'FILTERED', view: 'ALL', limit: 100 },
      deps()
    )
    expect(filtered.items).toHaveLength(100)
    expect(filtered.items.every((item) => !item.actionable && item.matchEvaluation?.reason === 'NO_MATCH')).toBe(true)
    expect(await db!.archiveIntakeItem.count({ where: { submission: { requestedByUserId: prefix } } })).toBe(0)
  }, 30_000)

  it('invalidates a preview after either review or candidate change, and keeps other sources independent', async () => {
    const a = await source(),
      b = await source()
    const [item] = await candidates(a.id, 1)
    await db!.archiveUploaderCatalogItem.create({ data: { ...item!, id: randomUUID(), sourceId: b.id } })
    const input = await preview(a.id)
    await finish(input)
    const review = {
      sourceId: a.id,
      itemIds: [item!.id],
      decision: 'EXCLUDE' as const,
      rulesVersion: 1,
      requestId: randomUUID()
    }
    await reviewTitleItems(review, prefix, db!)
    await reviewTitleItems(review, prefix, db!)
    expect(await db!.archiveBulkOperation.count({ where: { idempotencyKey: review.requestId } })).toBe(1)
    expect(await getTitleRulePreview(input, db!)).toMatchObject({ status: 'STALE' })
    await expect(applyTitleRules(input, db!)).rejects.toThrow('过期')
    expect(await db!.archiveUploaderCatalogItem.findFirst({ where: { sourceId: b.id } })).toMatchObject({
      reviewDecision: 'AUTO',
      matchesQuery: true
    })
    const next = await preview(a.id)
    await finish(next)
    await candidates(a.id, 1)
    await expect(applyTitleRules(next, db!)).rejects.toThrow('过期')
    const reset = await reviewTitleItems({ ...review, decision: 'AUTO', requestId: randomUUID() }, prefix, db!)
    expect(reset?.counts.applied).toBe(1)
  })

  it('rolls back a failed batch then resumes after lease recovery without duplicate evaluations', async () => {
    const s = await source()
    await candidates(s.id, 251)
    const input = await preview(s.id)
    await expect(step(true)).rejects.toThrow('injected commit failure')
    expect(await db!.archiveTitleRuleEvaluation.count({ where: { revisionId: input.revisionId } })).toBe(0)
    expect(await getTitleRulePreview(input, db!)).toMatchObject({ checkedCount: 0, status: 'PENDING' })
    clock.advance(61_000)
    expect(await finish(input)).toMatchObject({ checkedCount: 251, status: 'READY' })
  })

  it('rolls back every candidate when application fails after the catalog update', async () => {
    const s = await source()
    await candidates(s.id, 4)
    const input = await preview(s.id)
    await finish(input)
    const failing = db!.$extends({
      query: {
        archiveUploaderSource: {
          update: async () => {
            throw new Error('injected source update failure')
          }
        }
      }
    })
    await expect(applyTitleRules(input, failing as unknown as PrismaClient)).rejects.toThrow(
      'injected source update failure'
    )
    expect(await db!.archiveUploaderCatalogItem.count({ where: { sourceId: s.id, matchesQuery: true } })).toBe(4)
    expect(await getTitleRulePreview(input, db!)).toMatchObject({ status: 'READY' })
    expect((await db!.archiveUploaderSource.findUniqueOrThrow({ where: { id: s.id } })).rulesVersion).toBe(1)
    await applyTitleRules(input, db!)
    expect(await db!.archiveUploaderCatalogItem.count({ where: { sourceId: s.id, matchesQuery: true } })).toBe(2)
  })

  it('serializes a concurrent scan and rule application against the same source', async () => {
    const s = await source()
    await candidates(s.id, 2)
    const input = await preview(s.id)
    await finish(input)
    const [application, scan] = await Promise.allSettled([
      applyTitleRules(input, db!),
      triggerArchiveUploaderScan({ sourceId: s.id, mode: 'LATEST' }, prefix, deps())
    ])
    expect(scan.status).toBe('fulfilled')
    if (scan.status !== 'fulfilled') throw scan.reason
    const run = await db!.archiveUploaderScanRun.findUniqueOrThrow({ where: { id: scan.value.id } })
    const current = await db!.archiveUploaderSource.findUniqueOrThrow({ where: { id: s.id } })
    if (application.status === 'fulfilled') {
      expect(current.rulesVersion).toBe(2)
      expect(run).toMatchObject({ rulesVersion: 2, titleRules: current.titleRules })
    } else {
      expect(application.reason.message).toContain('扫描')
      expect(current.rulesVersion).toBe(1)
      expect(run).toMatchObject({ rulesVersion: 1, titleRules: current.titleRules })
    }
  })

  it('cancels queued previews, rejects application during a scan, and freezes v5 rules', async () => {
    const s = await source()
    await candidates(s.id, 1)
    const cancelled = await preview(s.id)
    await cancelTitleRulePreview(cancelled, db!)
    expect((await getTitleRulePreview(cancelled, db!)).jobStatus).toBe('CANCELLED')
    const input = await preview(s.id)
    await finish(input)
    const run = await triggerArchiveUploaderScan({ sourceId: s.id, mode: 'LATEST' }, prefix, deps())
    expect(await db!.archiveUploaderScanRun.findUnique({ where: { id: run.id } })).toMatchObject({
      rulesVersion: 1,
      titleRules: s.titleRules
    })
    expect(await db!.systemJob.findUnique({ where: { id: run.systemJobId } })).toMatchObject({ definitionVersion: 5 })
    await expect(applyTitleRules(input, db!)).rejects.toThrow('扫描')
  })

  it('previews and applies case-sensitive regex without changing its source, retaining manual decisions and isolating old workers', async () => {
    const s = await source()
    const rows = await candidates(s.id, 4)
    const titles = ['[RAG] Match12', '[rag] Match12', '[RAG] wrong', 'Other']
    for (const [index, row] of rows.entries()) {
      await db!.archiveUploaderCatalogItem.update({
        where: { id: row.id },
        data: { title: titles[index]!, matchTitles: { origin: 'REMOTE', titles: [titles[index]!] } }
      })
    }
    await reviewTitleItems(
      { sourceId: s.id, itemIds: [rows[3]!.id], decision: 'INCLUDE', rulesVersion: 1, requestId: randomUUID() },
      prefix,
      db!
    )
    const regex: ArchiveTitleRules = {
      version: 2,
      any: [{ operator: 'REGEX', text: '^\\[RAG\\]', ignoreCase: false }],
      all: [{ operator: 'REGEX', text: 'Match\\d+$', ignoreCase: false }],
      none: []
    }
    const input = await preview(s.id, regex)
    clock.advance(1000)
    expect(
      await repo().claim(`${prefix}-old-worker`, 'ARCHIVE_RESOLVE', [{ ...caps[0]!, definitionVersions: [1] }])
    ).toBeNull()
    expect(await finish(input)).toMatchObject({
      status: 'READY',
      checkedCount: 4,
      acceptedCount: 2,
      manualCount: 1,
      rules: regex
    })
    await applyTitleRules(input, db!)
    const current = await db!.archiveUploaderSource.findUniqueOrThrow({ where: { id: s.id } })
    expect(current.titleRules).toEqual(regex)
    expect(await db!.archiveUploaderCatalogItem.findUnique({ where: { id: rows[0]!.id } })).toMatchObject({
      matchesQuery: true,
      matchEvaluation: {
        matchRanges: [
          { start: 0, end: 5 },
          { start: 6, end: 13 }
        ]
      }
    })
    expect(await db!.archiveUploaderCatalogItem.findUnique({ where: { id: rows[1]!.id } })).toMatchObject({
      matchesQuery: false
    })
    expect(await db!.archiveUploaderCatalogItem.findUnique({ where: { id: rows[3]!.id } })).toMatchObject({
      matchesQuery: true,
      reviewDecision: 'INCLUDE'
    })
    const run = await triggerArchiveUploaderScan({ sourceId: s.id, mode: 'LATEST' }, prefix, deps())
    expect(await db!.archiveUploaderScanRun.findUnique({ where: { id: run.id } })).toMatchObject({ titleRules: regex })
    expect(
      await repo().claim(`${prefix}-old-worker`, 'ARCHIVE_RESOLVE', [
        { jobType: 'ARCHIVE_SEARCH_SCAN', executionLane: 'ARCHIVE_RESOLVE', definitionVersions: [4] }
      ])
    ).toBeNull()
  })

  it('rejects duplicate resulting rules without merging sources or resetting cursors', async () => {
    const a = await source()
    const b = await source({ keyword: a.titleQuery!.keyword, rules })
    expect(a.id).not.toBe(b.id)
    const input = await preview(a.id)
    await finish(input)
    await expect(applyTitleRules(input, db!)).rejects.toThrow('相同条件')
    expect((await db!.archiveUploaderSource.findUniqueOrThrow({ where: { id: a.id } })).rulesVersion).toBe(1)
  })

  it('uses historical evidence, filters missing titles, and prevents uploader and global-ignore bypass', async () => {
    const s = await source({ uploaderName: 'Alice' })
    const rows = await candidates(s.id, 3)
    await db!.archiveUploaderCatalogItem.update({
      where: { id: rows[0]!.id },
      data: { matchTitles: Prisma.DbNull, comparisonSnapshot: { titles: { display: '[RAG] Historical', aliases: [] } } }
    })
    await db!.archiveUploaderCatalogItem.update({ where: { id: rows[1]!.id }, data: { matchTitles: Prisma.DbNull } })
    await db!.archiveUploaderCatalogItem.update({ where: { id: rows[2]!.id }, data: { uploaderName: 'Bob' } })
    const input = await preview(s.id)
    await finish(input)
    await applyTitleRules(input, db!)
    const page = await listTitleRulePreviewItems(input, db!)
    expect(page.items.find((row) => row.catalogItemId === rows[0]!.id)?.evaluation.evidence.origin).toBe('HISTORICAL')
    expect(page.items.find((row) => row.catalogItemId === rows[1]!.id)?.evaluation.reason).toBe('MISSING_TITLE')
    const result = await reviewTitleItems(
      { sourceId: s.id, itemIds: [rows[2]!.id], decision: 'INCLUDE', rulesVersion: 2, requestId: randomUUID() },
      prefix,
      db!
    )
    expect(result?.counts.conflict).toBe(1)
    await db!.archiveUploaderIgnoredItem.create({
      data: {
        sourceId: s.id,
        sourceDisplayName: prefix,
        providerKey: 'e-hentai',
        externalId: rows[0]!.externalId,
        title: rows[0]!.title
      }
    })
    await expect(
      addArchiveUploaderScanItems(
        { sourceId: s.id, itemIds: [rows[0]!.id], submissionAttemptId: randomUUID() },
        prefix,
        deps()
      )
    ).rejects.toThrow('忽略')
  })

  it('binds current fixed creators only on actual intake, preserving idempotency and cleanup suppression', async () => {
    const s = await source({ rules })
    const [item, filtered] = await candidates(s.id, 2)
    const artist = await db!.artist.create({ data: { name: prefix } })
    artists.push(artist.id)
    await db!.discoverySourceCreator.create({ data: { sourceId: s.id, artistId: artist.id } })
    await reviewTitleItems(
      { sourceId: s.id, itemIds: [filtered!.id], decision: 'EXCLUDE', rulesVersion: 1, requestId: randomUUID() },
      prefix,
      db!
    )
    expect(await db!.discoveryPendingCreator.count({ where: { artistId: artist.id } })).toBe(0)
    const request = {
      sourceId: s.id,
      itemIds: [item!.id],
      submissionAttemptId: randomUUID(),
      downloadMode: 'MANUAL' as const
    }
    await addArchiveUploaderScanItems(request, prefix, deps())
    await addArchiveUploaderScanItems(request, prefix, deps())
    expect(await db!.discoveryPendingCreator.count({ where: { artistId: artist.id } })).toBe(1)
    await db!.$transaction(async (tx) => {
      await lockDiscoveryCreators(tx, filtered!)
      await bindDiscoveryCreators(
        tx,
        { providerKey: filtered!.providerKey, externalId: filtered!.externalId },
        [artist.id],
        { automatic: true, title: filtered!.title }
      )
    })
    const cleanupPreview = await previewTitleCreatorCleanup({ sourceId: s.id }, db!)
    expect(cleanupPreview.items).toHaveLength(1)
    const pendingId = cleanupPreview.items[0]!.id
    const cleanupInput = { sourceId: s.id, pendingIds: [pendingId], rulesVersion: 1, requestId: randomUUID() }
    await reviewTitleItems(
      { sourceId: s.id, itemIds: [filtered!.id], decision: 'INCLUDE', rulesVersion: 1, requestId: randomUUID() },
      prefix,
      db!
    )
    const staleCleanup = await cleanupTitleCreators({ ...cleanupInput, requestId: randomUUID() }, prefix, db!)
    expect(staleCleanup?.counts.conflict).toBe(1)
    expect(await db!.discoveryPendingCreator.count({ where: { id: pendingId } })).toBe(1)
    await reviewTitleItems(
      { sourceId: s.id, itemIds: [filtered!.id], decision: 'EXCLUDE', rulesVersion: 1, requestId: randomUUID() },
      prefix,
      db!
    )
    await cleanupTitleCreators(cleanupInput, prefix, db!)
    await cleanupTitleCreators(cleanupInput, prefix, db!)
    expect(await db!.discoveryPendingCreator.count({ where: { artistId: artist.id } })).toBe(1)
    expect(
      await db!.discoveryCreatorSuppression.count({ where: { artistId: artist.id, externalId: filtered!.externalId } })
    ).toBe(1)
    await reviewTitleItems(
      { sourceId: s.id, itemIds: [filtered!.id], decision: 'INCLUDE', rulesVersion: 1, requestId: randomUUID() },
      prefix,
      db!
    )
    await addArchiveUploaderScanItems(
      { ...request, itemIds: [filtered!.id], submissionAttemptId: randomUUID() },
      prefix,
      deps()
    )
    expect(await db!.discoveryPendingCreator.count({ where: { artistId: artist.id } })).toBe(1)
  })

  it('does not bind a title source creator when the intake capacity rejects the submission', async () => {
    const s = await source({ rules })
    const [item] = await candidates(s.id, 1)
    const artist = await db!.artist.create({ data: { name: prefix } })
    artists.push(artist.id)
    await db!.discoverySourceCreator.create({ data: { sourceId: s.id, artistId: artist.id } })
    await db!.archiveIntakeSubmission.create({
      data: {
        idempotencyKey: `${prefix}-capacity`,
        requestHash: '1'.repeat(64),
        requestedByUserId: prefix,
        rawCount: 1000,
        acceptedCount: 1000,
        items: {
          createMany: {
            data: Array.from({ length: 1000 }, (_, index) => ({
              submittedUrl: `https://e-hentai.org/g/capacity-${index}/fixture/`,
              normalizedUrlHash: index.toString(16).padStart(64, '0'),
              status: 'QUEUED' as const
            }))
          }
        }
      }
    })
    const result = await addArchiveUploaderScanItems(
      { sourceId: s.id, itemIds: [item!.id], submissionAttemptId: randomUUID(), downloadMode: 'MANUAL' },
      prefix,
      deps()
    )
    expect(result).toMatchObject({ acceptedCount: 0, rejectedCount: 1 })
    expect(await db!.discoveryPendingCreator.count({ where: { artistId: artist.id } })).toBe(0)
  })

  it.each([4, 5])(
    'scans v%s with raw title evidence, preserves manual decisions, binds no creators and advances a zero-match cursor',
    async (version) => {
      const scanRules: ArchiveTitleRules =
        version === 5
          ? { ...rules, version: 2, any: [{ operator: 'REGEX', text: '^\\[RAG\\]', ignoreCase: false }] }
          : rules
      const s = await source({ rules: scanRules })
      const [item] = await candidates(s.id, 1)
      const artist = await db!.artist.create({ data: { name: prefix } })
      artists.push(artist.id)
      await db!.discoverySourceCreator.create({ data: { sourceId: s.id, artistId: artist.id } })
      await reviewTitleItems(
        { sourceId: s.id, itemIds: [item!.id], decision: 'INCLUDE', rulesVersion: 1, requestId: randomUUID() },
        prefix,
        db!
      )
      const run = await triggerArchiveUploaderScan({ sourceId: s.id, mode: 'LATEST' }, prefix, deps())
      if (version === 4) await db!.systemJob.update({ where: { id: run.systemJobId }, data: { definitionVersion: 4 } })
      const repository = repo()
      clock.advance(1000)
      const job = (await repository.claim(`${prefix}-worker`, 'ARCHIVE_RESOLVE', [
        { jobType: 'ARCHIVE_SEARCH_SCAN', executionLane: 'ARCHIVE_RESOLVE', definitionVersions: [version] }
      ]))!
      expect(job.id).toBe(run.systemJobId)
      const result: ArchiveUploaderScanResult = {
        items: [
          {
            ...item!,
            title: '[Other] Ragnarok',
            matchesQuery: true,
            matchTitles: {
              origin: 'REMOTE',
              titles: [version === 5 ? '[rag] lower case' : '[Other] Ragnarok', '別のタイトル']
            },
            thumbnailUrl: null,
            postedAt: null,
            metadataFingerprint: 'fixture',
            normalizedMetadata: {},
            comparisonSnapshot: {
              schemaVersion: 1,
              titles: { display: '[Other] Ragnarok', aliases: [] },
              category: null,
              uploader: 'Alice',
              postedAt: null,
              fileCount: 1,
              fileSize: null,
              expunged: false,
              tags: [],
              relationships: []
            },
            relationships: []
          }
        ],
        nextCursor: 'next-fixture-cursor',
        reachedStop: false,
        discoveredUploaderUid: null
      }
      const context = {
        job,
        payload: { scanRunId: run.id },
        signal: new AbortController().signal,
        progress: async () => {},
        mutateInTransaction: (operation: Parameters<typeof repository.withFencedMutationTransaction>[1]) =>
          repository.withFencedMutationTransaction(fence(job), operation),
        finalizeInTransaction: (operation: Parameters<typeof repository.withFencedExecutionTransaction>[1]) =>
          repository.withFencedExecutionTransaction(fence(job), operation)
      }
      await executeArchiveUploaderScan(
        context as unknown as Parameters<typeof executeArchiveUploaderScan>[0],
        { database: db!, providers: { getUploaderScanner: () => ({ scanTitles: async () => result }) } as never },
        'TITLE_QUERY'
      )
      expect(await db!.archiveUploaderScanRun.findUnique({ where: { id: run.id } })).toMatchObject({
        checkedCount: 1,
        matchedCount: 0,
        status: 'COMPLETED'
      })
      expect(await db!.archiveUploaderSource.findUnique({ where: { id: s.id } })).toMatchObject({
        historyCursor: 'next-fixture-cursor',
        latestSeenExternalId: item!.externalId
      })
      expect(await db!.archiveUploaderCatalogItem.findUnique({ where: { id: item!.id } })).toMatchObject({
        ruleMatches: false,
        matchesQuery: true,
        reviewDecision: 'INCLUDE',
        matchTitles: result.items[0]!.matchTitles
      })
      expect(await db!.discoveryPendingCreator.count({ where: { artistId: artist.id } })).toBe(0)
    }
  )
})
