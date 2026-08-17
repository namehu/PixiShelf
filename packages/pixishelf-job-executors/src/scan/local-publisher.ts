import { createHash, randomUUID } from 'node:crypto'
import type { Prisma } from '@pixishelf/db'
import { archiveJson, type FrozenArchiveManifest } from './archive-manifest.js'
import { ScanExecutorError } from './errors.js'
import type { DiscoveredMediaFile } from './discovery.js'
import type { ScanTransaction } from './types.js'

export interface LocalPublishBase {
  transaction: ScanTransaction
  runId: string
  work: LocalWorkRow
  title: string
  now: Date
}

export async function publishLocalMediaWork(
  input: LocalPublishBase & {
    artistId: number
    media: readonly DiscoveredMediaFile[]
    defaultTagIds: readonly number[]
  }
) {
  const checkpoint = await completedCheckpoint(input)
  if (checkpoint) return checkpoint
  const existing = await input.transaction.artwork.findUnique({
    where: { storagePath: input.work.relativePath },
    select: { id: true }
  })
  if (existing) {
    await writeLocalItem(input, {
      externalId: null,
      status: 'SKIPPED',
      action: 'SKIP_EXISTING',
      mediaCount: 0,
      newImageCount: 0
    })
    return { status: 'SKIPPED' as const, newImages: 0, artworkId: existing.id }
  }
  const artist = await input.transaction.artist.findUnique({ where: { id: input.artistId }, select: { id: true } })
  if (!artist) throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen local artist mapping no longer exists')
  const tags = await input.transaction.tag.findMany({
    where: { id: { in: [...input.defaultTagIds] } },
    select: { id: true }
  })
  if (tags.length !== input.defaultTagIds.length) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'A frozen default tag no longer exists')
  }
  const artwork = await input.transaction.artwork.create({
    data: {
      title: input.title,
      artistId: input.artistId,
      source: 'LOCAL_IMPORT',
      createdVia: 'LOCAL_DIRECTORY',
      storagePath: input.work.relativePath,
      sourceDate: input.now
    },
    select: { id: true }
  })
  const storageKey = localStorageKey(artwork.id, input.work.relativePath)
  await input.transaction.artwork.update({ where: { id: artwork.id }, data: { storageKey } })
  await input.transaction.image.createMany({
    data: input.media.map((item) => ({
      artworkId: artwork.id,
      path: item.relativePath,
      size: item.size,
      sortOrder: item.sortOrder,
      mediaType: item.mediaType,
      webpAnimationStatus: item.webpAnimationStatus
    }))
  })
  if (tags.length > 0) {
    await input.transaction.artworkTag.createMany({
      data: tags.map((tag) => ({ artworkId: artwork.id, tagId: tag.id, provenance: 'MANUAL' as const })),
      skipDuplicates: true
    })
  }
  await writeLocalItem(input, {
    externalId: storageKey,
    status: 'SUCCESS',
    action: 'CREATE',
    mediaCount: input.media.length,
    newImageCount: input.media.length
  })
  return { status: 'SUCCESS' as const, newImages: input.media.length, artworkId: artwork.id }
}

export async function publishArchiveManifestWork(input: LocalPublishBase & { manifest: FrozenArchiveManifest }) {
  const checkpoint = await completedCheckpoint(input)
  if (checkpoint) return checkpoint
  const existing = await input.transaction.artworkExternalRef.findUnique({
    where: {
      providerKey_externalId: {
        providerKey: input.manifest.provider.key,
        externalId: input.manifest.provider.externalId
      }
    },
    select: { artworkId: true }
  })
  if (existing) {
    await writeLocalItem(input, {
      externalId: `${input.manifest.provider.key}:${input.manifest.provider.externalId}`,
      status: 'SKIPPED',
      action: 'SKIP_EXISTING',
      mediaCount: 0,
      newImageCount: 0
    })
    return { status: 'SKIPPED' as const, newImages: 0, artworkId: existing.artworkId }
  }
  const metadata = input.manifest.normalized
  const artwork = await input.transaction.artwork.create({
    data: {
      title: nestedString(metadata, 'titles', 'display') ?? input.title,
      description: nullableString(metadata.description),
      sourceDate: parseDate(metadata.postedAt),
      sourceUrl: input.manifest.provider.canonicalUrl,
      originalUrl: input.manifest.provider.canonicalUrl,
      thumbnailUrl: nullableString(metadata.thumbnailUrl),
      storagePath: input.work.relativePath,
      createdVia: 'URL_ARCHIVE',
      source: 'URL_ARCHIVE'
    },
    select: { id: true }
  })
  const ref = await input.transaction.artworkExternalRef.create({
    data: {
      artworkId: artwork.id,
      providerKey: input.manifest.provider.key,
      externalId: input.manifest.provider.externalId,
      canonicalUrl: input.manifest.provider.canonicalUrl,
      locator: archiveJson(input.manifest.provider.locator),
      metadataHash: input.manifest.metadataHash,
      fetchedAt: input.manifest.createdAt
    }
  })
  await input.transaction.artworkSourceSnapshot.create({
    data: {
      externalRefId: ref.id,
      providerSchemaVersion: 1,
      normalizedMetadata: archiveJson(metadata),
      rawMetadata: archiveJson(input.manifest.raw),
      metadataHash: input.manifest.metadataHash,
      fetchedAt: input.manifest.createdAt
    }
  })
  await input.transaction.artworkRawMetadata.create({
    data: { artworkId: artwork.id, rawMetadataJson: archiveJson(input.manifest.raw) }
  })
  await publishArchiveSourceTags(input.transaction, artwork.id, ref.id, metadata.tags)
  await publishArchiveRelationships(
    input.transaction,
    artwork.id,
    input.manifest.provider.key,
    input.manifest.relationships
  )
  await input.transaction.image.createMany({
    data: input.manifest.media.map((item) => ({
      artworkId: artwork.id,
      path: item.databasePath,
      sortOrder: item.index,
      width: item.width,
      height: item.height,
      size: item.bytes,
      mediaType: item.mediaType
    }))
  })
  await input.transaction.archiveRevision.create({
    data: {
      id: input.manifest.revisionId ?? randomUUID(),
      artworkId: artwork.id,
      externalRefId: ref.id,
      archivePath: input.work.relativePath,
      manifestPath: `${input.work.relativePath}/manifest.json`,
      mediaSnapshot: archiveJson(input.manifest.media.map((item) => ({ ...item, bytes: item.bytes.toString() }))),
      metadataHash: input.manifest.metadataHash,
      isCurrent: true,
      publishedAt: input.manifest.createdAt
    }
  })
  await writeLocalItem(input, {
    externalId: `${input.manifest.provider.key}:${input.manifest.provider.externalId}`,
    status: 'SUCCESS',
    action: 'CREATE',
    mediaCount: input.manifest.media.length,
    newImageCount: input.manifest.media.length
  })
  return { status: 'SUCCESS' as const, newImages: input.manifest.media.length, artworkId: artwork.id }
}

