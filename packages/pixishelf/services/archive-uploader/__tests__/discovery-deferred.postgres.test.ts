import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@pixishelf/db'
import { enqueueArchiveIntakeItemInTransaction } from '@pixishelf/job-executors'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import {
  deferDiscoveryItems,
  downloadDeferredItems,
  ignoreDeferredItems,
  listDeferredItems,
  restoreDeferredItems
} from '../discovery-deferred-service'
import {
  ignoreArchiveUploaderScanItems,
  listArchiveUploaderScanItems,
  restoreArchiveUploaderIgnoredItems
} from '../archive-uploader-service'
import {
  cancelArchiveIntakeMany,
  createArchiveIntakeSubmission,
  retryArchiveIntakeMany
} from '@/services/archive-intake/archive-intake-service'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const suite = databaseUrl ? describe.sequential : describe.skip
const database = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const db = () => database!
const deps = () => ({ database: db() })
const prefix = `deferred-${randomUUID()}`
const externalId = Number.parseInt(randomUUID().replaceAll('-', '').slice(0, 12), 16).toString()
const url = `https://e-hentai.org/g/${externalId}/aabbccdd11/`
const request = () => `${prefix}-${randomUUID()}`

async function seed(name = 'one', gid = externalId) {
  const source = await db().archiveUploaderSource.create({
    data: {
      id: `${prefix}-${name}`,
      providerKey: 'e-hentai',
      identityKind: 'NAME',
      identityValue: `${prefix}-${name}`,
      normalizedIdentity: `${prefix}-${name}`,
      displayName: name
    }
  })
  return db().archiveUploaderCatalogItem.create({
    data: {
      id: `${prefix}-catalog-${name}`,
      sourceId: source.id,
      providerKey: 'e-hentai',
      externalId: gid,
      canonicalUrl: `https://e-hentai.org/g/${gid}/aabbccdd11/`,
      title: `${prefix}-${name}`,
      relationships: {},
      classification: 'NEW',
      firstSeenAt: new Date(),
      lastSeenAt: new Date()
    }
  })
}
async function defer(item: Awaited<ReturnType<typeof seed>>, requestId = request()) {
  const operation = await deferDiscoveryItems(
    { sourceId: item.sourceId, itemIds: [item.id], requestId },
    prefix,
    deps()
  )
  expect(operation?.counts.failed).toBe(0)
  return db().archiveDiscoveryDeferredItem.findUniqueOrThrow({
    where: { providerKey_externalId: { providerKey: item.providerKey, externalId: item.externalId } }
  })
}
async function cancelledUpdate() {
  const item = await seed()
  const artwork = await db().artwork.create({ data: { title: prefix } })
  await db().artworkExternalRef.create({
    data: {
      artworkId: artwork.id,
      providerKey: 'e-hentai',
      externalId,
      canonicalUrl: url,
      locator: { gid: externalId, token: 'aabbccdd11' },
      status: 'SUCCESS'
    }
  })
  await db().archiveUploaderCatalogItem.update({
    where: { id: item.id },
    data: { classification: 'POSSIBLE_UPDATE', lastOutcome: 'ARCHIVED' }
  })
  const submission = await createArchiveIntakeSubmission({ idempotencyKey: request(), urls: [url] }, prefix, deps())
  const intake = await db().archiveIntakeItem.findFirstOrThrow({ where: { submissionId: submission.id } })
  expect(intake.providerKey).toBeNull()
  const cancelled = await cancelArchiveIntakeMany({ idempotencyKey: request(), itemIds: [intake.id] }, prefix, deps())
  expect(cancelled?.counts.applied).toBe(1)
  return { item, intake }
}
async function fillCapacity() {
  const submission = await db().archiveIntakeSubmission.create({
    data: {
      idempotencyKey: request(),
      requestHash: 'a'.repeat(64),
      requestedByUserId: prefix,
      rawCount: 1000,
      acceptedCount: 1000
    }
  })
  await db().archiveIntakeItem.createMany({
    data: Array.from({ length: 1000 }, (_, index) => ({
      submissionId: submission.id,
      submittedUrl: `https://e-hentai.org/g/${1000000 + index}/feed123456/`,
      normalizedUrlHash: String(index)
    }))
  })
  return submission
}
async function cleanup() {
  await db().archiveDiscoveryDeferredItem.deleteMany({ where: { deferredByUserId: prefix } })
  await db().archiveUploaderIgnoredItem.deleteMany({ where: { ignoredByUserId: prefix } })
  await db().archiveUploaderSource.deleteMany({ where: { id: { startsWith: prefix } } })
  await db().archiveBulkOperation.deleteMany({ where: { requestedByUserId: prefix } })
  await db().archiveImport.deleteMany({ where: { id: { startsWith: prefix } } })
  await db().archiveIntakeSubmission.deleteMany({ where: { requestedByUserId: prefix } })
  await db().systemJob.deleteMany({ where: { requestedByUserId: prefix } })
  await db().artwork.deleteMany({ where: { title: prefix } })
}

