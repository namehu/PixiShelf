import path from 'node:path'
import { Prisma } from '@pixishelf/db'
import { ArchiveExecutorError } from './errors.ts'
import { normalizeRelativePath, type ArchiveStoragePaths } from './storage.ts'
import type { ArchiveTransaction } from './types.ts'
import { lockArchiveUploaderCatalogIdentities } from './uploader-catalog-lock.ts'

const ARCHIVE_PUBLISH_ADVISORY_LOCK_ID = 7_341_902_117

export interface ArchivePublishResult {
  artworkId: number
  revisionId: string
  archivePath: string
}

/**
 * Applies only database publication state. The caller owns the fenced transaction and must invoke
 * its terminal finalizer after this function returns, otherwise every domain mutation rolls back.
 */
export async function publishArchiveImportInTransaction(
  transaction: ArchiveTransaction,
  archiveImportId: string,
  paths: ArchiveStoragePaths,
  now: Date,
  defaultTagIds: readonly number[]
): Promise<ArchivePublishResult> {
  await transaction.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
  const archiveImport = await transaction.archiveImport.findUnique({
    where: { id: archiveImportId },
    include: { items: { orderBy: { pageIndex: 'asc' } }, externalRef: true }
  })
  if (!archiveImport) throw new ArchiveExecutorError('STATE_CONFLICT', 'Archive import no longer exists')
  if (archiveImport.status !== 'RUNNING') {
    throw new ArchiveExecutorError('STATE_CONFLICT', 'Archive import is no longer running', { recoverable: true })
  }
  await lockArchiveUploaderCatalogIdentities(transaction, [
    {
      providerKey: archiveImport.providerKey,
      externalId: archiveImport.externalId,
      canonicalUrls: [archiveImport.canonicalUrl]
    }
  ])
  if (
    archiveImport.items.length !== archiveImport.totalItems ||
    archiveImport.items.some(
      (item) => item.status !== 'COMPLETED' || !item.stagedPath || !item.sha256 || item.byteCount === null
    )
  ) {
    throw new ArchiveExecutorError('MEDIA_INVALID', 'Archive import has incomplete media checkpoints')
  }

  const existingRef = await transaction.artworkExternalRef.findUnique({
    where: {
      providerKey_externalId: {
        providerKey: archiveImport.providerKey,
        externalId: archiveImport.externalId
      }
    },
    include: { artwork: true, archiveRevisions: { where: { isCurrent: true }, take: 1 } }
  })
  if (existingRef && (existingRef.artwork.deletedAt || existingRef.artwork.archiveLifecycleState !== 'ACTIVE')) {
    throw new ArchiveExecutorError('STATE_CONFLICT', 'Archived artwork is in trash and cannot be updated', {
      recoverable: true
    })
  }

  const metadata = archiveImport.normalizedMetadata as Prisma.JsonObject
  const title = nestedString(metadata, ['titles', 'display']) ?? `Archive ${archiveImport.externalId}`
  const description = nullableString(metadata.description)
  const postedAtText = nullableString(metadata.postedAt)
  const postedAt = postedAtText ? new Date(postedAtText) : null
  const artwork = existingRef
    ? await transaction.artwork.update({
        where: { id: existingRef.artworkId },
        data: {
          ...(existingRef.artwork.titleOverridden ? {} : { title }),
          ...(existingRef.artwork.descriptionOverridden ? {} : { description }),
          sourceDate: postedAt,
          sourceUrl: archiveImport.canonicalUrl,
          originalUrl: archiveImport.canonicalUrl,
          storagePath: paths.finalRelativePath,
          createdVia: 'URL_ARCHIVE',
          source: 'URL_ARCHIVE'
        }
      })
    : await transaction.artwork.create({
        data: {
          title,
          description,
          sourceDate: postedAt,
          sourceUrl: archiveImport.canonicalUrl,
          originalUrl: archiveImport.canonicalUrl,
          thumbnailUrl: nullableString(metadata.thumbnailUrl),
          storagePath: paths.finalRelativePath,
          createdVia: 'URL_ARCHIVE',
          source: 'URL_ARCHIVE'
        }
      })

  const externalRef = await transaction.artworkExternalRef.upsert({
    where: {
      providerKey_externalId: {
        providerKey: archiveImport.providerKey,
        externalId: archiveImport.externalId
      }
    },
    create: {
      artworkId: artwork.id,
      providerKey: archiveImport.providerKey,
      externalId: archiveImport.externalId,
      canonicalUrl: archiveImport.canonicalUrl,
      locator: toInputJson(archiveImport.locator),
      metadataHash: archiveImport.metadataHash,
      fetchedAt: now
    },
    update: {
      canonicalUrl: archiveImport.canonicalUrl,
      locator: toInputJson(archiveImport.locator),
      metadataHash: archiveImport.metadataHash,
      fetchedAt: now
    }
  })

  await transaction.artworkSourceSnapshot.upsert({
    where: { externalRefId_metadataHash: { externalRefId: externalRef.id, metadataHash: archiveImport.metadataHash } },
    create: {
      externalRefId: externalRef.id,
      providerSchemaVersion: 1,
      normalizedMetadata: toInputJson(archiveImport.normalizedMetadata),
      rawMetadata: toInputJson(archiveImport.rawMetadata),
      metadataHash: archiveImport.metadataHash,
      fetchedAt: now
    },
    update: { fetchedAt: now }
  })
  await transaction.artworkRawMetadata.upsert({
    where: { artworkId: artwork.id },
    create: { artworkId: artwork.id, rawMetadataJson: toInputJson(archiveImport.rawMetadata) },
    update: { rawMetadataJson: toInputJson(archiveImport.rawMetadata) }
  })

  await replaceSourceTags(transaction, artwork.id, externalRef.id, metadata)
  await appendArchiveDefaultTags(transaction, artwork.id, defaultTagIds)
  await syncArtworkRelationships(transaction, artwork.id, archiveImport.providerKey, metadata.relationships)
  await transaction.image.deleteMany({ where: { artworkId: artwork.id } })
  await transaction.image.createMany({
    data: archiveImport.items.map((item) => ({
      artworkId: artwork.id,
      path: normalizeRelativePath(path.join(paths.finalRelativePath, item.stagedPath!)),
      width: item.width,
      height: item.height,
      size: item.byteCount,
      sortOrder: item.pageIndex,
      mediaType: 'IMAGE' as const
    }))
  })

  const previousRevision = existingRef?.archiveRevisions[0]
  if (previousRevision) {
    await transaction.archiveRevision.update({ where: { id: previousRevision.id }, data: { isCurrent: false } })
  }
  const revision = await transaction.archiveRevision.create({
    data: {
      id: archiveImport.id,
      artworkId: artwork.id,
      externalRefId: externalRef.id,
      archiveImportId: archiveImport.id,
      archivePath: paths.finalRelativePath,
      manifestPath: normalizeRelativePath(path.join(paths.finalRelativePath, 'manifest.json')),
      mediaSnapshot: archiveImport.items.map((item) => ({
        index: item.pageIndex,
        path: item.stagedPath,
        size: item.byteCount?.toString() ?? null,
        width: item.width,
        height: item.height,
        sha256: item.sha256,
        mimeType: item.mimeType
      })),
      metadataHash: archiveImport.metadataHash,
      isCurrent: true
    }
  })
  const updated = await transaction.archiveImport.updateMany({
    where: { id: archiveImport.id, systemJobId: archiveImport.systemJobId, status: 'RUNNING' },
    data: {
      status: 'COMPLETED',
      externalRefId: externalRef.id,
      publishedArtworkId: artwork.id,
      completedItems: archiveImport.items.length,
      failedItems: 0,
      finishedAt: now,
      retainUntil: null,
      errorCode: null,
      errorMessage: null,
      decisionCode: null
    }
  })
  if (updated.count !== 1) {
    throw new ArchiveExecutorError('STATE_CONFLICT', 'Archive import changed during publication', { recoverable: true })
  }
  await transaction.archiveUploaderCatalogItem.updateMany({
    where: { providerKey: archiveImport.providerKey, externalId: archiveImport.externalId },
    data: {
      classification: 'ARCHIVED',
      changeReasons: [],
      comparisonKnown: true,
      lastArchiveImportId: archiveImport.id,
      lastOutcome: 'ARCHIVED',
      lastOutcomeAt: now,
      lastErrorCode: null,
      lastErrorMessage: null
    }
  })
  return { artworkId: artwork.id, revisionId: revision.id, archivePath: paths.finalRelativePath }
}

