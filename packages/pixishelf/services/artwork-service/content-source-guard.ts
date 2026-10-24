import 'server-only'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  lockCreatorCatalog,
  assertMediaContentDirectorySnapshot,
  beginMediaContentPathWrite,
  beginMediaContentSourceWrite,
  captureMediaContentDirectory,
  finishMediaContentSourceWrite,
  getMediaContentUploadCheckpoint,
  getMediaContentWriteHandle,
  withMediaContentOwnerPublication,
  type MediaContentDirectorySnapshot,
  type MediaContentOwner,
  type MediaContentResult,
  type MediaContentWriteHandle,
  type MediaContentTransaction,
  type MediaContentChunkReceipt
} from '@pixishelf/db'
import { resolveMediaContentRoots, resolveMediaContentPath } from '@pixishelf/job-executors/media-content'
import { prisma, type AppTransaction } from '@/lib/prisma'
import { resolveCreatablePathWithinRoot } from '@/lib/safe-path'
import type { ContentWriteAuthorization, MediaUploadReceipt } from '@/schemas/media-content.dto'
import { groupLogicalMedia } from './logical-media'

export class ContentWriteConflict extends Error {
  readonly status = 409
  constructor(message = '媒体状态已变化或正在写入，请刷新后重试。') {
    super(message)
  }
}
export function requireContentReady<T>(result: MediaContentResult<T>): T {
  if (result.status !== 'READY') throw new ContentWriteConflict(`媒体暂不可操作（${result.status}）。`)
  return result.value
}
export const contentTx = (tx: AppTransaction) => tx as unknown as MediaContentTransaction
export const contentOwner = (userId: string, sessionId: string): MediaContentOwner => ({
  ownerUserId: userId,
  sessionId,
  sessionVersion: 1n,
  execution: null
})
export const contentHandle = (auth: ContentWriteAuthorization): MediaContentWriteHandle => ({
  ...auth.handle,
  declarationVersion: BigInt(auth.handle.declarationVersion)
})
export const contentAuthorization = (
  sessionId: string,
  handle: MediaContentWriteHandle
): ContentWriteAuthorization => ({
  sessionId,
  handle: { ...handle, declarationVersion: handle.declarationVersion.toString() }
})
export const contentReceipt = (receipt: MediaUploadReceipt['receipt']): MediaContentChunkReceipt => ({
  ...receipt,
  offset: BigInt(receipt.offset),
  byteLength: BigInt(receipt.byteLength)
})
export function assertContentAccount(userId: string, expectedUserId: string) {
  if (userId !== expectedUserId) throw new ContentWriteConflict('账户已切换，请刷新后重试。')
}

export async function resolveContentPath(scanRoot: string, target: string) {
  const inventory = await prisma.pixivMetadataInventoryState.findUnique({
    where: { id: 'pixiv' },
    select: { rootIdentity: true }
  })
  const roots = await resolveMediaContentRoots({
    sourceRoot: scanRoot,
    archiveRoot: process.env.ARCHIVE_STORAGE_PATH?.trim() || scanRoot,
    expectedPixivRootIdentity: inventory?.rootIdentity ?? null
  })
  const configuredTarget = await resolveCreatablePathWithinRoot(scanRoot, target)
  const relativePath = path.relative(path.resolve(scanRoot), configuredTarget).split(path.sep).join('/')
  const { absolutePath } = await resolveMediaContentPath(roots.source, relativePath, {
    allowMissing: true,
    kind: 'file'
  })
  if (!relativePath || relativePath.startsWith('../')) throw new ContentWriteConflict('无效的媒体路径。')
  const relativeDirectory = path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath)
  return {
    absolutePath,
    relativePath,
    directory: { logicalRoot: roots.source.logicalRoot, rootIdentity: roots.source.rootIdentity, relativeDirectory }
  }
}

