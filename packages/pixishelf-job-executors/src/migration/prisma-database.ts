import { createHash } from 'node:crypto'
import path from 'node:path'
import { Prisma, type PrismaClient } from '@pixishelf/db'
import type { QueueSqlExecutor } from '@pixishelf/job-runtime'
import { buildCanonicalTargetDirectory, normalizeStoredRelativePath } from './paths.ts'
import { migrationPublicErrorCode, migrationPublicSummary } from './diagnostics.ts'
import type {
  CreateMigrationPlanInput,
  MigrationArtworkPlan,
  MigrationDatabasePort,
  MigrationFileCheckpoint,
  MigrationPublishFile,
  MigrationQueryFilters,
  MigrationSelection,
  MigrationSelectionPageInput,
  MigrationSelectionPort
} from './types.ts'
import { MigrationActionRequiredError } from './types.ts'

type MigrationPrismaTransaction = Prisma.TransactionClient & QueueSqlExecutor
type MigrationPrismaDatabase = Pick<
  PrismaClient,
  'artwork' | 'image' | 'migrationJobItem' | 'migrationFileEntry' | '$queryRaw'
>

interface MigrationPublicationInput {
  itemId: string
  artworkId: number
  targetDirectory: string
  plannedImageIds: number[]
  attempt: number
  files: MigrationPublishFile[]
  terminalStatus?: 'SKIPPED'
}

const publicationArtworkSelect = {
  artistId: true,
  deletedAt: true,
  externalId: true,
  metaSource: true,
  storagePath: true,
  artist: { select: { userId: true } },
  images: {
    select: { id: true, path: true, chaptersPath: true },
    orderBy: { id: 'asc' as const }
  }
} satisfies Prisma.ArtworkSelect

type PublicationArtwork = Prisma.ArtworkGetPayload<{ select: typeof publicationArtworkSelect }>

interface PublicationState {
  currentMetaSource: string | null
  targetMetaSource: string | null
  currentStoragePath: string | null
  targetStoragePath: string | null
  images: Array<{
    id: number
    fileId: string
    currentPath: string
    targetPath: string
    currentChaptersPath: string | null
    targetChaptersPath: string | null
  }>
}

const itemWithFiles = { files: { orderBy: { ordinal: 'asc' as const } } } as const

