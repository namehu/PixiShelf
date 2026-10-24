import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { Readable } from 'node:stream'
import sharp from 'sharp'
import {
  ackMediaContentUploadChunk,
  restartMediaContentUploadFromStart,
  getMediaContentUploadCheckpoint,
  markMediaContentWriteRecoveryRequired,
  prepareMediaContentUploadChunk
} from '@pixishelf/db'
import { prisma } from '@/lib/prisma'
import { MEDIA_EXTENSIONS, VIDEO_EXTENSIONS } from '@/lib/constant'
import { assertSafeFileName, resolveCreatablePathWithinRoot, UnsafePathError } from '@/lib/safe-path'
import { MAX_MEDIA_UPLOAD_SIZE_BYTES, MAX_MEDIA_UPLOAD_SIZE_LABEL } from '@/lib/upload-limits'
import { extractOrderFromName } from '@/utils/artwork/extract-order-from-name'
import type { ContentWriteAuthorization, MediaUploadReceipt } from '@/schemas/media-content.dto'
import type { ImageMeta } from './image-manager'
import { beginAnimationSourcePathWrite } from './animation-source-guard'
import { beginSummaryPathWrite } from './summary-source-guard'
import { assertReplaceBackupProtectsUpload } from './image-replace-session'
import { ReplaceWriteBusyError, withReplaceWriteLock } from './replace-write-lock'
import {
  assertContentAccount,
  beginContentUpload,
  contentAuthorization,
  contentHandle,
  contentOwner,
  contentTx,
  ContentWriteConflict,
  requireContentReady,
  resolveContentPath
} from './content-source-guard'

export type MediaUploadChunkInput = {
  scanRoot: string
  fileName: string
  targetDir: string
  targetRelDir: string
  chunkIndex: number
  totalChunks: number
  offset: number
  declaredFileSize: number | null
  body: NodeJS.ReadableStream | null
  userId: string
  expectedUserId: string
  sessionId: string
  writeToken: string
  requestId: string
  authorization?: ContentWriteAuthorization
  parent?: ContentWriteAuthorization
}
export type MediaUploadChunkResult = {
  type: 'chunk' | 'final'
  authorization: ContentWriteAuthorization
  nextChunkIndex: number
  committedBytes: number
  meta?: ImageMeta[]
}
export type MediaUploadStatusInput = {
  scanRoot: string
  fileName: string
  targetDir: string
  userId: string
  expectedUserId: string
  sessionId: string
  writeToken: string
}
export type MediaUploadStatus = {
  exists: boolean
  size: number
  authorization?: ContentWriteAuthorization
  nextChunkIndex?: number
  status?: string
}
export class MediaUploadError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message)
    this.name = 'MediaUploadError'
  }
}
export function validateMediaUploadStatusMetadata(fileName: string) {
  try {
    assertSafeFileName(fileName)
  } catch (error) {
    if (error instanceof UnsafePathError) throw new MediaUploadError('Invalid file name', 400)
    throw error
  }
}
export function validateMediaUploadChunkMetadata(input: { fileName: string; declaredFileSize: number | null }) {
  validateMediaUploadStatusMetadata(input.fileName)
  if (!MEDIA_EXTENSIONS.includes(path.extname(input.fileName).toLowerCase())) {
    throw new MediaUploadError('Unsupported file extension', 400)
  }
  if (!Number.isSafeInteger(input.declaredFileSize) || input.declaredFileSize! <= 0) {
    throw new MediaUploadError('Invalid declared file size', 400)
  }
  if (input.declaredFileSize! > MAX_MEDIA_UPLOAD_SIZE_BYTES) {
    throw new MediaUploadError(`File size exceeds limit (${MAX_MEDIA_UPLOAD_SIZE_LABEL})`, 400)
  }
}