export async function captureContentDirectory(
  scanRoot: string,
  relativeDirectory: string
): Promise<MediaContentDirectorySnapshot> {
  const context = await resolveContentPath(
    scanRoot,
    path.join(relativeDirectory.replace(/^\/+/, ''), '.directory-identity')
  )
  return prisma.$transaction(async (tx) =>
    requireContentReady(await captureMediaContentDirectory(contentTx(tx), { directory: context.directory }))
  )
}
export async function assertContentScan(tx: AppTransaction, snapshots: readonly MediaContentDirectorySnapshot[]) {
  const unique = [...new Map(snapshots.map((item) => [item.directoryId, item])).values()].sort((a, b) =>
    `${a.logicalRoot}:${a.relativeDirectory}`.localeCompare(`${b.logicalRoot}:${b.relativeDirectory}`)
  )
  for (const snapshot of unique) {
    requireContentReady(await assertMediaContentDirectorySnapshot(contentTx(tx), { snapshot }))
  }
}

export async function beginContentUpload(input: {
  scanRoot: string
  absolutePath: string
  userId: string
  sessionId: string
  writeToken: string
  declaredFileSize: number | null
  totalChunks: number | null
  parent?: ContentWriteAuthorization
  relatedImage?: { imageId: number; artworkId: number; path: string }
}) {
  const context = await resolveContentPath(input.scanRoot, input.absolutePath)
  const owner = contentOwner(input.userId, input.sessionId)
  const handle = await prisma.$transaction(async (tx) => {
    await lockCreatorCatalog(contentTx(tx))
    const previous = await tx.mediaContentPathWrite.findUnique({
      where: { writeToken: input.writeToken },
      select: { id: true, status: true }
    })
    if (previous?.status === 'COMPLETED') {
      const checkpoint = requireContentReady(
        await getMediaContentUploadCheckpoint(contentTx(tx), {
          owner,
          writeId: previous.id,
          writeToken: input.writeToken
        })
      )
      const directory = await tx.mediaContentDirectoryState.findUnique({ where: { id: checkpoint.handle.directoryId } })
      if (
        checkpoint.handle.scope.kind !== 'PATH' ||
        checkpoint.handle.scope.relativePath !== context.relativePath ||
        directory?.rootIdentity !== context.directory.rootIdentity ||
        checkpoint.handle.parentWriteId !== (input.parent?.handle.writeId ?? null) ||
        checkpoint.declaredFileSize !== (input.declaredFileSize === null ? null : BigInt(input.declaredFileSize)) ||
        checkpoint.totalChunks !== input.totalChunks
      ) {
        throw new ContentWriteConflict()
      }
      return checkpoint.handle
    }
    const handle = requireContentReady(
      await beginMediaContentPathWrite(contentTx(tx), {
        directory: context.directory,
        scope: { kind: 'PATH', relativePath: context.relativePath },
        owner,
        writeToken: input.writeToken,
        parent: input.parent ? contentHandle(input.parent) : null,
        upload:
          input.declaredFileSize === null
            ? null
            : { declaredFileSize: BigInt(input.declaredFileSize), totalChunks: input.totalChunks! },
        now: new Date()
      })
    )
    if (input.parent) {
      if (input.parent.sessionId !== input.sessionId) throw new ContentWriteConflict()
    } else if (!previous) {
      const images = await tx.image.findMany({
        where: { OR: [
          { path: { in: [context.relativePath, `/${context.relativePath}`] } },
          ...(input.relatedImage ? [{ id: input.relatedImage.imageId }] : [])
        ] },
        select: { id: true, artworkId: true, path: true, contentSource: { select: { writeToken: true } } }
      })
      if (input.relatedImage) {
        const related = images.find((image) => image.id === input.relatedImage!.imageId)
        if (!related || related.artworkId !== input.relatedImage.artworkId || related.path !== input.relatedImage.path) {
          throw new ContentWriteConflict('章节所属媒体已变化。')
        }
      }
      const imageIds = images.filter((image) => image.contentSource?.writeToken !== input.writeToken).map((image) => image.id)
      if (imageIds.length) {
        await beginMediaContentSourceWrite(contentTx(tx), {
          artworkIds: [], imageIds, writeToken: input.writeToken, now: new Date()
        })
      }
    }
    if (previous && input.relatedImage && !input.parent) {
      const related = await tx.image.findUnique({
        where: { id: input.relatedImage.imageId },
        select: { artworkId: true, path: true, contentSource: { select: { writeToken: true } } }
      })
      if (related?.artworkId !== input.relatedImage.artworkId || related.path !== input.relatedImage.path ||
          related.contentSource?.writeToken !== input.writeToken) {
        throw new ContentWriteConflict('原章节上传没有匹配的媒体声明，请核对后重新上传。')
      }
    }
    return handle
  })
  return { ...context, authorization: contentAuthorization(input.sessionId, handle), owner }
}