export function createPrismaMigrationDatabase(
  database: MigrationPrismaDatabase,
  options: { selection?: MigrationSelectionPort } = {}
): MigrationDatabasePort<MigrationPrismaTransaction> {
  const selection = options.selection ?? createPrismaMigrationSelectionPort(database)
  return {
    selection,
    async loadArtwork(artworkId, imageLimit) {
      const artwork = await database.artwork.findUnique({
        where: { id: artworkId },
        select: {
          id: true,
          deletedAt: true,
          externalId: true,
          metaSource: true,
          storagePath: true,
          artist: { select: { userId: true } },
          images: {
            select: { id: true, path: true, chaptersPath: true },
            orderBy: { id: 'asc' },
            take: imageLimit
          }
        }
      })
      if (!artwork) return null
      return {
        id: artwork.id,
        deletedAt: artwork.deletedAt,
        externalId: artwork.externalId,
        artistUserId: artwork.artist?.userId ?? null,
        metaSource: artwork.metaSource,
        storagePath: artwork.storagePath,
        images: artwork.images
      }
    },
    async loadPlan(systemJobId, artworkId, fileLimit) {
      const item = await database.migrationJobItem.findUnique({
        where: { systemJobId_artworkIdSnapshot: { systemJobId, artworkIdSnapshot: artworkId } },
        include: { files: { orderBy: { ordinal: 'asc' }, take: fileLimit } }
      })
      return item ? mapPlan(item) : null
    },
    async recordUnplannableItem(transaction, input) {
      const client = prismaTransaction(transaction)
      const now = new Date()
      const item = await client.migrationJobItem.upsert({
        where: {
          systemJobId_artworkIdSnapshot: {
            systemJobId: input.systemJobId,
            artworkIdSnapshot: input.artworkId
          }
        },
        create: {
          systemJobId: input.systemJobId,
          artworkIdSnapshot: input.artworkId,
          selectionOrdinal: input.selectionOrdinal,
          status: input.status,
          phase: 'DISCOVERING',
          attempt: input.attempt,
          errorCode: sanitizeCode(input.errorCode),
          errorSummary: sanitizeSummary(input.errorCode),
          finishedAt: input.status === 'ACTION_REQUIRED' ? null : now
        },
        update: {
          status: input.status,
          phase: 'DISCOVERING',
          attempt: input.attempt,
          errorCode: sanitizeCode(input.errorCode),
          errorSummary: sanitizeSummary(input.errorCode),
          finishedAt: input.status === 'ACTION_REQUIRED' ? null : now
        },
        include: itemWithFiles
      })
      return mapPlan(item)
    },
    async createOrLoadPlan(transaction, input) {
      const client = prismaTransaction(transaction)
      let item
      try {
        item = await client.migrationJobItem.create({
          data: {
            systemJobId: input.systemJobId,
            artworkIdSnapshot: input.artworkId,
            selectionOrdinal: input.selectionOrdinal,
            status: 'PENDING',
            phase: 'DISCOVERING',
            attempt: input.attempt,
            sourceDirectory: input.sourceDirectory,
            targetDirectory: input.targetDirectory,
            files: {
              create: input.files.map((file) => ({
                ordinal: file.ordinal,
                imageId: file.imageId,
                // Preserve the exact database values for path CAS. mapPlan derives separate
                // canonical relative paths for filesystem access.
                sourceRelativePath: file.sourceStoredPath,
                targetRelativePath: file.targetStoredPath,
                stagedRelativePath: file.stagedRelativePath,
                status: 'PENDING' as const,
                attempt: input.attempt
              }))
            }
          },
          include: itemWithFiles
        })
      } catch (error) {
        if (!isUniqueConflict(error)) throw error
        item = await client.migrationJobItem.findUnique({
          where: {
            systemJobId_artworkIdSnapshot: {
              systemJobId: input.systemJobId,
              artworkIdSnapshot: input.artworkId
            }
          },
          include: { files: { orderBy: { ordinal: 'asc' }, take: input.files.length + 1 } }
        })
        if (!item) throw error
      }
      const plan = mapPlan(item)
      assertStoredPlanMatches(plan, input)
      return plan
    },
    async checkpointItem(transaction, input) {
      const client = prismaTransaction(transaction)
      const current = await client.migrationJobItem.findUnique({
        where: { id: input.itemId },
        select: { startedAt: true }
      })
      if (!current) throw new Error(`Migration item ${input.itemId} no longer exists`)
      const terminal = ['COMPLETED', 'SKIPPED', 'FAILED', 'CANCELLED'].includes(input.status)
      await client.migrationJobItem.update({
        where: { id: input.itemId },
        data: {
          status: input.status,
          phase: input.phase,
          attempt: input.attempt,
          ...(input.errorCode !== undefined ? { errorCode: sanitizeOptionalCode(input.errorCode) } : {}),
          ...(input.errorSummary !== undefined
            ? { errorSummary: sanitizeOptionalSummary(input.errorCode, input.errorSummary) }
            : {}),
          ...(input.status === 'RUNNING' ? { startedAt: current.startedAt ?? new Date(), finishedAt: null } : {}),
          ...(terminal ? { finishedAt: new Date() } : {})
        }
      })
    },
    async checkpointFile(transaction, input) {
      const client = prismaTransaction(transaction)
      await client.migrationFileEntry.update({
        where: { id: input.fileId },
        data: fileCheckpointData(input)
      })
    },
    async closeItemAndFiles(transaction, input) {
      const client = prismaTransaction(transaction)
      const errorCode = sanitizeCode(input.errorCode)
      const errorSummary = sanitizeSummary(input.errorCode)
      await client.migrationFileEntry.updateMany({
        where: { itemId: input.itemId, status: { not: 'COMPLETED' } },
        data: { status: 'FAILED', attempt: input.attempt, errorCode, errorSummary }
      })
      await client.migrationJobItem.update({
        where: { id: input.itemId },
        data: {
          status: input.status,
          phase: input.phase,
          attempt: input.attempt,
          errorCode,
          errorSummary,
          finishedAt: new Date()
        }
      })
    },
    async publishArtwork(transaction, input) {
      const client = prismaTransaction(transaction)
      const [currentItem, persistedFiles, currentArtwork] = await Promise.all([
        client.migrationJobItem.findUnique({
          where: { id: input.itemId },
          select: { artworkIdSnapshot: true }
        }),
        client.migrationFileEntry.findMany({
          where: { itemId: input.itemId },
          orderBy: { ordinal: 'asc' },
          select: { id: true, imageId: true, sourceRelativePath: true, targetRelativePath: true }
        }),
        loadPublicationArtwork(client, input.artworkId, input.plannedImageIds.length + 1)
      ])
      if (currentItem?.artworkIdSnapshot !== input.artworkId) publicationConflict('Migration item ownership changed')
      assertPublicationFileCollection(persistedFiles, input.files)
      const publication = assertPublicationSnapshot(currentArtwork, input)

      for (const image of publication.images) {
        const updated = await client.image.updateMany({
          where: {
            id: image.id,
            artworkId: input.artworkId,
            path: image.currentPath,
            chaptersPath: image.currentChaptersPath
          },
          data: { path: image.targetPath, chaptersPath: image.targetChaptersPath }
        })
        if (updated.count !== 1) {
          publicationConflict('Image ownership or referenced path changed before migration publication', image.fileId)
        }
      }
      const artworkUpdated = await client.artwork.updateMany({
        where: {
          id: input.artworkId,
          deletedAt: null,
          externalId: currentArtwork!.externalId,
          artistId: currentArtwork!.artistId,
          metaSource: publication.currentMetaSource,
          storagePath: publication.currentStoragePath
        },
        data: { metaSource: publication.targetMetaSource, storagePath: publication.targetStoragePath }
      })
      if (artworkUpdated.count !== 1) publicationConflict('Artwork references changed before migration publication')

      const finalArtwork = await loadPublicationArtwork(client, input.artworkId, input.plannedImageIds.length + 1)
      assertPublishedSnapshot(finalArtwork, input, publication)

      const now = new Date()
      for (const file of input.files) {
        const fileUpdated = await client.migrationFileEntry.updateMany({
          where: { id: file.fileId, itemId: input.itemId },
          data:
            input.terminalStatus === 'SKIPPED'
              ? { status: 'COMPLETED', publishedAt: now, cleanedAt: now, errorCode: null, errorSummary: null }
              : { status: 'SOURCE_CLEANUP_PENDING', publishedAt: now, errorCode: null, errorSummary: null }
        })
        if (fileUpdated.count !== 1) publicationConflict('Migration file ownership changed', file.fileId)
      }
      const aggregateFingerprint = createHash('sha256')
        .update(
          [...input.files]
            .sort((left, right) => left.fileId.localeCompare(right.fileId))
            .map((file) => `${file.fileId}:${file.sourceSha256 ?? 'UNCHANGED'}`)
            .join('|')
        )
        .digest('hex')
      const itemUpdated = await client.migrationJobItem.updateMany({
        where: { id: input.itemId, artworkIdSnapshot: input.artworkId },
        data: {
          status: input.terminalStatus === 'SKIPPED' ? 'SKIPPED' : 'RUNNING',
          phase: input.terminalStatus === 'SKIPPED' ? 'FINALIZING' : 'CLEANING_SOURCE',
          attempt: input.attempt,
          sourceFingerprint: aggregateFingerprint,
          targetFingerprint: aggregateFingerprint,
          errorCode: null,
          errorSummary: null,
          ...(input.terminalStatus === 'SKIPPED' ? { finishedAt: now } : { finishedAt: null })
        }
      })
      if (itemUpdated.count !== 1) publicationConflict('Migration item ownership changed')
    },
    async summarize(systemJobId, sampleLimit) {
      const [total, groups, samples] = await Promise.all([
        database.migrationJobItem.count({ where: { systemJobId } }),
        database.migrationJobItem.groupBy({ by: ['status'], where: { systemJobId }, _count: { _all: true } }),
        database.migrationJobItem.findMany({
          where: { systemJobId, status: { in: ['FAILED', 'ACTION_REQUIRED'] } },
          orderBy: [{ artworkIdSnapshot: 'asc' }, { id: 'asc' }],
          take: sampleLimit,
          select: { artworkIdSnapshot: true, errorCode: true, errorSummary: true }
        })
      ])
      const counts = new Map(groups.map((group) => [group.status, group._count._all]))
      const completed = counts.get('COMPLETED') ?? 0
      const skipped = counts.get('SKIPPED') ?? 0
      const failed = counts.get('FAILED') ?? 0
      const actionRequired = counts.get('ACTION_REQUIRED') ?? 0
      const cancelled = counts.get('CANCELLED') ?? 0
      return {
        total,
        processed: completed + skipped + failed + actionRequired + cancelled,
        completed,
        skipped,
        failed,
        actionRequired,
        cancelled,
        failedSamples: samples.map((sample) => ({
          artworkId: sample.artworkIdSnapshot,
          externalId: null,
          code: sanitizeCode(sample.errorCode),
          message: sanitizeSummary(sample.errorCode)
        }))
      }
    }
  }
}

