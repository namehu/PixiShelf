import { mkdir, rename, rm } from 'node:fs/promises'
import path from 'node:path'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { ArchiveError } from './errors'
import { buildArchiveStoragePaths, normalizeRelativePath, pathExists, removeArchivePath } from './storage'
import { syncArtworkRelationships, type ArchiveTransactionClient } from './relationships'

export const ARCHIVE_PUBLISH_ADVISORY_LOCK_ID = 7_341_902_117
const TRASH_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export async function publishArchiveImport(importId: string, scanRoot: string, leaseAttempt: number) {
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
  await prepareRevisionDirectory({
    importId,
    jobId: archiveImport.systemJobId,
    leaseAttempt,
    stagingAbsolutePath: paths.stagingAbsolutePath,
    finalAbsolutePath: paths.finalAbsolutePath
  })

  const result = await prisma.$transaction(
      async (tx) => {
        await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
        await assertPublishLease(tx, archiveImport.id, archiveImport.systemJobId, leaseAttempt)
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
        if (
          existingRef &&
          (existingRef.artwork.deletedAt || existingRef.artwork.archiveLifecycleState !== 'ACTIVE')
        ) {
          throw stateConflict('该作品已在归档回收站中，请先显式恢复后再更新')
        }

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
            data: { isCurrent: false }
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
        const importResult = await tx.archiveImport.updateMany({
          where: { id: archiveImport.id, status: 'RUNNING' },
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
        if (importResult.count !== 1) throw stateConflict('归档任务已不再允许发布')
        const jobResult = await tx.systemJob.updateMany({
          where: { id: archiveImport.systemJobId, attempt: leaseAttempt, status: 'RUNNING' },
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
        if (jobResult.count !== 1) throw new ArchiveError('LEASE_LOST', '归档 Worker 租约已失效')
        return { artworkId: artwork.id, revisionId: revision.id, archivePath: paths.finalRelativePath }
      },
      { maxWait: 10_000, timeout: 120_000 }
    )
  // A crash before this cleanup is harmless: publication is already committed
  // and the deterministic staging directory is internal and collectible.
  if (paths.stagingAbsolutePath !== paths.finalAbsolutePath) {
    await rm(paths.stagingAbsolutePath, { recursive: true, force: true })
  }
  return result
}

export async function trashPublishedArchive(artworkId: number) {
  const intent = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
    const artwork = await tx.artwork.findUnique({
      where: { id: artworkId },
      include: { archiveRevisions: { include: { externalRef: true } } }
    })
    if (!artwork || artwork.createdVia !== 'URL_ARCHIVE') {
      throw new ArchiveError('INTERNAL', '只能通过归档任务删除 URL 归档作品')
    }
    if (artwork.archiveLifecycleState === 'RESTORING') {
      throw stateConflict('作品正在恢复，请稍后再删除')
    }
    if (artwork.archiveLifecycleState === 'TRASHED') {
      if (!artwork.deletedAt) throw stateConflict('作品回收站状态不一致')
      return { artworkId, deletedAt: artwork.deletedAt }
    }
    if (artwork.archiveLifecycleState === 'TRASHING') {
      if (!artwork.deletedAt) throw stateConflict('作品回收站状态不一致')
      return { artworkId, deletedAt: artwork.deletedAt }
    }
    if (artwork.deletedAt) throw stateConflict('作品删除状态不一致')
    if (artwork.archiveRevisions.length === 0) throw new ArchiveError('INTERNAL', '作品缺少归档版本')
    for (const identity of uniqueRevisionIdentities(artwork.archiveRevisions)) {
      await assertNoActiveIdentityImport(tx, identity.providerKey, identity.externalId)
    }
    const deletedAt = new Date()
    for (const revision of artwork.archiveRevisions) {
      await tx.archiveRevision.update({
        where: { id: revision.id },
        data: {
          trashPath: revision.trashPath ?? buildRevisionTrashPath(artworkId, revision.id),
          trashedAt: deletedAt,
          purgeAfter: new Date(deletedAt.getTime() + TRASH_RETENTION_MS)
        }
      })
    }
    const changed = await tx.artwork.updateMany({
      where: { id: artworkId, archiveLifecycleState: 'ACTIVE', deletedAt: null },
      data: {
        deletedAt,
        archiveLifecycleState: 'TRASHING'
      }
    })
    if (changed.count !== 1) throw stateConflict('作品状态已改变，未能开始删除')
    return { artworkId, deletedAt }
  }, { maxWait: 10_000, timeout: 30_000 })
  return intent
}

export async function restorePublishedArchive(artworkId: number) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
    const artwork = await tx.artwork.findUnique({
      where: { id: artworkId },
      include: { archiveRevisions: { include: { externalRef: true } } }
    })
    if (!artwork || artwork.createdVia !== 'URL_ARCHIVE') {
      throw new ArchiveError('INTERNAL', '只能恢复 URL 归档作品')
    }
    if (artwork.archiveLifecycleState === 'ACTIVE') {
      throw new ArchiveError('INTERNAL', '作品不在归档回收站中')
    }
    if (artwork.archiveLifecycleState === 'TRASHING') {
      throw stateConflict('作品仍在移入回收站，请稍后再恢复')
    }
    if (!artwork.deletedAt || artwork.archiveRevisions.some((revision) => !revision.trashPath)) {
      throw stateConflict('作品回收站状态不完整，暂时不能恢复')
    }
    if (artwork.archiveLifecycleState === 'RESTORING') return
    for (const identity of uniqueRevisionIdentities(artwork.archiveRevisions)) {
      await assertNoActiveIdentityImport(tx, identity.providerKey, identity.externalId)
    }
    const changed = await tx.artwork.updateMany({
      where: { id: artworkId, archiveLifecycleState: 'TRASHED', deletedAt: { not: null } },
      data: { archiveLifecycleState: 'RESTORING' }
    })
    if (changed.count !== 1) throw stateConflict('作品状态已改变，未能开始恢复')
  }, { maxWait: 10_000, timeout: 30_000 })
  return { artworkId }
}