export async function appendArchiveDefaultTags(
  transaction: ArchiveTransaction,
  artworkId: number,
  defaultTagIds: readonly number[]
) {
  if (defaultTagIds.length === 0) return
  const tags = await transaction.tag.findMany({
    where: { id: { in: [...defaultTagIds] } },
    select: { id: true }
  })
  if (tags.length === 0) return
  await transaction.artworkTag.createMany({
    data: tags.map((tag) => ({ artworkId, tagId: tag.id, provenance: 'MANUAL' as const })),
    skipDuplicates: true
  })
}

async function replaceSourceTags(
  transaction: ArchiveTransaction,
  artworkId: number,
  sourceRefId: string,
  metadata: Prisma.JsonObject
) {
  const values = Array.isArray(metadata.tags) ? metadata.tags : []
  const tagIds: number[] = []
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const namespace = nullableString((value as Prisma.JsonObject).namespace)
    const name = nullableString((value as Prisma.JsonObject).name)
    if (!namespace || !name) continue
    const tag = await transaction.tag.upsert({
      where: { namespace_name: { namespace, name } },
      create: { namespace, name },
      update: {},
      select: { id: true }
    })
    tagIds.push(tag.id)
  }
  await transaction.artworkTag.deleteMany({ where: { artworkId, provenance: 'SOURCE', sourceRefId } })
  if (tagIds.length > 0) {
    await transaction.artworkTag.createMany({
      data: tagIds.map((tagId) => ({ artworkId, tagId, provenance: 'SOURCE' as const, sourceRefId })),
      skipDuplicates: true
    })
  }
}

