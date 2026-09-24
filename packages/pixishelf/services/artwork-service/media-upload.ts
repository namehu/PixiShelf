import fs from 'fs'
import path from 'path'
import sharp from 'sharp'
import { MEDIA_EXTENSIONS, VIDEO_EXTENSIONS } from '@/lib/constant'
import { assertSafeFileName, resolveCreatablePathWithinRoot, UnsafePathError } from '@/lib/safe-path'
import { MAX_MEDIA_UPLOAD_SIZE_BYTES, MAX_MEDIA_UPLOAD_SIZE_LABEL } from '@/lib/upload-limits'
import { extractOrderFromName } from '@/utils/artwork/extract-order-from-name'
import { ImageMeta } from './image-manager'
import { beginAnimationSourcePathWrite, finishAnimationSourcePathWrite } from './animation-source-guard'
import { assertReplaceBackupProtectsUpload } from './image-replace-session'
import { ReplaceWriteBusyError, withReplaceWriteLock } from './replace-write-lock'

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
}

export type MediaUploadChunkResult =
  | {
      type: 'chunk'
    }
  | {
      type: 'final'
      meta: ImageMeta[]
    }

export type MediaUploadStatusInput = {
  scanRoot: string
  fileName: string
  targetDir: string
}

export type MediaUploadStatus = {
  exists: boolean
  size: number
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

export function validateMediaUploadChunkMetadata(input: { fileName: string; declaredFileSize: number | null }) {
  const { fileName, declaredFileSize } = input
  try {
    assertSafeFileName(fileName)
  } catch (error) {
    if (error instanceof UnsafePathError) {
      throw new MediaUploadError('Invalid file name', 400)
    }
    throw error
  }

  const ext = path.extname(fileName).toLowerCase()
  if (!MEDIA_EXTENSIONS.includes(ext)) {
    throw new MediaUploadError('Unsupported file extension', 400)
  }

  if (declaredFileSize !== null && declaredFileSize > MAX_MEDIA_UPLOAD_SIZE_BYTES) {
    throw new MediaUploadError(`File size exceeds limit (${MAX_MEDIA_UPLOAD_SIZE_LABEL})`, 400)
  }
}

export function validateMediaUploadStatusMetadata(fileName: string) {
  try {
    assertSafeFileName(fileName)
  } catch (error) {
    if (error instanceof UnsafePathError) {
      throw new MediaUploadError('Invalid file name', 400)
    }
    throw error
  }
}

export async function handleMediaUploadChunk(input: MediaUploadChunkInput): Promise<MediaUploadChunkResult> {
  const { scanRoot, fileName, targetDir, declaredFileSize } = input
  validateMediaUploadChunkMetadata({ fileName, declaredFileSize })
  const ext = path.extname(fileName).toLowerCase()
  const { resolvedTargetDir, filePath } = await resolveUploadPaths(scanRoot, targetDir, fileName, {
    unsafePathMessage: 'Permission denied: Invalid target path'
  })

  fs.mkdirSync(resolvedTargetDir, { recursive: true })
  let waitingBodyError: Error | null = null
  const onWaitingBodyError = (error: Error) => { waitingBodyError = error }
  input.body?.on('error', onWaitingBodyError)

  try {
    return await withReplaceWriteLock(resolvedTargetDir, async () => {
      if (waitingBodyError || isUploadBodyUnavailable(input.body)) {
        throw new MediaUploadError('Upload body ended while waiting for the media write lock', 409)
      }
      await assertReplaceBackupProtectsUpload(resolvedTargetDir, fileName)
      const storedFilePath = path.relative(scanRoot, filePath).replace(/\\/g, '/')
      const writeTokens = await beginAnimationSourcePathWrite(storedFilePath)
      const result = await writeMediaUploadChunk(input, filePath, ext)
      if (result.type === 'final' && !fs.existsSync(path.join(resolvedTargetDir, '.bak_session'))) {
        await finishAnimationSourcePathWrite(writeTokens)
      }
      return result
    }, { isCancelled: () => waitingBodyError !== null || isUploadBodyUnavailable(input.body) })
  } catch (error) {
    if (error instanceof ReplaceWriteBusyError) throw new MediaUploadError(error.message, 409)
    if (error instanceof Error && 'status' in error && error.status === 409) {
      throw new MediaUploadError(error.message, 409)
    }
    throw error
  } finally {
    input.body?.removeListener('error', onWaitingBodyError)
  }
}

async function writeMediaUploadChunk(
  input: MediaUploadChunkInput,
  filePath: string,
  ext: string
): Promise<MediaUploadChunkResult> {
  const { fileName, targetRelDir, chunkIndex, totalChunks, offset, body } = input

  if (!body) {
    throw new MediaUploadError('No body provided', 400)
  }

  const flags = chunkIndex === 0 ? 'w' : 'r+'
  const writeOptions: { flags: string; start?: number } = { flags }

  if (chunkIndex > 0) {
    writeOptions.start = offset

    if (!fs.existsSync(filePath)) {
      throw new MediaUploadError('File not found for resume', 409)
    }
  }

  if (chunkIndex === 0 && fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath)
    } catch (e) {
      console.warn('Warning: Could not delete existing file before upload', e)
    }
  }

  const writeStream = fs.createWriteStream(filePath, writeOptions)
  await new Promise<void>((resolve, reject) => {
    let finished = false
    let failure: Error | null = null
    body.on('error', (err: Error) => {
      failure = err
      writeStream.destroy(err)
    })
    body.on('close', () => {
      const readable = body as NodeJS.ReadableStream & { readableEnded?: boolean }
      if (!readable.readableEnded && !finished) writeStream.destroy(new MediaUploadError('Upload body closed before completion', 409))
    })

    writeStream.on('error', (err: Error) => { failure = err })
    writeStream.on('finish', () => { finished = true })
    writeStream.on('close', () => {
      if (failure) reject(new Error(failure.message, { cause: failure }))
      else if (finished) resolve()
      else reject(new MediaUploadError('Upload stream closed before completion', 409))
    })
    body.pipe(writeStream)
  })

  if (chunkIndex === totalChunks - 1) {
    try {
      const stats = fs.statSync(filePath)
      if (stats.size > MAX_MEDIA_UPLOAD_SIZE_BYTES) {
        fs.unlinkSync(filePath)
        throw new MediaUploadError(`File size exceeds limit (${MAX_MEDIA_UPLOAD_SIZE_LABEL})`, 400)
      }

      let width = 0
      let height = 0
      const isVideo = VIDEO_EXTENSIONS.includes(ext)

      if (!isVideo) {
        const metadata = await sharp(filePath).metadata()
        width = metadata.width || 0
        height = metadata.height || 0
      }

      const meta: ImageMeta = {
        fileName,
        order: extractOrderFromName(fileName),
        width,
        height,
        size: stats.size,
        path: path.join(targetRelDir, fileName).replace(/\\/g, '/')
      }

      return { type: 'final', meta: [meta] }
    } catch (err) {
      if (!(err instanceof MediaUploadError)) {
        console.error('Error processing image metadata:', err)
      }
      throw err
    }
  }

  return { type: 'chunk' }
}