export async function beginContentDirectoryWrite(input: {
  scanRoot: string
  relativeDirectory: string
  artworkId: number
  userId: string
  sessionId: string
  writeToken: string
}) {
  const context = await resolveContentPath(
    input.scanRoot,
    path.join(input.relativeDirectory.replace(/^\/+/, ''), '.directory-identity')
  )
  const owner = contentOwner(input.userId, input.sessionId)
  return prisma.$transaction(async (tx) => {
    await lockCreatorCatalog(contentTx(tx))
    const previous = await tx.mediaContentPathWrite.findUnique({
      where: { writeToken: input.writeToken },
      select: { status: true }
    })
    if (previous && !['ACTIVE', 'READY'].includes(previous.status)) throw new ContentWriteConflict('替换会话已经结束。')
    const handle = requireContentReady(
      await beginMediaContentPathWrite(contentTx(tx), {
        directory: context.directory,
        scope: { kind: 'DIRECTORY' },
        owner,
        writeToken: input.writeToken,
        upload: null,
        parent: null,
        now: new Date()
      })
    )
    const source = await tx.artworkContentSource.findUnique({
      where: { artworkId: input.artworkId },
      select: { writeToken: true }
    })
    if (source?.writeToken !== input.writeToken) {
      await beginMediaContentSourceWrite(contentTx(tx), {
        artworkIds: [input.artworkId],
        imageIds: [],
        writeToken: input.writeToken,
        now: new Date()
      })
    }
    return contentAuthorization(input.sessionId, handle)
  })
}

export async function assertContentOwner(tx: AppTransaction, userId: string, auth: ContentWriteAuthorization) {
  const handle = requireContentReady(
    await getMediaContentWriteHandle(contentTx(tx), {
      owner: contentOwner(userId, auth.sessionId),
      writeId: auth.handle.writeId,
      writeToken: auth.handle.writeToken
    })
  )
  if (
    handle.declarationVersion !== BigInt(auth.handle.declarationVersion) ||
    handle.directoryId !== auth.handle.directoryId ||
    JSON.stringify(handle.scope) !== JSON.stringify(auth.handle.scope) ||
    handle.parentWriteId !== auth.handle.parentWriteId
  ) {
    throw new ContentWriteConflict()
  }
  return handle
}

export async function finishContentSources(
  tx: AppTransaction,
  writeToken: string,
  outcome: 'committed' | 'verified-rollback'
) {
  const [artworks, images] = await Promise.all([
    tx.artworkContentSource.findMany({ where: { writeToken }, select: { artworkId: true } }),
    tx.mediaContentSource.findMany({ where: { writeToken }, select: { imageId: true } })
  ])
  for (let i = 0; i < Math.max(artworks.length, images.length); i += 100) {
    const ok = await finishMediaContentSourceWrite(contentTx(tx), {
      token: {
        writeToken,
        artworkIds: artworks.slice(i, i + 100).map((row) => row.artworkId),
        imageIds: images.slice(i, i + 100).map((row) => row.imageId)
      },
      outcome
    })
    if (!ok) throw new ContentWriteConflict()
  }
}

export async function publishContentOwner<T>(
  tx: AppTransaction,
  userId: string,
  authorizations: ContentWriteAuthorization[],
  outcome: 'committed' | 'verified-rollback',
  publish: (tx: AppTransaction) => Promise<T>
) {
  if (!authorizations.length || authorizations.some((auth) => auth.sessionId !== authorizations[0]!.sessionId)) {
    throw new ContentWriteConflict()
  }
  await lockCreatorCatalog(contentTx(tx))
  const result = await withMediaContentOwnerPublication(
    contentTx(tx),
    {
      owner: contentOwner(userId, authorizations[0]!.sessionId),
      handles: authorizations.map(contentHandle),
      outcome,
      now: new Date()
    },
    async (inner) => {
      const value = await publish(inner as unknown as AppTransaction)
      for (const auth of authorizations) {
        await finishContentSources(inner as unknown as AppTransaction, auth.handle.writeToken, outcome)
      }
      return value
    }
  )
  return result.result
}