async function syncArtworkRelationships(
  transaction: ArchiveTransaction,
  artworkId: number,
  providerKey: string,
  rawRelationships: unknown
) {
  if (!Array.isArray(rawRelationships)) return
  for (const raw of rawRelationships) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
    const relationship = raw as Record<string, unknown>
    if (
      relationship.type !== 'REPLACES' ||
      !['OUTBOUND', 'INBOUND'].includes(String(relationship.direction)) ||
      typeof relationship.providerKey !== 'string' ||
      typeof relationship.externalId !== 'string'
    ) {
      continue
    }
    const target = await transaction.artworkExternalRef.findUnique({
      where: {
        providerKey_externalId: {
          providerKey: relationship.providerKey,
          externalId: relationship.externalId
        }
      },
      select: { artworkId: true }
    })
    if (!target || target.artworkId === artworkId) continue
    const outbound = relationship.direction === 'OUTBOUND'
    const fromArtworkId = outbound ? artworkId : target.artworkId
    const toArtworkId = outbound ? target.artworkId : artworkId
    await transaction.artworkRelation.upsert({
      where: { fromArtworkId_toArtworkId_type: { fromArtworkId, toArtworkId, type: 'REPLACES' } },
      create: { fromArtworkId, toArtworkId, type: 'REPLACES', providerKey },
      update: { providerKey }
    })
  }
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function nestedString(value: unknown, keys: string[]): string | null {
  let current = value
  for (const key of keys) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null
    current = (current as Record<string, unknown>)[key]
  }
  return nullableString(current)
}

function toInputJson(value: Prisma.JsonValue): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}
