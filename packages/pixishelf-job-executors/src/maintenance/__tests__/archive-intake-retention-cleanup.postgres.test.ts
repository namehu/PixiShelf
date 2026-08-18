import { randomUUID } from 'node:crypto'
import { Prisma, PrismaClient } from '@pixishelf/db'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanupArchiveIntakeHistory } from '../archive-intake-retention-cleanup.js'
import type { RunMaintenanceMutation } from '../types.js'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const prefix = `archive-intake-retention-${randomUUID()}`
const providerKey = `retention-${randomUUID().slice(0, 8)}`
const oldDate = new Date('2026-06-01T00:00:00.000Z')
const now = new Date('2026-08-18T00:00:00.000Z')
const recentDate = new Date('2026-08-10T00:00:00.000Z')
const futureDate = new Date('2026-08-19T00:00:00.000Z')

describePostgres('archive intake retention PostgreSQL integration', () => {
  beforeEach(cleanupDatabase)

  afterAll(async () => {
    if (!prisma) return
    await cleanupDatabase()
    await prisma.$disconnect()
  })

  it('removes only expired intake history while preserving archive entities and incomplete work', async () => {
    const archive = await seedArchiveGraph()
    const oldTerminalSubmission = await seedSubmission('old-terminal', oldDate)
    await seedIntakeItem(oldTerminalSubmission.id, 'old-terminal', {
      status: 'ENQUEUED',
      finishedAt: oldDate,
      archiveImportId: archive.archiveImportId,
      currentSystemJobId: archive.systemJobId
    })

    const activeSubmission = await seedSubmission('active', oldDate)
    const activeItem = await seedIntakeItem(activeSubmission.id, 'active', {
      status: 'READY',
      // Even malformed historical data with an old finishedAt must be kept when
      // the authoritative status is non-terminal.
      finishedAt: oldDate
    })
    const unfinishedTerminalSubmission = await seedSubmission('unfinished-terminal', oldDate)
    const unfinishedTerminalItem = await seedIntakeItem(unfinishedTerminalSubmission.id, 'unfinished-terminal', {
      status: 'FAILED',
      finishedAt: null
    })
    const recentTerminalSubmission = await seedSubmission('recent-terminal', recentDate)
    const recentTerminalItem = await seedIntakeItem(recentTerminalSubmission.id, 'recent-terminal', {
      status: 'CANCELLED',
      finishedAt: recentDate
    })

    const completedBulk = await seedBulkOperation('completed', oldDate)
    const incompleteBulk = await seedBulkOperation('incomplete', null)
    const expiredPreview = await seedPreview('expired', oldDate)
    const futurePreview = await seedPreview('future', futureDate)
    const archiveBefore = await archiveSnapshot(archive)

    const result = await cleanupArchiveIntakeHistory(cleanupInput())

    expect(result).toMatchObject({
      deletedBulkOperations: 1,
      deletedIntakeItems: 1,
      deletedSubmissions: 1,
      deletedPreviewSessions: 1,
      retentionDays: 30
    })
    await expect(db().archiveBulkOperation.findUnique({ where: { id: completedBulk.id } })).resolves.toBeNull()
    await expect(db().archiveBulkOperation.findUnique({ where: { id: incompleteBulk.id } })).resolves.not.toBeNull()
    await expect(db().archiveIntakeItem.findUnique({ where: { id: activeItem.id } })).resolves.not.toBeNull()
    await expect(
      db().archiveIntakeItem.findUnique({ where: { id: unfinishedTerminalItem.id } })
    ).resolves.not.toBeNull()
    await expect(db().archiveIntakeItem.findUnique({ where: { id: recentTerminalItem.id } })).resolves.not.toBeNull()
    await expect(db().archivePreviewSession.findUnique({ where: { id: expiredPreview.id } })).resolves.toBeNull()
    await expect(db().archivePreviewSession.findUnique({ where: { id: futurePreview.id } })).resolves.not.toBeNull()
    expect(await archiveSnapshot(archive)).toEqual(archiveBefore)
  })

  it('rechecks mutable completion, terminal, emptiness, and expiry predicates inside each delete transaction', async () => {
    const bulk = await seedBulkOperation('racing-bulk', oldDate)
    const itemSubmission = await seedSubmission('racing-item', oldDate)
    const item = await seedIntakeItem(itemSubmission.id, 'racing-item', { status: 'FAILED', finishedAt: oldDate })
    const emptySubmission = await seedSubmission('racing-submission', oldDate)
    const preview = await seedPreview('racing-preview', oldDate)
    let mutation = 0

    const mutate: RunMaintenanceMutation = async (operation) => {
      mutation += 1
      if (mutation === 1) {
        await db().archiveBulkOperation.update({ where: { id: bulk.id }, data: { completedAt: null } })
      } else if (mutation === 2) {
        await db().archiveIntakeItem.update({
          where: { id: item.id },
          data: { status: 'READY', finishedAt: null }
        })
      } else if (mutation === 3) {
        await seedIntakeItem(emptySubmission.id, 'racing-submission-child', { status: 'QUEUED', finishedAt: null })
      } else if (mutation === 4) {
        await db().archivePreviewSession.update({ where: { id: preview.id }, data: { expiresAt: futureDate } })
      }
      return db().$transaction((transaction) => operation(transaction))
    }

    const result = await cleanupArchiveIntakeHistory(cleanupInput(mutate))

    expect(mutation).toBe(4)
    expect(result).toMatchObject({
      deletedBulkOperations: 0,
      deletedIntakeItems: 0,
      deletedSubmissions: 0,
      deletedPreviewSessions: 0
    })
    await expect(db().archiveBulkOperation.findUnique({ where: { id: bulk.id } })).resolves.not.toBeNull()
    await expect(db().archiveIntakeItem.findUnique({ where: { id: item.id } })).resolves.toMatchObject({
      status: 'READY',
      finishedAt: null
    })
    await expect(db().archiveIntakeSubmission.findUnique({ where: { id: emptySubmission.id } })).resolves.not.toBeNull()
    await expect(db().archivePreviewSession.findUnique({ where: { id: preview.id } })).resolves.toMatchObject({
      expiresAt: futureDate
    })
  })
})

