import { mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ArchiveError } from './errors'
import { buildArchiveStoragePaths, normalizeRelativePath, pathExists } from './storage'
import { syncArtworkRelationships, type ArchiveTransactionClient } from './relationships'

const ARCHIVE_PUBLISH_ADVISORY_LOCK_ID = 7_341_902_117
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

interface FilePublication {
  rollback(): Promise<void>
  commit(): Promise<void>
  previousRevisionRelativePath: string | null
}

export async function publishArchiveImport(importId: string, scanRoot: string) {
  const archiveImport = await prisma.archiveImport.findUnique({
    where: { id: importId },
    include: {
      items: { orderBy: { pageIndex: 'asc' } },
      externalRef: true
    }
  })
  if (!archiveImport) throw new ArchiveError('INTERNAL', '归档任务不存在')
  if (archiveImport.items.some((item) => item.status !== 'COMPLETED')) {
    throw new ArchiveError('MEDIA_INVALID', '归档尚有未完成媒体，拒绝发布')
  }

  const paths = buildArchiveStoragePaths({
    scanRoot,
    importId,
    providerKey: archiveImport.providerKey,
    creatorBucket: archiveImport.creatorBucket,
    externalId: archiveImport.externalId
  })
  let filePublication: FilePublication | null = null

  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
        const existingRef = await tx.artworkExternalRef.findUnique({
          where: {
            providerKey_externalId: {
              providerKey: archiveImport.providerKey,
              externalId: archiveImport.externalId
            }
          },
          include: {
            artwork: true,
            archiveRevisions: { where: { isCurrent: true }, take: 1 }
          }
        })
        const previousRevision = existingRef?.archiveRevisions[0] ?? null
        filePublication = await publishFiles({
          scanRoot,
          stagingAbsolutePath: paths.stagingAbsolutePath,
          finalAbsolutePath: paths.finalAbsolutePath,
          finalRelativePath: paths.finalRelativePath,
          importId,
          previousRevisionId: previousRevision?.id ?? null
        })

        const metadata = archiveImport.normalizedMetadata as Prisma.JsonObject
        const title = stringValue(metadata, ['titles', 'display']) || `Archive ${archiveImport.externalId}`
        const description = nullableString(metadata.description)
        const postedAtValue = nullableString(metadata.postedAt)
        const postedAt = postedAtValue ? new Date(postedAtValue) : null
        const artwork = existingRef
          ? await tx.artwork.update({
              where: { id: existingRef.artworkId },
              data: {
                ...(existingRef.artwork.titleOverridden ? {} : { title }),
                ...(existingRef.artwork.descriptionOverridden ? {} : { description }),
                sourceDate: postedAt,
                sourceUrl: archiveImport.canonicalUrl,
                originalUrl: archiveImport.canonicalUrl,
                storagePath: paths.finalRelativePath,
                deletedAt: null,
                createdVia: 'URL_ARCHIVE',
                source: 'URL_ARCHIVE'
              }
            })
          : await tx.artwork.create({
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

        const externalRef = await tx.artworkExternalRef.upsert({
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
            fetchedAt: new Date()
          },
          update: {
            canonicalUrl: archiveImport.canonicalUrl,
            locator: toInputJson(archiveImport.locator),
            metadataHash: archiveImport.metadataHash,
            fetchedAt: new Date()
          }
        })

        await tx.artworkSourceSnapshot.upsert({
          where: {
            externalRefId_metadataHash: {
              externalRefId: externalRef.id,
              metadataHash: archiveImport.metadataHash
            }
          },
          create: {
            externalRefId: externalRef.id,
            providerSchemaVersion: 1,
            normalizedMetadata: toInputJson(archiveImport.normalizedMetadata),
            rawMetadata: toInputJson(archiveImport.rawMetadata),
            metadataHash: archiveImport.metadataHash,
            fetchedAt: new Date()
          },
          update: { fetchedAt: new Date() }
        })
        await tx.artworkRawMetadata.upsert({
          where: { artworkId: artwork.id },
          create: { artworkId: artwork.id, rawMetadataJson: toInputJson(archiveImport.rawMetadata) },
          update: { rawMetadataJson: toInputJson(archiveImport.rawMetadata) }
        })

        await replaceSourceTags(tx, artwork.id, externalRef.id, metadata)
        await syncArtworkRelationships(
          tx,
          artwork.id,
          archiveImport.providerKey,
          metadata.relationships
        )
        await tx.image.deleteMany({ where: { artworkId: artwork.id } })
        await tx.image.createMany({
          data: archiveImport.items.map((item) => ({
            artworkId: artwork.id,
            path: normalizeRelativePath(path.join(paths.finalRelativePath, item.stagedPath!)),
            width: item.width,
            height: item.height,
            size: item.byteCount,
            sortOrder: item.pageIndex,
            mediaType: 'IMAGE'
          }))
        })

        if (previousRevision) {
          await tx.archiveRevision.update({
            where: { id: previousRevision.id },
            data: {
              isCurrent: false,
              archivePath: filePublication.previousRevisionRelativePath!,
              manifestPath: normalizeRelativePath(
                path.join(filePublication.previousRevisionRelativePath!, 'manifest.json')
              )
            }
          })
        }
        const mediaSnapshot = archiveImport.items.map((item) => ({
          index: item.pageIndex,
          path: item.stagedPath,
          size: item.byteCount?.toString() ?? null,
          width: item.width,
          height: item.height,
          sha256: item.sha256,
          mimeType: item.mimeType
        }))
        const revision = await tx.archiveRevision.create({
          data: {
            id: archiveImport.id,
            artworkId: artwork.id,
            externalRefId: externalRef.id,
            archiveImportId: archiveImport.id,
            archivePath: paths.finalRelativePath,
            manifestPath: normalizeRelativePath(path.join(paths.finalRelativePath, 'manifest.json')),
            mediaSnapshot,
            metadataHash: archiveImport.metadataHash,
            isCurrent: true
          }
        })
        await tx.archiveImport.update({
          where: { id: archiveImport.id },
          data: {
            status: 'COMPLETED',
            externalRefId: externalRef.id,
            publishedArtworkId: artwork.id,
            completedItems: archiveImport.items.length,
            failedItems: 0,
            finishedAt: new Date(),
            retainUntil: null,
            errorCode: null,
            errorMessage: null,
            decisionCode: null
          }
        })
        await tx.systemJob.update({
          where: { id: archiveImport.systemJobId },
          data: {
            status: 'COMPLETED',
            progress: 100,
            message: '归档发布完成',
            result: { artworkId: artwork.id, revisionId: revision.id },
            error: null,
            finishedAt: new Date(),
            heartbeatAt: new Date()
          }
        })
        return { artworkId: artwork.id, revisionId: revision.id, archivePath: paths.finalRelativePath }
      },
      { maxWait: 10_000, timeout: 120_000 }
    )
  } catch (error) {
    await (filePublication as FilePublication | null)?.rollback().catch(() => undefined)
    throw error
  } finally {
    await (filePublication as FilePublication | null)?.commit().catch(() => undefined)
  }
}