suite('persistent discovery deferred decisions', () => {
  beforeEach(cleanup)
  afterAll(async () => {
    if (database) {
      await cleanup()
      await database.$disconnect()
    }
  })

  it('shares one decision across sources, scopes by membership, and preserves filter choices on restore', async () => {
    const first = await seed('first')
    const second = await seed('second')
    await seed('unrelated', (BigInt(externalId) + 1n).toString())
    const decision = await defer(first)
    await db().archiveUploaderCatalogItem.update({
      where: { id: second.id },
      data: { matchesQuery: false, reviewDecision: 'EXCLUDE' }
    })
    expect((await listDeferredItems({ sourceId: second.sourceId }, deps())).items.map((item) => item.id)).toEqual([
      decision.id
    ])
    expect((await listDeferredItems({ sourceId: `${prefix}-unrelated` }, deps())).totalCount).toBe(0)
    expect((await listArchiveUploaderScanItems({ sourceId: first.sourceId }, deps())).items).toEqual([])
    expect(await db().archiveIntakeSubmission.count({ where: { requestedByUserId: prefix } })).toBe(0)
    await restoreDeferredItems({ deferredItemIds: [decision.id], requestId: request() }, prefix, deps())
    expect((await listArchiveUploaderScanItems({ sourceId: first.sourceId }, deps())).items).toHaveLength(1)
    expect(await db().archiveUploaderCatalogItem.findUnique({ where: { id: second.id } })).toMatchObject({
      matchesQuery: false,
      reviewDecision: 'EXCLUDE'
    })
  })

  it.each(['ALL', 'FIRST_20'] as const)(
    'downloads %s after source deletion and binds the receipt to the scope',
    async (downloadScope) => {
      const first = await seed('orphan')
      const decision = await defer(first)
      await db().archiveUploaderSource.delete({ where: { id: first.sourceId } })
      const page = await listDeferredItems({}, deps())
      expect(page.items).toContainEqual(expect.objectContaining({ id: decision.id, sourceDeleted: true }))
      expect(JSON.stringify(page)).not.toContain('aabbccdd11')
      const input = { deferredItemIds: [decision.id], requestId: request(), downloadScope }
      const downloaded = await downloadDeferredItems(input, prefix, deps())
      expect(downloaded?.counts.created).toBe(1)
      expect(await db().archiveDiscoveryDeferredItem.findUnique({ where: { id: decision.id } })).toBeNull()
      const intake = await db().archiveIntakeItem.findFirstOrThrow({
        where: { submissionId: downloaded!.items[0]!.relatedId! }
      })
      expect(intake.downloadScope).toBe(downloadScope)
      expect(
        (await db().systemJob.findUniqueOrThrow({ where: { id: intake.currentSystemJobId! } })).definitionVersion
      ).toBe(2)
      const replay = await downloadDeferredItems(input, prefix, deps())
      expect(replay?.id).toBe(downloaded?.id)
      await expect(
        downloadDeferredItems({ ...input, downloadScope: downloadScope === 'ALL' ? 'FIRST_20' : 'ALL' }, prefix, deps())
      ).rejects.toMatchObject({ code: 'STATE_CONFLICT' })
      expect(await db().archiveIntakeItem.count({ where: { submissionId: downloaded!.items[0]!.relatedId! } })).toBe(1)
      await assertDeferredDownloadPlan(intake, downloadScope)
    }
  )

  it('uses one download scope for a batch containing a deleted source and a live source', async () => {
    const first = await seed('orphan')
    const second = await seed('live', (BigInt(externalId) + 1n).toString())
    const decisions = [await defer(first), await defer(second)]
    await db().archiveUploaderSource.delete({ where: { id: first.sourceId } })
    const result = await downloadDeferredItems(
      {
        deferredItemIds: decisions.map(({ id }) => id),
        requestId: request(),
        downloadScope: 'FIRST_20',
        downloadMode: 'MANUAL',
        quality: 'DISPLAY'
      },
      prefix,
      deps()
    )
    expect(result?.counts.created).toBe(2)
    for (const item of result!.items) {
      const intake = await db().archiveIntakeItem.findFirstOrThrow({ where: { submissionId: item.relatedId! } })
      expect(intake).toMatchObject({ downloadScope: 'FIRST_20', downloadMode: 'MANUAL', selectedQuality: 'DISPLAY' })
      await assertDeferredDownloadPlan(intake, 'FIRST_20')
    }
    expect(await db().archiveDiscoveryDeferredItem.count({ where: { deferredByUserId: prefix } })).toBe(0)
  })

  it('makes ignore win and never revives deferred when ignore is restored', async () => {
    const item = await seed()
    const decision = await defer(item)
    await db().archiveUploaderSource.delete({ where: { id: item.sourceId } })
    const ignored = await ignoreDeferredItems({ deferredItemIds: [decision.id], requestId: request() }, prefix, deps())
    expect(ignored?.counts.applied).toBe(1)
    await restoreArchiveUploaderIgnoredItems({ ignoredItemIds: [ignored!.items[0]!.relatedId!] }, deps())
    expect(await db().archiveDiscoveryDeferredItem.count({ where: { deferredByUserId: prefix } })).toBe(0)
  })

  it('normal global ignore removes an existing deferred decision in the same transaction', async () => {
    const item = await seed()
    await defer(item)
    await ignoreArchiveUploaderScanItems({ sourceId: item.sourceId, itemIds: [item.id] }, prefix, deps())
    expect(await db().archiveDiscoveryDeferredItem.count({ where: { deferredByUserId: prefix } })).toBe(0)
  })

  it('only successful fresh direct intake clears the decision; invalid input and replay preserve it', async () => {
    const item = await seed()
    await defer(item)
    await createArchiveIntakeSubmission(
      { idempotencyKey: request(), urls: ['https://127.0.0.1/g/123/private/'] },
      prefix,
      deps()
    )
    expect(await db().archiveDiscoveryDeferredItem.count({ where: { deferredByUserId: prefix } })).toBe(1)
    const input = { idempotencyKey: request(), urls: [url], downloadMode: 'MANUAL' as const }
    const submission = await createArchiveIntakeSubmission(input, prefix, deps())
    expect(submission.acceptedCount).toBe(1)
    expect(await db().archiveDiscoveryDeferredItem.count({ where: { deferredByUserId: prefix } })).toBe(0)
    // A later decision must survive a replay of the earlier accepted URL request.
    const later = await db().archiveDiscoveryDeferredItem.create({
      data: {
        providerKey: 'e-hentai',
        externalId,
        canonicalUrl: url,
        sourceDisplayName: 'Later',
        title: 'Later',
        deferredByUserId: prefix
      }
    })
    await createArchiveIntakeSubmission(input, prefix, deps())
    expect(await db().archiveDiscoveryDeferredItem.findUnique({ where: { id: later.id } })).not.toBeNull()
  })

  it('rejects already enqueued candidates', async () => {
    const item = await seed()
    await createArchiveIntakeSubmission({ idempotencyKey: request(), urls: [url] }, prefix, deps())
    const operation = await deferDiscoveryItems(
      { sourceId: item.sourceId, itemIds: [item.id], requestId: request() },
      prefix,
      deps()
    )
    expect(operation?.counts.conflict).toBe(1)
    expect(await db().archiveDiscoveryDeferredItem.count({ where: { deferredByUserId: prefix } })).toBe(0)
  })

  it('keeps deferred entries when the intake capacity is full', async () => {
    const item = await seed()
    const decision = await defer(item)
    await fillCapacity()
    const result = await downloadDeferredItems({ deferredItemIds: [decision.id], requestId: request() }, prefix, deps())
    expect(result?.counts.conflict).toBe(1)
    expect(await db().archiveDiscoveryDeferredItem.findUnique({ where: { id: decision.id } })).not.toBeNull()
  })

  it('clears a deferred cancelled update on retry, but preserves a later decision on old retry replay', async () => {
    const { item, intake } = await cancelledUpdate()
    const first = await defer(item)
    const retryInput = { idempotencyKey: request(), itemIds: [intake.id] }
    expect((await retryArchiveIntakeMany(retryInput, prefix, deps()))?.counts.applied).toBe(1)
    expect((await db().archiveIntakeItem.findUniqueOrThrow({ where: { id: intake.id } })).status).toBe('QUEUED')
    expect(await db().archiveDiscoveryDeferredItem.findUnique({ where: { id: first.id } })).toBeNull()
    await cancelArchiveIntakeMany({ idempotencyKey: request(), itemIds: [intake.id] }, prefix, deps())
    const later = await defer(item)
    expect((await retryArchiveIntakeMany(retryInput, prefix, deps()))?.counts.applied).toBe(1)
    expect((await db().archiveIntakeItem.findUniqueOrThrow({ where: { id: intake.id } })).status).toBe('CANCELLED')
    expect(await db().archiveDiscoveryDeferredItem.findUnique({ where: { id: later.id } })).not.toBeNull()
  })

  it('preserves deferred updates on capacity rejection and replay of that rejected retry', async () => {
    const { item, intake } = await cancelledUpdate()
    const decision = await defer(item)
    const capacity = await fillCapacity()
    const input = { idempotencyKey: request(), itemIds: [intake.id] }
    const retry = await retryArchiveIntakeMany(input, prefix, deps())
    expect(retry?.items[0]).toMatchObject({ result: 'SKIPPED', code: 'CAPACITY_EXCEEDED' })
    await db().archiveIntakeSubmission.delete({ where: { id: capacity.id } })
    expect((await retryArchiveIntakeMany(input, prefix, deps()))?.items[0]?.code).toBe('CAPACITY_EXCEEDED')
    expect((await db().archiveIntakeItem.findUniqueOrThrow({ where: { id: intake.id } })).status).toBe('CANCELLED')
    expect(await db().archiveDiscoveryDeferredItem.findUnique({ where: { id: decision.id } })).not.toBeNull()
  })

  it('preserves deferred updates when retry source proof validation fails', async () => {
    const { item, intake } = await cancelledUpdate()
    const decision = await defer(item)
    await db().archiveIntakeItem.update({ where: { id: intake.id }, data: { dedupSourceSnapshot: Prisma.JsonNull } })
    const retry = await retryArchiveIntakeMany({ idempotencyKey: request(), itemIds: [intake.id] }, prefix, deps())
    expect(retry?.counts.conflict).toBe(1)
    expect((await db().archiveIntakeItem.findUniqueOrThrow({ where: { id: intake.id } })).status).toBe('CANCELLED')
    expect(await db().archiveDiscoveryDeferredItem.findUnique({ where: { id: decision.id } })).not.toBeNull()
  })

  it('replays old restore by its receipt without removing a newly created decision', async () => {
    const item = await seed()
    const first = await defer(item)
    const restore = { deferredItemIds: [first.id], requestId: request() }
    await restoreDeferredItems(restore, prefix, deps())
    const second = await defer(item)
    expect(second.id).not.toBe(first.id)
    await restoreDeferredItems(restore, prefix, deps())
    expect(await db().archiveDiscoveryDeferredItem.findUnique({ where: { id: second.id } })).not.toBeNull()
  })

  it('uses a stable cursor for same-time decisions without exposing private source URLs', async () => {
    const first = await seed('a')
    const second = await seed('b', (BigInt(externalId) + 1n).toString())
    await defer(first)
    await defer(second)
    await db().archiveDiscoveryDeferredItem.updateMany({
      where: { deferredByUserId: prefix },
      data: { deferredAt: new Date('2026-10-29T00:00:00Z') }
    })
    const firstPage = await listDeferredItems({ limit: 1 }, deps())
    const secondPage = await listDeferredItems({ limit: 1, cursor: firstPage.nextCursor }, deps())
    expect(firstPage.totalCount).toBe(2)
    expect(firstPage.items[0]!.id).not.toBe(secondPage.items[0]!.id)
    expect(secondPage.nextCursor).toBeNull()
  })
})

