import { createHash } from 'node:crypto'
import {
  ackMediaContentUploadChunk,
  prepareMediaContentUploadChunk,
  markMediaContentWriteRecoveryRequired
} from '@pixishelf/db'
import type { ContentWriteAuthorization, MediaUploadReceipt } from '@/schemas/media-content.dto'
import {
  assertContentAccount,
  beginContentUpload,
  contentAuthorization,
  contentHandle,
  contentOwner,
  contentTx,
  publishContentOwner,
  requireContentReady
} from './content-source-guard'
import fs from 'fs/promises'
import { constants } from 'node:fs'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { isVideoFile } from '@/lib/media'
import { buildCanonicalChapterFileName, isChapterManifestFileName } from '@/utils/artwork/video-chapter-files'
import {
  discoverChaptersForVideoInScanRoot,
  getChapterPathCandidates,
  resolveCanonicalChapterPath,
  validateChapterManifest
} from './video-chapters'
import { determineArtworkRelDir } from './utils'
import { assertReplaceBackupProtectsUpload } from './image-replace-session'
import { ReplaceWriteBusyError, withReplaceWriteLock } from './replace-write-lock'

export const MAX_CHAPTER_UPLOAD_SIZE_BYTES = 5 * 1024 * 1024

export type MediaChapterUploadInput = {
  scanRoot: string
  userId: string
  expectedUserId: string
  authorization?: ContentWriteAuthorization
  uploadSessionId: string
  uploadToken: string
  uploadRequestId: string
  uploadAuthorization?: ContentWriteAuthorization
  artworkId: number
  imageId: number | null
  videoPath: string
  manifestText: string | (() => Promise<string>)
}

export type MediaChapterUploadMeta = {
  uploadReceipt?: MediaUploadReceipt
  uploadSize?: number
  videoFileName: string
  chaptersFileName: string
  chaptersPath: string
  chaptersCount: number
  chaptersDuration: number
  chaptersHash: string
}

export class MediaChapterUploadError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'MediaChapterUploadError'
  }
}

export function validateMediaChapterUploadRequest(input: { artworkId: number; fileName: string; fileSize: number }) {
  const { artworkId, fileName, fileSize } = input

  if (!artworkId || Number.isNaN(artworkId)) {
    throw new MediaChapterUploadError('Invalid artworkId', 400)
  }

  if (!isChapterManifestFileName(fileName)) {
    throw new MediaChapterUploadError('Unsupported chapter manifest file name', 400)
  }

  if (fileSize > MAX_CHAPTER_UPLOAD_SIZE_BYTES) {
    throw new MediaChapterUploadError('Chapter manifest exceeds 5MB limit', 400)
  }
}