export function createPrismaMigrationSelectionPort(database: MigrationPrismaDatabase): MigrationSelectionPort {
  return {
    async count(selection) {
      if (selection.mode === 'FAILED_FROM_JOB') return countFailedSelection(database, selection.sourceJobId)
      return database.artwork.count({ where: buildMigrationArtworkWhere(selection, 0) })
    },
    async precheck(selection) {
      if (selection.mode === 'FAILED_FROM_JOB') return precheckFailedSelection(database, selection.sourceJobId)
      const base = buildMigrationArtworkWhere(selection, 0)
      const [total, eligible, missingArtist, missingExternalId, missingImages] = await Promise.all([
        database.artwork.count({ where: base }),
        database.artwork.count({
          where: {
            AND: [base, { artist: { is: { userId: { not: null } } }, externalId: { not: null }, images: { some: {} } }]
          }
        }),
        database.artwork.count({
          where: { AND: [base, { OR: [{ artist: { is: null } }, { artist: { is: { userId: null } } }] }] }
        }),
        database.artwork.count({ where: { AND: [base, { externalId: null }] } }),
        database.artwork.count({ where: { AND: [base, { images: { none: {} } }] } })
      ])
      return { total, eligible, missingArtist, missingExternalId, missingImages }
    },
    async selectPage(input) {
      if (input.selection.mode === 'FAILED_FROM_JOB') return selectFailedPage(database, input)
      return database.artwork.findMany({
        where: buildMigrationArtworkWhere(input.selection, input.afterArtworkId),
        orderBy: { id: 'asc' },
        take: input.take,
        select: { id: true, deletedAt: true }
      })
    }
  }
}