export async function reconcilePendingArchiveLifecycles(scanRoot: string): Promise<{
  reconciled: number
  failures: Array<{ artworkId: number; error: unknown }>
}> {
  const pending = await prisma.artwork.findMany({
    where: { archiveLifecycleState: { in: ['TRASHING', 'RESTORING'] } },
    select: { id: true }
  })
  let reconciled = 0
  const failures: Array<{ artworkId: number; error: unknown }> = []
  for (const artwork of pending) {
    try {
      await reconcileArchiveLifecycle(artwork.id, scanRoot)
      reconciled += 1
    } catch (error) {
      failures.push({ artworkId: artwork.id, error })
    }
  }
  return { reconciled, failures }
}

export async function reconcilePendingArchiveCleanups(scanRoot: string): Promise<{
  reconciled: number
  failures: Array<{ importId: string; error: unknown }>
}> {
  const pending = await prisma.archiveImport.findMany({
    where: {
      cleanupRequestedAt: { not: null },
      status: { in: ['PENDING', 'PAUSED', 'FAILED', 'CANCELLED'] }
    },
    select: { id: true }
  })
  let reconciled = 0
  const failures: Array<{ importId: string; error: unknown }> = []
  for (const candidate of pending) {
    try {
      const didReconcile = await prisma.$transaction(async (tx) => {
        await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
        const archiveImport = await tx.archiveImport.findFirst({
          where: {
            id: candidate.id,
            cleanupRequestedAt: { not: null },
            status: { in: ['PENDING', 'PAUSED', 'FAILED', 'CANCELLED'] }
          },
          include: { systemJob: true }
        })
        if (!archiveImport) return false
        const preparedPath = buildArchiveStoragePaths({
          scanRoot,
          importId: archiveImport.id,
          providerKey: archiveImport.providerKey,
          creatorBucket: archiveImport.creatorBucket,
          externalId: archiveImport.externalId
        }).finalRelativePath
        await removeArchivePathIfExists(scanRoot, archiveImport.stagingPath)
        await removeArchivePathIfExists(scanRoot, preparedPath)
        await tx.archiveImportItem.updateMany({
          where: { archiveImportId: archiveImport.id },
          data: {
            status: 'PENDING',
            attempts: 0,
            stagedPath: null,
            byteCount: null,
            mimeType: null,
            quality: null,
            width: null,
            height: null,
            sha256: null,
            errorCode: null,
            errorMessage: null,
            errorStage: null,
            remoteHost: null,
            startedAt: null,
            finishedAt: null
          }
        })
        const task = await tx.archiveImport.updateMany({
          where: {
            id: archiveImport.id,
            cleanupRequestedAt: { not: null },
            status: archiveImport.status
          },
          data: { cleanupRequestedAt: null, completedItems: 0, failedItems: 0, retainUntil: null }
        })
        if (task.count !== 1) throw stateConflict('暂存清理任务状态已改变')
        const job = await tx.systemJob.updateMany({
          where: { id: archiveImport.systemJobId, status: archiveImport.systemJob.status },
          data: { message: '暂存目录已清理' }
        })
        if (job.count !== 1) throw stateConflict('暂存清理对应任务状态已改变')
        return true
      }, { maxWait: 10_000, timeout: 120_000 })
      if (didReconcile) reconciled += 1
    } catch (error) {
      failures.push({ importId: candidate.id, error })
    }
  }
  return { reconciled, failures }
}

