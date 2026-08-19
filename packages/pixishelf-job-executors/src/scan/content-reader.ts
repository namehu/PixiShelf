import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { ScanExecutorError } from './errors.ts'
import { throwIfAborted } from './bounded.ts'

const READ_CHUNK_BYTES = 64 * 1024

export interface StableFileContent {
  bytes: Buffer
  sha256: string
  size: number
}

export async function readStableFileContent(input: {
  absolutePath: string
  maxBytes: number
  signal: AbortSignal
}): Promise<StableFileContent> {
  const result = await readOrHashStableFile({ ...input, collectBytes: true })
  return { ...result, bytes: result.bytes! }
}

export async function hashStableFile(input: {
  absolutePath: string
  maxBytes: number
  signal: AbortSignal
}): Promise<{ sha256: string; size: number }> {
  const result = await readOrHashStableFile({ ...input, collectBytes: false })
  return { sha256: result.sha256, size: result.size }
}

async function readOrHashStableFile(input: {
  absolutePath: string
  maxBytes: number
  signal: AbortSignal
  collectBytes: boolean
}): Promise<{ bytes?: Buffer; sha256: string; size: number }> {
  if (!Number.isSafeInteger(input.maxBytes) || input.maxBytes < 1) {
    throw new ScanExecutorError('CONFIGURATION_INVALID', 'File read limit must be a positive integer')
  }
  throwIfAborted(input.signal)
  let handle: fs.FileHandle
  try {
    handle = await fs.open(input.absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  } catch (error) {
    if (nodeErrorCode(error) === 'ELOOP') {
      throw new ScanExecutorError('SYMLINK_NOT_ALLOWED', 'Input file must not be a symbolic link')
    }
    throw new ScanExecutorError('SOURCE_NOT_READABLE', 'Input file could not be opened')
  }
  try {
    const before = await handle.stat()
    if (!before.isFile()) throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Input is not a regular file')
    if (before.size > input.maxBytes) {
      throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Input file exceeds the configured byte limit')
    }
    const chunks: Buffer[] = []
    const hash = createHash('sha256')
    let offset = 0
    while (offset < before.size) {
      throwIfAborted(input.signal)
      const length = Math.min(READ_CHUNK_BYTES, before.size - offset)
      const buffer = Buffer.allocUnsafe(length)
      const { bytesRead } = await handle.read(buffer, 0, length, offset)
      if (bytesRead === 0) break
      const chunk = bytesRead === length ? buffer : buffer.subarray(0, bytesRead)
      if (input.collectBytes) chunks.push(chunk)
      hash.update(chunk)
      offset += bytesRead
      if (offset > input.maxBytes) {
        throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Input file exceeds the configured byte limit')
      }
    }
    const after = await handle.stat()
    if (offset !== before.size || !sameFileState(before, after)) {
      throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Input file changed while it was being read')
    }
    const pathMetadata = await fs.lstat(input.absolutePath)
    if (pathMetadata.isSymbolicLink()) {
      throw new ScanExecutorError('SYMLINK_NOT_ALLOWED', 'Input file became a symbolic link')
    }
    const finalPath = await fs.realpath(input.absolutePath)
    if (finalPath !== input.absolutePath) {
      throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Input file path changed while it was being read')
    }
    return {
      ...(input.collectBytes ? { bytes: Buffer.concat(chunks, offset) } : {}),
      sha256: hash.digest('hex'),
      size: offset
    }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

function sameFileState(
  left: Awaited<ReturnType<fs.FileHandle['stat']>>,
  right: Awaited<ReturnType<fs.FileHandle['stat']>>
) {
  return (
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  )
}

function nodeErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
}