function cleanupInput(mutate?: RunMaintenanceMutation) {
  return {
    database: db(),
    mutate:
      mutate ??
      (((operation) => db().$transaction((transaction) => operation(transaction))) satisfies RunMaintenanceMutation),
    signal: new AbortController().signal,
    progress: vi.fn(),
    now
  }
}

async function seedArchiveGraph() {
  const systemJobId = `${prefix}-archive-job`
  const archiveImportId = `${prefix}-archive-import`
  await db().systemJob.create({
    data: {
      id: systemJobId,
      type: 'ARCHIVE_IMPORT',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: 1,
      status: 'COMPLETED',
      triggerSource: 'SYSTEM',
      payload: { archiveImportId },
      queuePriority: 0,
      effectivePriority: 0,
      availableAt: oldDate,
      finishedAt: oldDate,
      progress: 100
    }
  })
  const artwork = await db().artwork.create({
    data: { title: prefix, createdVia: 'URL_ARCHIVE', source: 'URL_ARCHIVE', storagePath: `${prefix}/artwork` }
  })
  const image = await db().image.create({ data: { artworkId: artwork.id, path: `${prefix}/media.jpg` } })
  const externalRef = await db().artworkExternalRef.create({
    data: {
      artworkId: artwork.id,
      providerKey,
      externalId: 'archive-entity',
      canonicalUrl: 'https://example.test/archive-entity',
      locator: {}
    }
  })
  await db().archiveImport.create({
    data: {
      id: archiveImportId,
      systemJobId,
      providerKey,
      externalId: 'archive-entity',
      externalRefId: externalRef.id,
      submittedUrl: 'https://example.test/archive-entity',
      canonicalUrl: 'https://example.test/archive-entity',
      locator: {},
      status: 'COMPLETED',
      normalizedMetadata: {},
      rawMetadata: {},
      metadataHash: 'a'.repeat(64),
      creatorBucket: prefix,
      stagingPath: `.archive-staging/${archiveImportId}`,
      publishedArtworkId: artwork.id,
      finishedAt: oldDate
    }
  })
  const revision = await db().archiveRevision.create({
    data: {
      id: `${prefix}-revision`,
      artworkId: artwork.id,
      externalRefId: externalRef.id,
      archiveImportId,
      archivePath: `sources/test/${prefix}/revision`,
      manifestPath: `sources/test/${prefix}/revision/manifest.json`,
      mediaSnapshot: [{ path: `${prefix}/media.jpg` }],
      metadataHash: 'a'.repeat(64),
      isCurrent: true
    }
  })
  return { systemJobId, archiveImportId, artworkId: artwork.id, imageId: image.id, revisionId: revision.id }
}