/** Exported so precheck can use the same canonical filter interpretation instead of rebuilding it. */
export function buildMigrationArtworkWhere(
  selection: Exclude<MigrationSelection, { mode: 'FAILED_FROM_JOB' }>,
  afterArtworkId: number
): Prisma.ArtworkWhereInput {
  const id: Prisma.IntFilter = { gt: afterArtworkId }
  if (selection.mode === 'ARTWORK_IDS') id.in = selection.artworkIds
  if (selection.mode === 'QUERY') {
    id.lte = selection.upperArtworkId
    if (selection.filters.id !== undefined) id.equals = selection.filters.id
  }
  const where: Prisma.ArtworkWhereInput = { deletedAt: null, id }
  if (selection.mode === 'QUERY') Object.assign(where, migrationFilterWhere(selection.filters))
  return where
}

function migrationFilterWhere(filters: MigrationQueryFilters): Prisma.ArtworkWhereInput {
  const where: Prisma.ArtworkWhereInput = {}
  if (filters.externalId !== undefined) where.externalId = filters.externalId
  if (filters.artistName !== undefined) {
    const name = filters.exactMatch
      ? filters.artistName
      : { contains: filters.artistName, mode: 'insensitive' as const }
    where.artist = { is: { OR: [{ name }, { userId: name }] } }
  }
  if (filters.search !== undefined) {
    if (filters.exactMatch) {
      where.OR = [
        { title: filters.search },
        { description: filters.search },
        { artist: { is: { OR: [{ name: filters.search }, { userId: filters.search }] } } }
      ]
    } else {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { artist: { is: { name: { contains: filters.search, mode: 'insensitive' } } } },
        { artist: { is: { userId: { contains: filters.search, mode: 'insensitive' } } } }
      ]
    }
  }
  if (filters.mediaTypes.length > 0) {
    where.images = {
      some: { OR: filters.mediaTypes.map((extension) => ({ path: { endsWith: extension, mode: 'insensitive' } })) }
    }
  }
  if (filters.startDate !== undefined || filters.endDate !== undefined) {
    where.sourceDate = {
      ...(filters.startDate !== undefined ? { gte: new Date(`${filters.startDate}T00:00:00.000Z`) } : {}),
      ...(filters.endDate !== undefined ? { lt: nextUtcDay(filters.endDate) } : {})
    }
  }
  return where
}