async function assertDeferredDownloadPlan(
  intake: Prisma.ArchiveIntakeItemGetPayload<object>,
  scope: 'ALL' | 'FIRST_20'
) {
  const gid = new URL(intake.submittedUrl).pathname.split('/')[2]!
  const resolved = {
    providerKey: 'e-hentai',
    externalId: gid,
    canonicalUrl: intake.submittedUrl,
    locator: {},
    title: prefix,
    titleAliases: [],
    description: null,
    category: null,
    uploader: null,
    thumbnailUrl: null,
    postedAt: null,
    tags: [],
    relationships: [],
    normalizedMetadata: { titles: { display: prefix } },
    rawMetadata: {},
    warnings: [],
    creatorBucket: 'integration',
    media: Array.from({ length: 30 }, (_, index) => ({
      index,
      sourcePageUrl: `https://e-hentai.org/s/page/${gid}-${index + 1}`,
      locator: { index },
      expectedFilename: `${index}.jpg`
    }))
  }
  await db().systemJob.update({ where: { id: intake.currentSystemJobId! }, data: { status: 'COMPLETED' } })
  await db().archiveIntakeItem.update({
    where: { id: intake.id },
    data: {
      status: 'READY',
      providerKey: 'e-hentai',
      externalId: gid,
      resolvedSnapshot: resolved,
      metadataHash: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 3_600_000)
    }
  })
  const result = await db().$transaction((tx) =>
    enqueueArchiveIntakeItemInTransaction(tx, intake.id, {
      quality: intake.selectedQuality,
      requestedByUserId: prefix,
      timestamp: new Date(),
      uuid: request,
      defaultTagIds: []
    })
  )
  expect(result.result).toBe('CREATED')
  expect(await db().archiveImport.findUniqueOrThrow({ where: { id: result.relatedId! } })).toMatchObject({
    downloadScope: scope,
    sourceTotalItems: 30,
    totalItems: scope === 'ALL' ? 30 : 20
  })
}