export async function trashPublishedArchive(artworkId: number, scanRoot: string) {
  const artwork = await prisma.artwork.findUnique({
    where: { id: artworkId },
    include: { archiveRevisions: { where: { isCurrent: true }, take: 1 } }
  })
  if (!artwork || artwork.createdVia !== 'URL_ARCHIVE') {
    throw new ArchiveError('INTERNAL', '只能通过归档任务删除 URL 归档作品')
  }
  if (artwork.deletedAt) return { artworkId, deletedAt: artwork.deletedAt }
  const revision = artwork.archiveRevisions[0]
  if (!revision) throw new ArchiveError('INTERNAL', '作品缺少当前归档版本')
  const source = path.resolve(scanRoot, revision.archivePath)
  const trashRelativePath = normalizeRelativePath(
    path.join('.trash', 'archive', `${artworkId}-${Date.now()}-${path.basename(revision.archivePath)}`)
  )
  const trash = path.resolve(scanRoot, trashRelativePath)
  await mkdir(path.dirname(trash), { recursive: true })
  await rename(source, trash)
  try {
    const deletedAt = new Date()
    await prisma.$transaction([
      prisma.artwork.update({ where: { id: artworkId }, data: { deletedAt } }),
      prisma.archiveRevision.update({
        where: { id: revision.id },
        data: { trashPath: trashRelativePath, trashedAt: deletedAt, purgeAfter: new Date(deletedAt.getTime() + TRASH_RETENTION_MS) }
      })
    ])
    return { artworkId, deletedAt }
  } catch (error) {
    await rename(trash, source).catch(() => undefined)
    throw error
  }
}