async function archiveSnapshot(archive: Awaited<ReturnType<typeof seedArchiveGraph>>) {
  const [jobs, imports, artworks, revisions, images, importRow, revisionRow, imageRow] = await Promise.all([
    db().systemJob.count({ where: { id: archive.systemJobId } }),
    db().archiveImport.count({ where: { id: archive.archiveImportId } }),
    db().artwork.count({ where: { id: archive.artworkId } }),
    db().archiveRevision.count({ where: { id: archive.revisionId } }),
    db().image.count({ where: { id: archive.imageId } }),
    db().archiveImport.findUniqueOrThrow({
      where: { id: archive.archiveImportId },
      select: { systemJobId: true, externalRefId: true, publishedArtworkId: true }
    }),
    db().archiveRevision.findUniqueOrThrow({
      where: { id: archive.revisionId },
      select: { artworkId: true, externalRefId: true, archiveImportId: true }
    }),
    db().image.findUniqueOrThrow({ where: { id: archive.imageId }, select: { artworkId: true, path: true } })
  ])
  return { jobs, imports, artworks, revisions, images, importRow, revisionRow, imageRow }
}

async function seedSubmission(suffix: string, createdAt: Date) {
  return db().archiveIntakeSubmission.create({
    data: {
      id: `${prefix}-submission-${suffix}`,
      idempotencyKey: `${prefix}:submission:${suffix}`,
      requestHash: hash(suffix),
      rawCount: 1,
      acceptedCount: 1,
      createdAt
    }
  })
}

async function seedIntakeItem(
  submissionId: string,
  suffix: string,
  state: {
    status: 'QUEUED' | 'READY' | 'FAILED' | 'ENQUEUED' | 'CANCELLED'
    finishedAt: Date | null
    archiveImportId?: string
    currentSystemJobId?: string
  }
) {
  return db().archiveIntakeItem.create({
    data: {
      id: `${prefix}-item-${suffix}`,
      submissionId,
      submittedUrl: `https://example.test/${suffix}`,
      normalizedUrlHash: hash(`url:${suffix}`),
      status: state.status,
      finishedAt: state.finishedAt,
      createdAt: oldDate,
      ...(state.archiveImportId ? { archiveImportId: state.archiveImportId } : {}),
      ...(state.currentSystemJobId ? { currentSystemJobId: state.currentSystemJobId } : {})
    }
  })
}

async function seedBulkOperation(suffix: string, completedAt: Date | null) {
  return db().archiveBulkOperation.create({
    data: {
      id: `${prefix}-bulk-${suffix}`,
      idempotencyKey: `${prefix}:bulk:${suffix}`,
      requestHash: hash(`bulk:${suffix}`),
      commandType: 'ENQUEUE',
      requestedCount: 2,
      createdCount: completedAt ? 2 : 1,
      createdAt: oldDate,
      completedAt,
      items: {
        create: {
          targetType: 'INTAKE_ITEM',
          targetId: `${prefix}-target-${suffix}`,
          result: 'CREATED'
        }
      }
    }
  })
}

async function seedPreview(suffix: string, expiresAt: Date) {
  return db().archivePreviewSession.create({
    data: {
      id: `${prefix}-preview-${suffix}`,
      providerKey,
      externalId: suffix,
      resolved: {},
      metadataHash: hash(`preview:${suffix}`),
      expiresAt,
      createdAt: oldDate
    }
  })
}

async function cleanupDatabase() {
  if (!prisma) return
  await prisma.archiveBulkOperation.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.archiveIntakeItem.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.archiveIntakeSubmission.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.archivePreviewSession.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.archiveRevision.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.archiveImport.deleteMany({ where: { id: { startsWith: prefix } } })
  await prisma.image.deleteMany({ where: { path: { startsWith: prefix } } })
  await prisma.artwork.deleteMany({ where: { title: prefix } })
  await prisma.systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
}

function hash(value: string) {
  return Buffer.from(value).toString('hex').padEnd(64, '0').slice(0, 64)
}

function db() {
  if (!prisma) throw new Error('QUEUE_KERNEL_TEST_DATABASE_URL is required')
  return prisma
}