export async function handleMediaUploadChunk(input: MediaUploadChunkInput): Promise<MediaUploadChunkResult> {
  validateMediaUploadChunkMetadata(input)
  assertContentAccount(input.userId, input.expectedUserId)
  if (
    !Number.isSafeInteger(input.offset) ||
    input.offset < 0 ||
    !Number.isInteger(input.chunkIndex) ||
    input.chunkIndex < 0 ||
    !Number.isInteger(input.totalChunks) ||
    input.totalChunks < 1 ||
    input.chunkIndex >= input.totalChunks ||
    input.offset >= input.declaredFileSize!
  ) {
    throw new MediaUploadError('Invalid chunk sequence', 400)
  }
  if (!input.body) throw new MediaUploadError('No body provided', 400)
  const { resolvedTargetDir, filePath } = await resolveUploadPaths(input.scanRoot, input.targetDir, input.fileName)
  await fsPromises.mkdir(resolvedTargetDir, { recursive: true })
  let waitingError: Error | null = null
  const onError = (error: Error) => {
    waitingError = error
  }
  input.body.on('error', onError)
  try {
    return await withReplaceWriteLock(
      resolvedTargetDir,
      async () => {
        if (waitingError || isUnavailable(input.body)) {
          throw new MediaUploadError('Upload body ended while waiting for the media write lock', 409)
        }
        await assertReplaceBackupProtectsUpload(resolvedTargetDir, input.fileName)
        const context = await beginContentUpload({
          ...input,
          absolutePath: filePath,
          declaredFileSize: input.declaredFileSize!
        })
        if (!input.authorization && context.authorization.handle.declarationVersion !== '1') {
          throw new MediaUploadError('原上传已推进，请用自己的检查点授权重试。', 409)
        }
        let auth = input.authorization ?? context.authorization
        if (
          auth.sessionId !== input.sessionId ||
          auth.handle.writeToken !== input.writeToken ||
          auth.handle.scope.kind !== 'PATH' ||
          auth.handle.scope.relativePath !== context.relativePath
        ) {
          throw new MediaUploadError('Upload session does not match target', 409)
        }
        const owner = contentOwner(input.userId, input.sessionId)
        const observed = await statRegular(filePath)
        const prepared = await prisma.$transaction(async (tx) =>
          requireContentReady(
            await prepareMediaContentUploadChunk(contentTx(tx), {
              owner,
              handle: contentHandle(auth),
              declaredFileSize: BigInt(input.declaredFileSize!),
              totalChunks: input.totalChunks,
              requestId: input.requestId,
              chunkIndex: input.chunkIndex,
              offset: BigInt(input.offset),
              observedFileSize: observed?.size ?? null
            })
          )
        )
        let checkpoint = prepared.checkpoint
        let meta: ImageMeta | undefined
        if (prepared.action === 'WRITE') {
          if (input.chunkIndex === 0 && !input.parent) {
            await beginAnimationSourcePathWrite(context.relativePath)
            await beginSummaryPathWrite(context.relativePath)
          }
          try {
            const receipt = await writeChunk(input, filePath)
            if (input.chunkIndex === input.totalChunks - 1) {
              meta = await readUploadMetadata(filePath, context.relativePath, input.fileName)
              if (BigInt(meta.size) !== BigInt(input.declaredFileSize!)) {
                throw new MediaUploadError('Uploaded file changed before publication', 409)
              }
            }
            checkpoint = await prisma.$transaction(async (tx) =>
              requireContentReady(
                await ackMediaContentUploadChunk(contentTx(tx), {
                  owner,
                  handle: contentHandle(auth),
                  receipt,
                  verifiedFileSize: BigInt(input.offset) + receipt.byteLength,
                  now: new Date()
                })
              )
            )
          } catch (error) {
            await prisma
              .$transaction((tx) =>
                markMediaContentWriteRecoveryRequired(contentTx(tx), {
                  owner,
                  handle: contentHandle(auth),
                  failureCode: 'UPLOAD_INCOMPLETE',
                  now: new Date()
                })
              )
              .catch(() => undefined)
            throw error
          }
        } else {
          // Drain a replay body without ever opening the already acknowledged file for writing.
          input.body!.resume()
        }
        auth = contentAuthorization(input.sessionId, checkpoint.handle)
        if (checkpoint.status !== 'READY' && checkpoint.status !== 'COMPLETED') {
          return {
            type: 'chunk',
            authorization: auth,
            nextChunkIndex: checkpoint.nextChunkIndex,
            committedBytes: Number(checkpoint.committedBytes)
          }
        }
        try {
          meta ??= await readUploadMetadata(filePath, context.relativePath, input.fileName)
          if (BigInt(meta.size) !== checkpoint.declaredFileSize || !checkpoint.lastReceipt) {
            throw new MediaUploadError('Uploaded file changed before publication', 409)
          }
        } catch (error) {
          if (checkpoint.status === 'READY') {
            await prisma
              .$transaction((tx) =>
                markMediaContentWriteRecoveryRequired(contentTx(tx), {
                  owner,
                  handle: checkpoint.handle,
                  failureCode: 'UPLOAD_METADATA_INVALID',
                  now: new Date()
                })
              )
              .catch(() => undefined)
          }
          throw error
        }
        const receipt = checkpoint.lastReceipt
        meta.uploadReceipt = {
          authorization:
            checkpoint.status === 'COMPLETED'
              ? contentAuthorization(input.sessionId, {
                  ...checkpoint.handle,
                  declarationVersion: checkpoint.handle.declarationVersion - 1n
                })
              : auth,
          expectedUserId: input.userId,
          receipt: { ...receipt, offset: receipt.offset.toString(), byteLength: receipt.byteLength.toString() }
        } satisfies MediaUploadReceipt
        return {
          type: 'final',
          authorization: auth,
          nextChunkIndex: checkpoint.nextChunkIndex,
          committedBytes: Number(checkpoint.committedBytes),
          meta: [meta]
        }
      },
      { isCancelled: () => waitingError !== null || isUnavailable(input.body) }
    )
  } catch (error) {
    if (error instanceof ReplaceWriteBusyError || error instanceof ContentWriteConflict) {
      throw new MediaUploadError(error.message, 409)
    }
    throw error
  } finally {
    input.body.removeListener('error', onError)
  }
}