async function completedCheckpoint(input: LocalPublishBase) {
  const item = await input.transaction.scanRunItem.findUnique({
    where: { scanRunId_checkpointKey: { scanRunId: input.runId, checkpointKey: localCheckpointKey(input.work) } }
  })
  if (item?.status !== 'SUCCESS' && item?.status !== 'SKIPPED') return null
  return { status: item.status, newImages: item.newImageCount, artworkId: null as number | null }
}

async function writeLocalItem(
  input: LocalPublishBase,
  result: {
    externalId: string | null
    status: 'SUCCESS' | 'SKIPPED'
    action: 'CREATE' | 'SKIP_EXISTING'
    mediaCount: number
    newImageCount: number
  }
) {
  await input.transaction.scanRunItem.upsert({
    where: { scanRunId_checkpointKey: { scanRunId: input.runId, checkpointKey: localCheckpointKey(input.work) } },
    create: {
      scanRunId: input.runId,
      checkpointKey: localCheckpointKey(input.work),
      externalId: result.externalId,
      title: input.title,
      relativeDirectory: input.work.relativePath,
      status: result.status,
      action: result.action,
      attempt: 1,
      mediaCount: result.mediaCount,
      newImageCount: result.newImageCount,
      finishedAt: input.now
    },
    update: {
      externalId: result.externalId,
      title: input.title,
      status: result.status,
      action: result.action,
      attempt: { increment: 1 },
      mediaCount: result.mediaCount,
      newImageCount: result.newImageCount,
      errorMessage: null,
      finishedAt: input.now
    }
  })
  await input.transaction.scanRun.updateMany({
    where: { id: input.runId, checkpointOrdinal: { lt: input.work.ordinal + 1 } },
    data: { checkpointStage: 'PROCESSING', checkpointOrdinal: input.work.ordinal + 1 }
  })
}

export type LocalWorkRow = Prisma.ScanRunLocalWorkInputGetPayload<Record<string, never>>

export function localCheckpointKey(work: Pick<LocalWorkRow, 'ordinal' | 'kind' | 'relativePath'>) {
  const identity = createHash('sha256').update(work.kind).update('\0').update(work.relativePath).digest('hex')
  return `local:${work.ordinal}:${identity}`
}

function localStorageKey(artworkId: number, relativePath: string) {
  const value = createHash('sha256').update(relativePath).digest().readUInt32BE(0) % 9_000_000
  return `e_${artworkId}_${String(value + 1_000_000)}`
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function nestedString(value: Record<string, unknown>, parent: string, child: string) {
  const nested = value[parent]
  if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return null
  return nullableString((nested as Record<string, unknown>)[child])
}

function parseDate(value: unknown) {
  const text = nullableString(value)
  if (!text) return null
  const date = new Date(text)
  return Number.isNaN(date.getTime()) ? null : date
}

async function publishArchiveSourceTags(
  transaction: ScanTransaction,
  artworkId: number,
  sourceRefId: string,
  value: unknown
) {
  if (!Array.isArray(value)) return
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const namespace = nullableString((item as Record<string, unknown>).namespace)
    const name = nullableString((item as Record<string, unknown>).name)
    if (!namespace || !name) continue
    const tag = await transaction.tag.upsert({
      where: { namespace_name: { namespace, name } },
      create: { namespace, name },
      update: {},
      select: { id: true }
    })
    await transaction.artworkTag.create({
      data: { artworkId, tagId: tag.id, provenance: 'SOURCE', sourceRefId }
    })
  }
}

async function publishArchiveRelationships(
  transaction: ScanTransaction,
  artworkId: number,
  providerKey: string,
  value: unknown
) {
  if (!Array.isArray(value)) return
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue
    const relationship = item as Record<string, unknown>
    if (
      relationship.type !== 'REPLACES' ||
      (relationship.direction !== 'OUTBOUND' && relationship.direction !== 'INBOUND') ||
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
    const fromArtworkId = relationship.direction === 'OUTBOUND' ? artworkId : target.artworkId
    const toArtworkId = relationship.direction === 'OUTBOUND' ? target.artworkId : artworkId
    await transaction.artworkRelation.upsert({
      where: { fromArtworkId_toArtworkId_type: { fromArtworkId, toArtworkId, type: 'REPLACES' } },
      create: { fromArtworkId, toArtworkId, type: 'REPLACES', providerKey },
      update: { providerKey }
    })
  }
}