export async function requestExpiredArchiveCleanups(now = new Date()): Promise<number> {
  const expired = await prisma.archiveImport.findMany({
    where: {
      status: { in: ['FAILED', 'CANCELLED'] },
      retainUntil: { lte: now },
      cleanupRequestedAt: null
    },
    select: { id: true, systemJobId: true }
  })
  let requested = 0
  for (const candidate of expired) {
    const didRequest = await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
      const task = await tx.archiveImport.updateMany({
        where: {
          id: candidate.id,
          status: { in: ['FAILED', 'CANCELLED'] },
          retainUntil: { lte: now },
          cleanupRequestedAt: null
        },
        data: { cleanupRequestedAt: now }
      })
      if (task.count !== 1) return false
      await tx.systemJob.updateMany({
        where: { id: candidate.systemJobId },
        data: { message: '保留期已结束，等待归档 Worker 清理暂存目录...' }
      })
      return true
    })
    if (didRequest) requested += 1
  }
  return requested
}

export async function reconcileArchiveLifecycle(artworkId: number, scanRoot: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
    const artwork = await tx.artwork.findUnique({
      where: { id: artworkId },
      include: { archiveRevisions: true }
    })
    if (!artwork || artwork.createdVia !== 'URL_ARCHIVE') return
    if (artwork.archiveLifecycleState === 'ACTIVE' || artwork.archiveLifecycleState === 'TRASHED') return
    if (!artwork.deletedAt) throw stateConflict('归档生命周期状态缺少删除时间')
    if (artwork.archiveRevisions.length === 0) throw new ArchiveError('INTERNAL', '作品缺少归档版本')

    if (artwork.archiveLifecycleState === 'TRASHING') {
      for (const revision of artwork.archiveRevisions) {
        if (!revision.trashPath) throw stateConflict('归档版本缺少回收站目标路径')
        await moveArchiveDirectory(
          archiveAbsolutePath(scanRoot, revision.archivePath),
          archiveAbsolutePath(scanRoot, revision.trashPath),
          '归档媒体目录不存在'
        )
      }
      const changed = await tx.artwork.updateMany({
        where: { id: artwork.id, archiveLifecycleState: 'TRASHING', deletedAt: { not: null } },
        data: { archiveLifecycleState: 'TRASHED' }
      })
      if (changed.count !== 1) throw stateConflict('作品删除状态已改变')
      return
    }

    for (const revision of artwork.archiveRevisions) {
      if (!revision.trashPath) throw stateConflict('归档版本缺少回收站来源路径')
      await moveArchiveDirectory(
        archiveAbsolutePath(scanRoot, revision.trashPath),
        archiveAbsolutePath(scanRoot, revision.archivePath),
        '回收站媒体目录不存在'
      )
    }
    await tx.archiveRevision.updateMany({
      where: { artworkId: artwork.id },
      data: { trashPath: null, trashedAt: null, purgeAfter: null }
    })
    const changed = await tx.artwork.updateMany({
      where: { id: artwork.id, archiveLifecycleState: 'RESTORING', deletedAt: { not: null } },
      data: { deletedAt: null, archiveLifecycleState: 'ACTIVE' }
    })
    if (changed.count !== 1) throw stateConflict('作品恢复状态已改变')
  }, { maxWait: 10_000, timeout: 120_000 })
}

export async function purgeExpiredArchiveTrash(scanRoot: string, now = new Date()): Promise<number> {
  const artworks = await prisma.artwork.findMany({
    where: {
      createdVia: 'URL_ARCHIVE',
      archiveLifecycleState: 'TRASHED',
      deletedAt: { not: null },
      archiveRevisions: { some: { purgeAfter: { lte: now } } }
    },
    select: { id: true }
  })
  let purged = 0
  for (const candidate of artworks) {
    const removed = await prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
      const artwork = await tx.artwork.findFirst({
        where: {
          id: candidate.id,
          createdVia: 'URL_ARCHIVE',
          archiveLifecycleState: 'TRASHED',
          deletedAt: { not: null },
          archiveRevisions: { some: { purgeAfter: { lte: now } } }
        },
        include: { archiveRevisions: true }
      })
      if (!artwork) return false
      for (const revision of artwork.archiveRevisions) {
        if (revision.trashPath) {
          await rm(archiveAbsolutePath(scanRoot, revision.trashPath), { recursive: true, force: true })
        }
        await rm(archiveAbsolutePath(scanRoot, revision.archivePath), { recursive: true, force: true })
      }
      const result = await tx.artwork.deleteMany({
        where: {
          id: artwork.id,
          createdVia: 'URL_ARCHIVE',
          archiveLifecycleState: 'TRASHED',
          deletedAt: { not: null }
        }
      })
      return result.count === 1
    }, { maxWait: 10_000, timeout: 120_000 })
    if (removed) purged += 1
  }
  return purged
}