export async function uploadMediaChapterManifest(input: MediaChapterUploadInput): Promise<MediaChapterUploadMeta> {
  const { scanRoot, artworkId, imageId } = input
  assertContentAccount(input.userId, input.expectedUserId)

  const artwork = await prisma.artwork.findUnique({
    where: { id: artworkId },
    include: {
      artist: true,
      images: {
        orderBy: { sortOrder: 'asc' }
      }
    }
  })

  if (!artwork) {
    throw new MediaChapterUploadError('Artwork not found', 404)
  }

  const targetRelDir = determineArtworkRelDir(artwork)
  if (!targetRelDir) {
    throw new MediaChapterUploadError('Cannot determine artwork media directory', 400)
  }

  let videoPath = input.videoPath
  if (imageId) {
    const image = await prisma.image.findUnique({
      where: { id: imageId },
      select: { id: true, artworkId: true, path: true }
    })

    if (!image || image.artworkId !== artworkId) {
      throw new MediaChapterUploadError('Image not found for artwork', 404)
    }

    videoPath = image.path
  }

  if (!videoPath) {
    throw new MediaChapterUploadError('Missing videoPath or imageId', 400)
  }

  const normalizedVideoPath = toStoredPath(videoPath)
  if (!isVideoFile(normalizedVideoPath)) {
    throw new MediaChapterUploadError('Chapter manifest can only be attached to video media', 400)
  }

  if (!isStoredPathWithinDir(normalizedVideoPath, targetRelDir)) {
    throw new MediaChapterUploadError('Video path does not belong to artwork media directory', 400)
  }

  const manifestText = typeof input.manifestText === 'function' ? await input.manifestText() : input.manifestText
  let manifestJson: unknown
  try {
    manifestJson = JSON.parse(manifestText)
  } catch {
    throw new MediaChapterUploadError('Invalid chapter manifest JSON', 400)
  }

  let manifest
  try {
    manifest = await validateChapterManifest(manifestJson)
  } catch (error: any) {
    throw new MediaChapterUploadError(error.message || 'Invalid chapter manifest', 400)
  }

  const canonicalChaptersPath = resolveCanonicalChapterPath(normalizedVideoPath)
  const canonicalAbsolutePath = resolvePathWithinScanRoot(scanRoot, canonicalChaptersPath)
  const targetDir = resolvePathWithinScanRoot(scanRoot, targetRelDir)
  await fs.mkdir(targetDir, { recursive: true })
  try {
    return await withReplaceWriteLock(targetDir, async () => {
      const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`)
      const sessionId = input.uploadSessionId
      if (input.authorization && input.authorization.sessionId !== sessionId) {
        throw new MediaChapterUploadError('Replacement session mismatch', 409)
      }
      const upload = await beginContentUpload({
        scanRoot,
        absolutePath: canonicalAbsolutePath,
        userId: input.userId,
        sessionId,
        writeToken: input.uploadToken,
        declaredFileSize: bytes.length,
        totalChunks: 1,
        parent: input.authorization
      })
      if (!input.uploadAuthorization && upload.authorization.handle.declarationVersion !== '1') {
        throw new MediaChapterUploadError('Upload authorization required', 409)
      }
      const owned = input.uploadAuthorization ?? upload.authorization
      if (
        owned.sessionId !== sessionId ||
        owned.handle.writeToken !== input.uploadToken ||
        owned.handle.directoryId !== upload.authorization.handle.directoryId ||
        owned.handle.scope.kind !== 'PATH' ||
        owned.handle.scope.relativePath !== upload.relativePath ||
        owned.handle.parentWriteId !== (input.authorization?.handle.writeId ?? null)
      ) {
        throw new MediaChapterUploadError('Chapter upload authorization does not match target', 409)
      }
      const markIncomplete = () =>
        prisma
          .$transaction((tx) =>
            markMediaContentWriteRecoveryRequired(contentTx(tx), {
              owner: contentOwner(input.userId, sessionId),
              handle: contentHandle(owned),
              failureCode: 'CHAPTER_UPLOAD_INCOMPLETE',
              now: new Date()
            })
          )
          .catch(() => undefined)
      const hash = createHash('sha256').update(bytes).digest('hex')
      const observed = await fs.stat(canonicalAbsolutePath, { bigint: true }).catch((error) => {
        if (error.code === 'ENOENT') return null
        throw error
      })
      const prepared = await prisma.$transaction(async (tx) =>
        requireContentReady(
          await prepareMediaContentUploadChunk(contentTx(tx), {
            owner: contentOwner(input.userId, sessionId),
            handle: contentHandle(owned),
            declaredFileSize: BigInt(bytes.length),
            totalChunks: 1,
            requestId: input.uploadRequestId,
            chunkIndex: 0,
            offset: 0n,
            observedFileSize: observed?.size ?? null
          })
        )
      )
      if (prepared.action === 'REPLAY' && prepared.checkpoint.lastReceipt?.sha256 !== hash) {
        throw new MediaChapterUploadError('Chapter content differs from saved upload', 409)
      }
      const candidates = getChapterPathCandidates(normalizedVideoPath)
      for (const candidate of candidates) {
        await assertReplaceBackupProtectsUpload(targetDir, path.basename(candidate))
      }
      if (prepared.action === 'WRITE') {
        try {
          await fs.mkdir(path.dirname(canonicalAbsolutePath), { recursive: true })
          const file = await fs.open(
            canonicalAbsolutePath,
            constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW,
            0o600
          )
          try {
            const state = await file.stat()
            if (!state.isFile() || state.nlink !== 1) {
              throw new MediaChapterUploadError('Chapter target is shared or unsafe', 409)
            }
            await file.truncate(0)
            await file.writeFile(bytes)
            await file.sync()
          } finally {
            await file.close()
          }
        } catch (error) {
          await markIncomplete()
          throw error
        }
      }

      const chaptersMeta = await discoverChaptersForVideoInScanRoot(scanRoot, normalizedVideoPath).catch(
        async (error) => {
          if (prepared.action === 'WRITE') await markIncomplete()
          throw error
        }
      )
      if (!chaptersMeta) {
        if (prepared.action === 'WRITE') await markIncomplete()
        throw new MediaChapterUploadError('Failed to discover uploaded chapter manifest', 500)
      }

      const receipt = {
        requestId: input.uploadRequestId,
        chunkIndex: 0,
        offset: 0n,
        byteLength: BigInt(bytes.length),
        sha256: createHash('sha256').update(bytes).digest('hex')
      }
      const checkpoint =
        prepared.action === 'REPLAY'
          ? prepared.checkpoint
          : await prisma
              .$transaction(async (tx) =>
                requireContentReady(
                  await ackMediaContentUploadChunk(contentTx(tx), {
                    owner: contentOwner(input.userId, sessionId),
                    handle: contentHandle(owned),
                    receipt,
                    verifiedFileSize: BigInt(bytes.length),
                    now: new Date()
                  })
                )
              )
              .catch(async (error) => {
                await markIncomplete()
                throw error
              })
      const authorization = contentAuthorization(sessionId, checkpoint.handle)
      if (imageId && !input.authorization && checkpoint.status !== 'COMPLETED') {
        await prisma.$transaction((tx) =>
          publishContentOwner(tx, input.userId, [authorization], 'committed', async (inner) => {
            await inner.image.update({
              where: { id: imageId, artworkId },
              data: { ...chaptersMeta, chaptersUpdatedAt: new Date() }
            })
          })
        )
      } else if (!input.authorization && !imageId) {
        throw new MediaChapterUploadError('Replacement authorization required', 409)
      }

      return {
        videoFileName: path.posix.basename(normalizedVideoPath.replace(/\\/g, '/')),
        chaptersFileName: buildCanonicalChapterFileName(path.posix.basename(normalizedVideoPath.replace(/\\/g, '/'))),
        ...chaptersMeta,
        uploadSize: bytes.length,
        uploadReceipt: {
          authorization,
          expectedUserId: input.userId,
          receipt: { ...receipt, offset: '0', byteLength: String(bytes.length) }
        }
      }
    })
  } catch (error) {
    if (
      error instanceof ReplaceWriteBusyError ||
      (error instanceof Error && 'status' in error && error.status === 409)
    ) {
      throw new MediaChapterUploadError(error.message, 409)
    }
    throw error
  }
}

function resolvePathWithinScanRoot(scanRoot: string, relativePath: string): string {
  const normalizedRoot = path.resolve(scanRoot)
  const resolvedPath = path.resolve(normalizedRoot, relativePath.replace(/^\/+/, ''))
  const rootWithSeparator = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`

  if (resolvedPath !== normalizedRoot && !resolvedPath.toLowerCase().startsWith(rootWithSeparator.toLowerCase())) {
    throw new Error(`Path escapes scan root: ${relativePath}`)
  }

  return resolvedPath
}

function toStoredPath(input: string): string {
  const normalizedPath = input.replace(/\\/g, '/')
  return normalizedPath.startsWith('/') ? normalizedPath : `/${normalizedPath}`
}

function isStoredPathWithinDir(storedPath: string, storedDir: string): boolean {
  const normalizedPath = toStoredPath(storedPath)
  const normalizedDir = toStoredPath(storedDir).replace(/\/+$/, '')
  return normalizedPath === normalizedDir || normalizedPath.startsWith(`${normalizedDir}/`)
}
