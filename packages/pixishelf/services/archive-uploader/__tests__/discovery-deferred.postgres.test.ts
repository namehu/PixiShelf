import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@pixishelf/db'
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
import { createArchiveIntakeSubmission } from '@/services/archive-intake/archive-intake-service'

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
async function cleanup() {
  await db().archiveDiscoveryDeferredItem.deleteMany({ where: { deferredByUserId: prefix } })
  await db().archiveUploaderIgnoredItem.deleteMany({ where: { ignoredByUserId: prefix } })
  await db().archiveUploaderSource.deleteMany({ where: { id: { startsWith: prefix } } })
  await db().archiveBulkOperation.deleteMany({ where: { requestedByUserId: prefix } })
  await db().archiveIntakeSubmission.deleteMany({ where: { requestedByUserId: prefix } })
  await db().systemJob.deleteMany({ where: { requestedByUserId: prefix } })
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

  it('keeps decisions after source deletion and permits download, ignore and restore by row identity', async () => {
    const first = await seed('orphan')
    const decision = await defer(first)
    await db().archiveUploaderSource.delete({ where: { id: first.sourceId } })
    const page = await listDeferredItems({}, deps())
    expect(page.items).toContainEqual(expect.objectContaining({ id: decision.id, sourceDeleted: true }))
    expect(JSON.stringify(page)).not.toContain('aabbccdd11')
    const downloaded = await downloadDeferredItems(
      { deferredItemIds: [decision.id], requestId: request() },
      prefix,
      deps()
    )
    expect(downloaded?.counts.created).toBe(1)
    expect(await db().archiveDiscoveryDeferredItem.findUnique({ where: { id: decision.id } })).toBeNull()
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
    const result = await downloadDeferredItems({ deferredItemIds: [decision.id], requestId: request() }, prefix, deps())
    expect(result?.counts.conflict).toBe(1)
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