function buildRevisionTrashPath(artworkId: number, revisionId: string): string {
  return normalizeRelativePath(path.join('.trash', 'archive', String(artworkId), revisionId))
}

function archiveAbsolutePath(scanRoot: string, storedPath: string): string {
  const root = path.resolve(scanRoot)
  const trimmedPath = storedPath.trim()
  if (!trimmedPath || trimmedPath === '.') {
    throw new ArchiveError('INTERNAL', '归档路径不能指向存储根目录')
  }
  const absolute = path.resolve(root, storedPath)
  const relative = path.relative(root, absolute)
  if (
    absolute === root ||
    relative === '' ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new ArchiveError('INTERNAL', '归档路径越过存储根目录')
  }
  return absolute
}

async function moveArchiveDirectory(source: string, target: string, missingMessage: string): Promise<void> {
  const [sourceExists, targetExists] = await Promise.all([pathExists(source), pathExists(target)])
  if (sourceExists && !targetExists) {
    await mkdir(path.dirname(target), { recursive: true })
    await rename(source, target)
    return
  }
  if (!sourceExists && targetExists) return
  if (!sourceExists && !targetExists) throw new ArchiveError('INTERNAL', missingMessage)
  throw new ArchiveError('INTERNAL', '归档来源路径和目标路径同时存在')
}

async function removeArchivePathIfExists(scanRoot: string, relativePath: string): Promise<void> {
  try {
    await removeArchivePath(scanRoot, relativePath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

function uniqueRevisionIdentities(
  revisions: Array<{ externalRef: { providerKey: string; externalId: string } }>
): Array<{ providerKey: string; externalId: string }> {
  const identities = new Map<string, { providerKey: string; externalId: string }>()
  for (const revision of revisions) {
    const identity = revision.externalRef
    identities.set(`${identity.providerKey}\u0000${identity.externalId}`, identity)
  }
  return [...identities.values()]
}

async function assertNoActiveIdentityImport(
  tx: ArchiveTransactionClient,
  providerKey: string,
  externalId: string
): Promise<void> {
  const active = await tx.archiveImport.findFirst({
    where: { providerKey, externalId, status: { in: ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'] } },
    select: { id: true }
  })
  if (active) throw stateConflict('该作品有进行中的归档更新，暂时不能删除或恢复')
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

async function prepareRevisionDirectory(input: {
  importId: string
  jobId: string
  leaseAttempt: number
  stagingAbsolutePath: string
  finalAbsolutePath: string
}): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      await tx.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', ARCHIVE_PUBLISH_ADVISORY_LOCK_ID)
      await assertPublishLease(tx, input.importId, input.jobId, input.leaseAttempt)
      await mkdir(path.dirname(input.finalAbsolutePath), { recursive: true })
      if (!(await pathExists(input.finalAbsolutePath))) {
        if (!(await pathExists(input.stagingAbsolutePath))) {
          throw new ArchiveError('MEDIA_INVALID', '归档暂存目录和已准备版本均不存在', { recoverable: true })
        }
        await rename(input.stagingAbsolutePath, input.finalAbsolutePath)
      }
      if (
        !(await pathExists(path.join(input.finalAbsolutePath, 'media'))) ||
        !(await pathExists(path.join(input.finalAbsolutePath, 'manifest.json')))
      ) {
        throw new ArchiveError('MEDIA_INVALID', '已准备的归档版本不完整', { recoverable: true })
      }
    },
    { maxWait: 10_000, timeout: 30_000 }
  )
}

async function assertPublishLease(
  tx: ArchiveTransactionClient,
  importId: string,
  jobId: string,
  leaseAttempt: number
): Promise<void> {
  const job = await tx.systemJob.updateMany({
    where: { id: jobId, attempt: leaseAttempt, status: 'RUNNING' },
    data: { heartbeatAt: new Date() }
  })
  if (job.count !== 1) throw new ArchiveError('LEASE_LOST', '归档 Worker 租约已失效')
  const archiveImport = await tx.archiveImport.updateMany({
    where: { id: importId, systemJobId: jobId, status: 'RUNNING' },
    data: { retainUntil: null }
  })
  if (archiveImport.count !== 1) throw stateConflict('归档任务已不再允许运行')
}

function stateConflict(message: string): ArchiveError {
  return new ArchiveError('STATE_CONFLICT', message, { recoverable: true })
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