async function countFailedSelection(database: MigrationPrismaDatabase, sourceJobId: string) {
  const predicate = failedSelectionPredicate(sourceJobId)
  const rows = await database.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS "count"
    FROM "Artwork" AS artwork
    INNER JOIN "migration_job_items" AS source_item
      ON source_item."artworkIdSnapshot" = artwork.id
    WHERE ${predicate}
  `)
  return Number(rows[0]?.count ?? 0n)
}

async function selectFailedPage(database: MigrationPrismaDatabase, input: MigrationSelectionPageInput) {
  if (input.selection.mode !== 'FAILED_FROM_JOB') throw new Error('Expected FAILED_FROM_JOB selection')
  const predicate = failedSelectionPredicate(input.selection.sourceJobId, input.afterArtworkId)
  return database.$queryRaw<Array<{ id: number; deletedAt: Date | null }>>(Prisma.sql`
    SELECT artwork.id, artwork."deletedAt"
    FROM "Artwork" AS artwork
    INNER JOIN "migration_job_items" AS source_item
      ON source_item."artworkIdSnapshot" = artwork.id
    WHERE ${predicate}
    ORDER BY artwork.id ASC
    LIMIT ${input.take}
  `)
}

async function precheckFailedSelection(database: MigrationPrismaDatabase, sourceJobId: string) {
  const predicate = failedSelectionPredicate(sourceJobId)
  const rows = await database.$queryRaw<
    Array<{
      total: bigint
      eligible: bigint
      missingArtist: bigint
      missingExternalId: bigint
      missingImages: bigint
    }>
  >(Prisma.sql`
    SELECT
      COUNT(*)::bigint AS "total",
      COUNT(*) FILTER (
        WHERE artist."userId" IS NOT NULL
          AND artwork."externalId" IS NOT NULL
          AND EXISTS (SELECT 1 FROM "Image" image WHERE image."artworkId" = artwork.id)
      )::bigint AS "eligible",
      COUNT(*) FILTER (WHERE artist.id IS NULL OR artist."userId" IS NULL)::bigint AS "missingArtist",
      COUNT(*) FILTER (WHERE artwork."externalId" IS NULL)::bigint AS "missingExternalId",
      COUNT(*) FILTER (
        WHERE NOT EXISTS (SELECT 1 FROM "Image" image WHERE image."artworkId" = artwork.id)
      )::bigint AS "missingImages"
    FROM "Artwork" AS artwork
    INNER JOIN "migration_job_items" AS source_item
      ON source_item."artworkIdSnapshot" = artwork.id
    LEFT JOIN "Artist" AS artist ON artist.id = artwork."artistId"
    WHERE ${predicate}
  `)
  const row = rows[0]
  return {
    total: Number(row?.total ?? 0n),
    eligible: Number(row?.eligible ?? 0n),
    missingArtist: Number(row?.missingArtist ?? 0n),
    missingExternalId: Number(row?.missingExternalId ?? 0n),
    missingImages: Number(row?.missingImages ?? 0n)
  }
}

function failedSelectionPredicate(sourceJobId: string, afterArtworkId?: number) {
  return Prisma.sql`
    source_item."systemJobId" = ${sourceJobId}
    AND source_item.status = 'FAILED'::"MigrationItemStatus"
    AND artwork."deletedAt" IS NULL
    ${afterArtworkId === undefined ? Prisma.empty : Prisma.sql`AND artwork.id > ${afterArtworkId}`}
  `
}

function mapPlan(item: Prisma.MigrationJobItemGetPayload<{ include: typeof itemWithFiles }>): MigrationArtworkPlan {
  return {
    id: item.id,
    systemJobId: item.systemJobId,
    artworkId: item.artworkIdSnapshot,
    selectionOrdinal: item.selectionOrdinal,
    status: item.status,
    phase: item.phase,
    attempt: item.attempt,
    sourceDirectory: item.sourceDirectory,
    targetDirectory: item.targetDirectory,
    files: item.files.map((file) => ({
      id: file.id,
      ordinal: file.ordinal,
      imageId: file.imageId,
      sourceStoredPath: file.sourceRelativePath,
      sourceRelativePath: normalizeStoredRelativePath(file.sourceRelativePath),
      targetStoredPath: file.targetRelativePath,
      targetRelativePath: normalizeStoredRelativePath(file.targetRelativePath),
      stagedRelativePath: normalizeStoredRelativePath(requireStagedPath(file.stagedRelativePath, file.id)),
      status: file.status,
      attempt: file.attempt,
      sourceSize: bigintToSafeNumber(file.sourceSize, 'sourceSize'),
      sourceMtimeMs: bigintToSafeNumber(file.sourceMtimeMs, 'sourceMtimeMs'),
      sourceSha256: file.sourceSha256,
      stagedSha256: file.stagedSha256
    }))
  }
}

function assertStoredPlanMatches(plan: MigrationArtworkPlan, input: CreateMigrationPlanInput) {
  const mismatch =
    plan.targetDirectory !== input.targetDirectory ||
    plan.files.length !== input.files.length ||
    plan.files.some((file, index) => {
      const expected = input.files[index]
      return (
        !expected ||
        file.ordinal !== expected.ordinal ||
        file.imageId !== expected.imageId ||
        file.sourceStoredPath !== expected.sourceStoredPath ||
        file.targetStoredPath !== expected.targetStoredPath ||
        file.stagedRelativePath !== expected.stagedRelativePath
      )
    })
  if (mismatch) {
    throw new MigrationActionRequiredError(
      'FILESYSTEM_RECOVERY_FAILED',
      `Persisted migration plan for artwork ${input.artworkId} does not match the current deterministic plan`
    )
  }
}

function fileCheckpointData(input: MigrationFileCheckpoint): Prisma.MigrationFileEntryUpdateInput {
  return {
    status: input.status,
    attempt: input.attempt,
    ...(input.sourceSize !== undefined ? { sourceSize: numberToBigInt(input.sourceSize, 'sourceSize') } : {}),
    ...(input.sourceMtimeMs !== undefined
      ? { sourceMtimeMs: numberToBigInt(input.sourceMtimeMs, 'sourceMtimeMs') }
      : {}),
    ...(input.sourceSha256 !== undefined ? { sourceSha256: input.sourceSha256 } : {}),
    ...(input.stagedSha256 !== undefined ? { stagedSha256: input.stagedSha256 } : {}),
    ...(input.errorCode !== undefined ? { errorCode: sanitizeOptionalCode(input.errorCode) } : {}),
    ...(input.errorSummary !== undefined
      ? { errorSummary: sanitizeOptionalSummary(input.errorCode, input.errorSummary) }
      : {}),
    ...(input.status === 'STAGED' ? { transferredAt: new Date() } : {}),
    ...(input.status === 'PUBLISHED' || input.status === 'SOURCE_CLEANUP_PENDING' ? { publishedAt: new Date() } : {}),
    ...(input.status === 'COMPLETED' ? { cleanedAt: new Date() } : {})
  }
}

function numberToBigInt(value: number | null, field: string): bigint | null {
  if (value === null) return null
  const normalized = Math.trunc(value)
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw new Error(`${field} is outside the safe integer range`)
  return BigInt(normalized)
}

function bigintToSafeNumber(value: bigint | null, field: string): number | null {
  if (value === null) return null
  const normalized = Number(value)
  if (!Number.isSafeInteger(normalized) || normalized < 0) throw new Error(`${field} is outside the safe integer range`)
  return normalized
}

function requireStagedPath(stagedRelativePath: string | null, fileId: string) {
  if (!stagedRelativePath) throw new Error(`Migration file ${fileId} is missing stagedRelativePath`)
  return stagedRelativePath
}

function sanitizeCode(value: string | null | undefined) {
  return migrationPublicErrorCode(value ?? 'INTERNAL_ERROR')
}

function sanitizeOptionalCode(value: string | null) {
  return value === null ? null : sanitizeCode(value)
}

function sanitizeSummary(code: string | null | undefined) {
  return migrationPublicSummary(sanitizeCode(code))
}

function sanitizeOptionalSummary(code: string | null | undefined, value: string | null) {
  return value === null ? null : sanitizeSummary(code)
}

function nextUtcDay(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date
}

function loadPublicationArtwork(client: Prisma.TransactionClient, artworkId: number, imageLimit: number) {
  return client.artwork.findUnique({
    where: { id: artworkId },
    select: {
      ...publicationArtworkSelect,
      images: { ...publicationArtworkSelect.images, take: imageLimit }
    }
  })
}

function assertPublicationFileCollection(
  persistedFiles: Array<{ id: string; imageId: number | null; sourceRelativePath: string; targetRelativePath: string }>,
  files: MigrationPublishFile[]
) {
  if (persistedFiles.length !== files.length) publicationConflict('Migration file plan is incomplete')
  const submitted = new Map(files.map((file) => [file.fileId, file]))
  if (submitted.size !== files.length) publicationConflict('Migration file plan contains duplicate entries')
  for (const persisted of persistedFiles) {
    const file = submitted.get(persisted.id)
    if (
      !file ||
      file.imageId !== persisted.imageId ||
      file.sourceStoredPath !== persisted.sourceRelativePath ||
      file.targetStoredPath !== persisted.targetRelativePath
    ) {
      publicationConflict('Migration file plan changed before publication', persisted.id)
    }
  }
}

function assertPublicationSnapshot(
  artwork: PublicationArtwork | null,
  input: MigrationPublicationInput
): PublicationState {
  const plannedImageIds = sortedUniqueIds(input.plannedImageIds)
  const currentImageIds = artwork?.images.map((image) => image.id) ?? []
  const currentTargetDirectory =
    artwork?.externalId && artwork.artist?.userId
      ? tryBuildTargetDirectory(artwork.artist.userId, artwork.externalId)
      : null
  if (
    !artwork ||
    artwork.deletedAt !== null ||
    currentTargetDirectory !== input.targetDirectory ||
    currentImageIds.length !== plannedImageIds.length ||
    currentImageIds.some((imageId, index) => imageId !== plannedImageIds[index])
  ) {
    publicationConflict('Artwork identity or image membership changed before migration publication')
  }

  const imageFiles = input.files.filter(
    (file): file is MigrationPublishFile & { imageId: number } => file.imageId !== null
  )
  const imageFileById = new Map(imageFiles.map((file) => [file.imageId, file]))
  if (imageFiles.length !== plannedImageIds.length || imageFileById.size !== plannedImageIds.length) {
    publicationConflict('Migration plan does not contain exactly one path for every artwork image')
  }
  for (const imageId of plannedImageIds) {
    if (!imageFileById.has(imageId)) publicationConflict('Migration plan omits an artwork image')
  }

  const images = artwork.images.map((image) => {
    const file = imageFileById.get(image.id)!
    if (image.path !== file.sourceStoredPath && image.path !== file.targetStoredPath) {
      publicationConflict('Image ownership or path changed before migration publication', file.fileId)
    }
    const chapters = referenceTransition(image.chaptersPath, input.files, 'Image.chaptersPath')
    return {
      id: image.id,
      fileId: file.fileId,
      currentPath: image.path,
      targetPath: file.targetStoredPath,
      currentChaptersPath: image.chaptersPath,
      targetChaptersPath: chapters.target
    }
  })
  const metaSource = referenceTransition(artwork.metaSource, input.files, 'Artwork.metaSource')
  const storagePath = storageTransition(artwork.storagePath, input)
  return {
    currentMetaSource: artwork.metaSource,
    targetMetaSource: metaSource.target,
    currentStoragePath: artwork.storagePath,
    targetStoragePath: storagePath.target,
    images
  }
}

function assertPublishedSnapshot(
  artwork: PublicationArtwork | null,
  input: MigrationPublicationInput,
  expected: PublicationState
) {
  const currentTargetDirectory =
    artwork?.externalId && artwork.artist?.userId
      ? tryBuildTargetDirectory(artwork.artist.userId, artwork.externalId)
      : null
  if (
    !artwork ||
    artwork.deletedAt !== null ||
    currentTargetDirectory !== input.targetDirectory ||
    artwork.metaSource !== expected.targetMetaSource ||
    artwork.storagePath !== expected.targetStoragePath ||
    artwork.images.length !== expected.images.length
  ) {
    publicationConflict('Artwork changed while migration publication was being finalized')
  }
  const expectedById = new Map(expected.images.map((image) => [image.id, image]))
  for (const image of artwork.images) {
    const planned = expectedById.get(image.id)
    if (!planned || image.path !== planned.targetPath || image.chaptersPath !== planned.targetChaptersPath) {
      publicationConflict('Image changed while migration publication was being finalized', planned?.fileId)
    }
  }
}

function referenceTransition(current: string | null, files: MigrationPublishFile[], label: string) {
  if (current === null) return { target: null }
  const currentKey = canonicalReference(current, label)
  const matches = files.filter((file) => {
    const sourceKey = canonicalReference(file.sourceStoredPath, label)
    const targetKey = canonicalReference(file.targetStoredPath, label)
    return currentKey === sourceKey || currentKey === targetKey
  })
  const targetKeys = new Set(matches.map((file) => canonicalReference(file.targetStoredPath, label)))
  if (matches.length === 0 || targetKeys.size !== 1) {
    publicationConflict(`${label} is not covered by the frozen migration plan`)
  }
  return { target: formatStoredPathLike(current, matches[0]!.targetStoredPath) }
}

function storageTransition(current: string | null, input: MigrationPublicationInput) {
  if (current === null) return { target: null }
  const currentKey = canonicalReference(current, 'Artwork.storagePath')
  const targetKey = canonicalReference(input.targetDirectory, 'Artwork.storagePath')
  const sourceDirectories = new Set(
    input.files
      .filter((file) => file.imageId !== null)
      .map((file) => normalizeStoredRelativePath(file.sourceStoredPath))
      .map((file) => path.posix.dirname(file))
      .filter((directory) => directory !== '.')
      .map((directory) => canonicalReference(directory, 'Artwork.storagePath'))
  )
  if (currentKey !== targetKey && !sourceDirectories.has(currentKey)) {
    publicationConflict('Artwork.storagePath is not covered by the frozen migration plan')
  }
  return { target: formatStoredPathLike(current, input.targetDirectory) }
}

function canonicalReference(value: string, label: string) {
  try {
    return normalizeStoredRelativePath(value).normalize('NFC').toLocaleLowerCase('en-US')
  } catch {
    publicationConflict(`${label} is not a safe scan-root-relative path`)
  }
}

function formatStoredPathLike(current: string, target: string) {
  const normalized = normalizeStoredRelativePath(target)
  return current.startsWith('/') || current.startsWith('\\') ? `/${normalized}` : normalized
}

function sortedUniqueIds(ids: number[]) {
  const sorted = [...ids].sort((left, right) => left - right)
  if (new Set(sorted).size !== sorted.length) publicationConflict('Migration plannedImageIds contains duplicates')
  return sorted
}

function publicationConflict(message: string, fileId?: string): never {
  throw new MigrationActionRequiredError('DATABASE_PATH_CONFLICT', message, fileId)
}

function tryBuildTargetDirectory(artistUserId: string, externalId: string) {
  try {
    return buildCanonicalTargetDirectory(artistUserId, externalId)
  } catch {
    return null
  }
}

function prismaTransaction(transaction: MigrationPrismaTransaction) {
  return transaction as unknown as Prisma.TransactionClient
}

function isUniqueConflict(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}