async function writeChunk(input: MediaUploadChunkInput, filePath: string) {
  const digest = createHash('sha256')
  let byteLength = 0n
  const limit = BigInt(input.declaredFileSize! - input.offset)
  const flags =
    (input.chunkIndex === 0 ? fs.constants.O_WRONLY | fs.constants.O_CREAT : fs.constants.O_WRONLY) |
    fs.constants.O_NOFOLLOW
  const file = await fsPromises.open(filePath, flags, 0o600)
  try {
    const initial = await file.stat({ bigint: true })
    if (!initial.isFile() || initial.nlink !== 1n) throw new MediaUploadError('Target is shared or unsafe', 409)
    if (input.chunkIndex === 0) await file.truncate(0)
    for await (const value of input.body as Readable) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      if (byteLength + BigInt(chunk.length) > limit || byteLength + BigInt(chunk.length) > 10n * 1024n * 1024n) {
        throw new MediaUploadError('Chunk exceeds declared size', 400)
      }
      let written = 0
      while (written < chunk.length) {
        const result = await file.write(
          chunk,
          written,
          chunk.length - written,
          input.offset + Number(byteLength) + written
        )
        if (result.bytesWritten <= 0) throw new MediaUploadError('Upload write made no progress', 409)
        written += result.bytesWritten
      }
      byteLength += BigInt(chunk.length)
      digest.update(chunk)
    }
    if (byteLength === 0n) throw new MediaUploadError('Empty upload chunk', 400)
    const state = await file.stat({ bigint: true })
    if (!state.isFile() || state.size !== BigInt(input.offset) + byteLength) {
      throw new MediaUploadError('Uploaded size does not match chunk', 409)
    }
    await file.sync()
  } finally {
    await file.close()
  }
  return {
    requestId: input.requestId,
    chunkIndex: input.chunkIndex,
    offset: BigInt(input.offset),
    byteLength,
    sha256: digest.digest('hex')
  }
}
async function statRegular(filePath: string) {
  try {
    const stat = await fsPromises.lstat(filePath, { bigint: true })
    if (!stat.isFile()) throw new MediaUploadError('Target is not a regular file', 409)
    return stat
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}
async function readUploadMetadata(filePath: string, relativePath: string, fileName: string): Promise<ImageMeta> {
  const stat = await statRegular(filePath)
  if (!stat || stat.size <= 0n || stat.size > BigInt(MAX_MEDIA_UPLOAD_SIZE_BYTES)) {
    throw new MediaUploadError('Invalid uploaded media', 409)
  }
  const dimensions = VIDEO_EXTENSIONS.includes(path.extname(fileName).toLowerCase())
    ? { width: 0, height: 0 }
    : await sharp(filePath).metadata()
  return {
    fileName,
    order: extractOrderFromName(fileName),
    width: dimensions.width ?? 0,
    height: dimensions.height ?? 0,
    size: Number(stat.size),
    path: `/${relativePath}`
  }
}
function isUnavailable(body: NodeJS.ReadableStream | null) {
  const stream = body as NodeJS.ReadableStream & { destroyed?: boolean; aborted?: boolean; readableAborted?: boolean }
  return !stream || stream.destroyed === true || stream.aborted === true || stream.readableAborted === true
}
export async function getMediaUploadStatus(input: MediaUploadStatusInput): Promise<MediaUploadStatus> {
  validateMediaUploadStatusMetadata(input.fileName)
  assertContentAccount(input.userId, input.expectedUserId)
  const { filePath } = await resolveUploadPaths(input.scanRoot, input.targetDir, input.fileName)
  const context = await resolveContentPath(input.scanRoot, filePath)
  return prisma.$transaction(async (tx) => {
    const row = await tx.mediaContentPathWrite.findUnique({
      where: { writeToken: input.writeToken },
      select: { id: true }
    })
    if (!row) return { exists: false, size: 0 }
    const checkpoint = requireContentReady(
      await getMediaContentUploadCheckpoint(contentTx(tx), {
        owner: contentOwner(input.userId, input.sessionId),
        writeId: row.id,
        writeToken: input.writeToken
      })
    )
    if (checkpoint.handle.scope.kind !== 'PATH' || checkpoint.handle.scope.relativePath !== context.relativePath) {
      throw new MediaUploadError('Upload session does not match target', 409)
    }
    return {
      exists: true,
      size: Number(checkpoint.committedBytes),
      nextChunkIndex: checkpoint.nextChunkIndex,
      status: checkpoint.status,
      authorization: contentAuthorization(input.sessionId, checkpoint.handle)
    }
  })
}
async function resolveUploadPaths(scanRoot: string, targetDir: string, fileName: string) {
  try {
    const resolvedTargetDir = await resolveCreatablePathWithinRoot(scanRoot, targetDir)
    const filePath = await resolveCreatablePathWithinRoot(scanRoot, path.join(resolvedTargetDir, fileName))
    return { resolvedTargetDir, filePath }
  } catch (error) {
    if (error instanceof UnsafePathError) throw new MediaUploadError('Permission denied: Invalid target path', 403)
    throw error
  }
}

export async function restartMediaUpload(
  input: MediaUploadStatusInput & { authorization: ContentWriteAuthorization }
): Promise<MediaUploadStatus> {
  validateMediaUploadStatusMetadata(input.fileName)
  assertContentAccount(input.userId, input.expectedUserId)
  const { resolvedTargetDir, filePath } = await resolveUploadPaths(input.scanRoot, input.targetDir, input.fileName)
  const context = await resolveContentPath(input.scanRoot, filePath)
  const auth = input.authorization
  if (
    auth.sessionId !== input.sessionId ||
    auth.handle.writeToken !== input.writeToken ||
    auth.handle.scope.kind !== 'PATH' ||
    auth.handle.scope.relativePath !== context.relativePath ||
    auth.handle.parentWriteId !== null
  ) {
    throw new MediaUploadError('Upload session does not match target', 409)
  }
  return withReplaceWriteLock(resolvedTargetDir, async () =>
    prisma.$transaction(async (tx) => {
      const directory = await tx.mediaContentDirectoryState.findUnique({ where: { id: auth.handle.directoryId } })
      if (
        !directory ||
        directory.rootIdentity !== context.directory.rootIdentity ||
        directory.logicalRoot !== context.directory.logicalRoot ||
        directory.relativeDirectory !== context.directory.relativeDirectory
      ) {
        throw new MediaUploadError('Media root changed', 409)
      }
      const checkpoint = requireContentReady(
        await restartMediaContentUploadFromStart(contentTx(tx), {
          owner: contentOwner(input.userId, input.sessionId),
          handle: contentHandle(auth),
          now: new Date()
        })
      )
      return {
        exists: true,
        size: 0,
        nextChunkIndex: 0,
        status: checkpoint.status,
        authorization: contentAuthorization(input.sessionId, checkpoint.handle)
      }
    })
  )
}