function isUploadBodyUnavailable(body: NodeJS.ReadableStream | null): boolean {
  if (!body) return true
  const state = body as NodeJS.ReadableStream & { destroyed?: boolean; aborted?: boolean; readableAborted?: boolean }
  return state.destroyed === true || state.aborted === true || state.readableAborted === true
}

export async function getMediaUploadStatus(input: MediaUploadStatusInput): Promise<MediaUploadStatus> {
  const { scanRoot, fileName, targetDir } = input
  validateMediaUploadStatusMetadata(fileName)

  const { filePath } = await resolveUploadPaths(scanRoot, targetDir, fileName, {
    unsafePathMessage: 'Denied'
  })

  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath)
    return { exists: true, size: stats.size }
  }

  return { exists: false, size: 0 }
}

async function resolveUploadPaths(
  scanRoot: string,
  targetDir: string,
  fileName: string,
  options: { unsafePathMessage: string }
) {
  try {
    const resolvedTargetDir = await resolveCreatablePathWithinRoot(scanRoot, targetDir)
    const filePath = await resolveCreatablePathWithinRoot(scanRoot, path.join(resolvedTargetDir, fileName))
    return { resolvedTargetDir, filePath }
  } catch (error) {
    if (error instanceof UnsafePathError) {
      throw new MediaUploadError(options.unsafePathMessage, 403)
    }
    throw error
  }
}
