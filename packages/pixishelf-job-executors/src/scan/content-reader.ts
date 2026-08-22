import { createHash } from 'node:crypto'
import { constants, type BigIntStats } from 'node:fs'
import * as fs from 'node:fs/promises'
import { ScanExecutorError } from './errors.ts'
import { throwIfAborted } from './bounded.ts'

const READ_CHUNK_BYTES = 64 * 1024

export interface StableFileContent {
  bytes: Buffer
  sha256: string
  size: number
  state: StableFileState
}

export interface StableFileState {
  sizeBytes: bigint
  mtimeMs: bigint
  ctimeMs: bigint | null
  deviceId: bigint | null
  inode: bigint | null
}

// Inventory statting keeps the same no-symlink/canonical-path boundary as a full read;
// the read path later repeats these checks around the open descriptor to close the TOCTOU window.
export async function statStableFile(absolutePath: string): Promise<StableFileState> {
  let metadata: BigIntStats
  try {
    metadata = await fs.lstat(absolutePath, { bigint: true })
  } catch {
    throw new ScanExecutorError('SOURCE_NOT_READABLE', 'Input file could not be inspected')
  }
  if (metadata.isSymbolicLink()) {
    throw new ScanExecutorError('SYMLINK_NOT_ALLOWED', 'Input file must not be a symbolic link')
  }
  if (!metadata.isFile()) throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Input is not a regular file')
  const finalPath = await fs.realpath(absolutePath)
  if (finalPath !== absolutePath) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Input file path changed while it was inspected')
  }
  return stableFileStateFromMetadata(metadata)
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
}): Promise<{ sha256: string; size: number; state: StableFileState }> {
  const result = await readOrHashStableFile({ ...input, collectBytes: false })
  return { sha256: result.sha256, size: result.size, state: result.state }
}

async function readOrHashStableFile(input: {
  absolutePath: string
  maxBytes: number
  signal: AbortSignal
  collectBytes: boolean
}): Promise<{ bytes?: Buffer; sha256: string; size: number; state: StableFileState }> {
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
    const before = await handle.stat({ bigint: true })
    if (!before.isFile()) throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Input is not a regular file')
    if (before.size > BigInt(input.maxBytes)) {
      throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Input file exceeds the configured byte limit')
    }
    const expectedSize = Number(before.size)
    const chunks: Buffer[] = []
    const hash = createHash('sha256')
    let offset = 0
    while (offset < expectedSize) {
      throwIfAborted(input.signal)
      const length = Math.min(READ_CHUNK_BYTES, expectedSize - offset)
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
    const after = await handle.stat({ bigint: true })
    if (offset !== expectedSize || !sameFileState(before, after)) {
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
      size: offset,
      state: stableFileStateFromMetadata(after)
    }
  } finally {
    await handle.close().catch(() => undefined)
  }
}

export function stableFileStateFromMetadata(metadata: {
  size: number | bigint
  mtimeMs: number | bigint
  ctimeMs: number | bigint
  dev: number | bigint
  ino: number | bigint
}): StableFileState {
  return {
    sizeBytes: BigInt(metadata.size),
    mtimeMs: BigInt(Math.trunc(Number(metadata.mtimeMs))),
    ctimeMs: optionalPositiveBigInt(metadata.ctimeMs),
    deviceId: optionalPositiveBigInt(metadata.dev),
    inode: optionalPositiveBigInt(metadata.ino)
  }
}

function optionalPositiveBigInt(value: number | bigint): bigint | null {
  const normalized = typeof value === 'bigint' ? value : BigInt(Math.trunc(value))
  // Some filesystems expose zero for unavailable identity signals. Treat those as absent so
  // size and mtime can still provide the portable inventory fast path.
  return normalized > 0n ? normalized : null
}

function sameFileState(left: BigIntStats, right: BigIntStats) {
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