export async function restorePublishedArchive(artworkId: number, scanRoot: string) {
  const artwork = await prisma.artwork.findUnique({
    where: { id: artworkId },
    include: { archiveRevisions: { where: { isCurrent: true }, take: 1 } }
  })
  const revision = artwork?.archiveRevisions[0]
  if (!artwork?.deletedAt || !revision?.trashPath) throw new ArchiveError('INTERNAL', '作品不在归档回收站中')
  const source = path.resolve(scanRoot, revision.trashPath)
  const target = path.resolve(scanRoot, revision.archivePath)
  if (await pathExists(target)) throw new ArchiveError('INTERNAL', '归档原路径已被占用，无法恢复')
  await mkdir(path.dirname(target), { recursive: true })
  await rename(source, target)
  try {
    await prisma.$transaction([
      prisma.artwork.update({ where: { id: artwork.id }, data: { deletedAt: null } }),
      prisma.archiveRevision.update({
        where: { id: revision.id },
        data: { trashPath: null, trashedAt: null, purgeAfter: null }
      })
    ])
    return { artworkId: artwork.id }
  } catch (error) {
    await rename(target, source).catch(() => undefined)
    throw error
  }
}

export async function purgeExpiredArchiveTrash(scanRoot: string, now = new Date()): Promise<number> {
  const revisions = await prisma.archiveRevision.findMany({
    where: { isCurrent: true, purgeAfter: { lte: now }, trashPath: { not: null }, artwork: { deletedAt: { not: null } } },
    select: { id: true, artworkId: true, trashPath: true }
  })
  let purged = 0
  for (const revision of revisions) {
    const target = path.resolve(scanRoot, revision.trashPath!)
    await rm(target, { recursive: true, force: true })
    await prisma.artwork.deleteMany({
      where: { id: revision.artworkId, createdVia: 'URL_ARCHIVE', deletedAt: { not: null } }
    })
    purged += 1
  }
  return purged
}

async function replaceSourceTags(
  tx: ArchiveTransactionClient,
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
    const tag = await tx.tag.upsert({
      where: { namespace_name: { namespace, name } },
      create: { namespace, name },
      update: {},
      select: { id: true }
    })
    tagIds.push(tag.id)
  }
  await tx.artworkTag.deleteMany({ where: { artworkId, provenance: 'SOURCE', sourceRefId } })
  if (tagIds.length > 0) {
    await tx.artworkTag.createMany({
      data: tagIds.map((tagId) => ({ artworkId, tagId, provenance: 'SOURCE' as const, sourceRefId })),
      skipDuplicates: true
    })
  }
}