export async function verifyUploadReceipt(
  tx: AppTransaction,
  userId: string,
  receipt: MediaUploadReceipt,
  sourcePath: string,
  file: { size: number; resolvedChild?: boolean }
) {
  assertContentAccount(userId, receipt.expectedUserId)
  const auth = receipt.authorization
  const checkpoint = requireContentReady(
    await getMediaContentUploadCheckpoint(contentTx(tx), {
      owner: contentOwner(userId, auth.sessionId),
      writeId: auth.handle.writeId,
      writeToken: auth.handle.writeToken
    })
  )
  const expected = contentReceipt(receipt.receipt)
  const actual = checkpoint.lastReceipt
  if (
    !['READY', 'COMPLETED'].includes(checkpoint.status) ||
    checkpoint.handle.declarationVersion !==
      BigInt(auth.handle.declarationVersion) + (checkpoint.status === 'COMPLETED' || file.resolvedChild ? 1n : 0n) ||
    checkpoint.handle.scope.kind !== 'PATH' ||
    checkpoint.handle.scope.relativePath !== sourcePath.replace(/^\/+/, '') ||
    checkpoint.declaredFileSize !== BigInt(file.size) ||
    !actual ||
    actual.requestId !== expected.requestId ||
    actual.chunkIndex !== expected.chunkIndex ||
    actual.offset !== expected.offset ||
    actual.byteLength !== expected.byteLength ||
    actual.sha256 !== expected.sha256
  ) {
    throw new ContentWriteConflict('上传回执已失效，请重新核对上传结果。')
  }
  return checkpoint
}

export async function retireContentPathMarks(tx: AppTransaction, sourcePath: string) {
  const normalized = sourcePath.replace(/^\/+/, '')
  const affected = await tx.image.findMany({
    where: { path: { in: [normalized, `/${normalized}`] } },
    select: { id: true, artworkId: true }
  })
  const ids = [...new Set(affected.flatMap((row) => (row.artworkId === null ? [] : [row.artworkId])))]
  const images = await tx.image.findMany({
    where: { artworkId: { in: ids } },
    select: { id: true, artworkId: true, path: true, mediaType: true }
  })
  const affectedIds = new Set(affected.map((image) => image.id))
  const markIds = ids.flatMap((id) =>
    groupLogicalMedia(images.filter((image) => image.artworkId === id))
      .filter((group) => group.members.some((image) => affectedIds.has(image.id)))
      .flatMap((group) => group.members.map((image) => image.id))
  )
  if (markIds.length) await tx.mediaMark.updateMany({ where: { mediaId: { in: markIds } }, data: { mediaId: null } })
}

export function newContentSession() {
  return { sessionId: randomUUID(), writeToken: randomUUID() }
}

export async function finishLegacyContentGuards(
  tx: AppTransaction,
  input: { artworkId?: number; sourcePath?: string }
) {
  const normalized = input.sourcePath?.replace(/^\/+/, '')
  const imageWhere = input.artworkId
    ? { artworkId: input.artworkId }
    : { path: { in: [normalized!, `/${normalized}`] } }
  await tx.artworkSummaryFeature.updateMany({
    where: { image: imageWhere, writeInProgress: true },
    data: { writeInProgress: false, sourceKey: null }
  })
  await tx.imageAnimationMetadata.updateMany({
    where: { image: imageWhere, writeInProgress: true },
    data: { writeInProgress: false }
  })
  if (input.artworkId) {
    await tx.artworkSummary.updateMany({
      where: { artworkId: input.artworkId },
      data: { replaceInProgress: false, sourceRevision: { increment: 1 } }
    })
  }
}