async function publishFiles(input: {
  scanRoot: string
  stagingAbsolutePath: string
  finalAbsolutePath: string
  finalRelativePath: string
  importId: string
  previousRevisionId: string | null
}): Promise<FilePublication> {
  await mkdir(path.dirname(input.finalAbsolutePath), { recursive: true })
  if (!input.previousRevisionId) {
    if (await pathExists(input.finalAbsolutePath)) {
      throw new ArchiveError('INTERNAL', '归档目标目录已存在，但数据库没有对应版本')
    }
    await rename(input.stagingAbsolutePath, input.finalAbsolutePath)
    let active = true
    return {
      previousRevisionRelativePath: null,
      rollback: async () => {
        if (!active || !(await pathExists(input.finalAbsolutePath))) return
        await rename(input.finalAbsolutePath, input.stagingAbsolutePath)
        active = false
      },
      commit: async () => {
        active = false
      }
    }
  }

  const oldTemporary = path.resolve(input.scanRoot, '.archive-publish', `${input.importId}-old`)
  const previousRevisionRelativePath = normalizeRelativePath(
    path.join(input.finalRelativePath, 'revisions', input.previousRevisionId)
  )
  const previousRevisionAbsolutePath = path.resolve(input.scanRoot, previousRevisionRelativePath)
  await rm(oldTemporary, { recursive: true, force: true })
  await mkdir(oldTemporary, { recursive: true })
  await rename(path.join(input.finalAbsolutePath, 'media'), path.join(oldTemporary, 'media'))
  await rename(path.join(input.finalAbsolutePath, 'manifest.json'), path.join(oldTemporary, 'manifest.json'))
  try {
    await rename(path.join(input.stagingAbsolutePath, 'media'), path.join(input.finalAbsolutePath, 'media'))
    await rename(path.join(input.stagingAbsolutePath, 'manifest.json'), path.join(input.finalAbsolutePath, 'manifest.json'))
    await mkdir(path.dirname(previousRevisionAbsolutePath), { recursive: true })
    await rename(oldTemporary, previousRevisionAbsolutePath)
    await rm(input.stagingAbsolutePath, { recursive: true, force: true })
  } catch (error) {
    if (await pathExists(path.join(input.finalAbsolutePath, 'media'))) {
      await mkdir(input.stagingAbsolutePath, { recursive: true })
      await rename(path.join(input.finalAbsolutePath, 'media'), path.join(input.stagingAbsolutePath, 'media')).catch(() => undefined)
      await rename(path.join(input.finalAbsolutePath, 'manifest.json'), path.join(input.stagingAbsolutePath, 'manifest.json')).catch(
        () => undefined
      )
    }
    const oldLocation = (await pathExists(previousRevisionAbsolutePath)) ? previousRevisionAbsolutePath : oldTemporary
    await rename(path.join(oldLocation, 'media'), path.join(input.finalAbsolutePath, 'media')).catch(() => undefined)
    await rename(path.join(oldLocation, 'manifest.json'), path.join(input.finalAbsolutePath, 'manifest.json')).catch(
      () => undefined
    )
    throw error
  }

  let active = true
  return {
    previousRevisionRelativePath,
    rollback: async () => {
      if (!active) return
      await mkdir(input.stagingAbsolutePath, { recursive: true })
      await rename(path.join(input.finalAbsolutePath, 'media'), path.join(input.stagingAbsolutePath, 'media'))
      await rename(path.join(input.finalAbsolutePath, 'manifest.json'), path.join(input.stagingAbsolutePath, 'manifest.json'))
      await rename(path.join(previousRevisionAbsolutePath, 'media'), path.join(input.finalAbsolutePath, 'media'))
      await rename(path.join(previousRevisionAbsolutePath, 'manifest.json'), path.join(input.finalAbsolutePath, 'manifest.json'))
      await rm(previousRevisionAbsolutePath, { recursive: true, force: true })
      active = false
    },
    commit: async () => {
      active = false
    }
  }
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function stringValue(value: unknown, pathParts: string[]): string | null {
  let current: unknown = value
  for (const part of pathParts) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null
    current = (current as Record<string, unknown>)[part]
  }
  return nullableString(current)
}

function toInputJson(value: Prisma.JsonValue): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue
}
