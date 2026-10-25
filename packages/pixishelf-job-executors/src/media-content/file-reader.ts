import { createHash } from 'node:crypto'
import { constants, type BigIntStats } from 'node:fs'
import * as fs from 'node:fs/promises'
import { throwIfAborted } from '../scan/bounded.ts'
import {
  assertMediaContentRootUnchanged,
  MediaContentFileError,
  resolveMediaContentPath,
  type ResolvedMediaContentRoot
} from './roots.ts'

export interface ContentFileState {
  size: bigint
  mtimeNs: bigint | null
  ctimeNs: bigint | null
  deviceId: bigint | null
  inode: bigint | null
}

export interface ContentFileInspection {
  canonicalPath: string
  absolutePath: string
  relativeDirectory: string
  rootIdentity: string
  state: ContentFileState
}

export async function inspectMediaContentFile(input: {
  root: ResolvedMediaContentRoot
  relativePath: string
  signal: AbortSignal
}): Promise<ContentFileInspection> {
  throwIfAborted(input.signal)
  await assertMediaContentRootUnchanged(input.root)
  const resolved = await resolveMediaContentPath(input.root, input.relativePath)
  const before = await fs.lstat(resolved.absolutePath, { bigint: true })
  assertRegular(before)
  const after = await fs.lstat(resolved.absolutePath, { bigint: true })
  if (!sameStats(before, after)) throw changed()
  throwIfAborted(input.signal)
  return {
    ...resolved,
    canonicalPath: resolved.relativePath,
    rootIdentity: input.root.rootIdentity,
    state: stateOf(after)
  }
}

export async function readMediaContentFile(input: {
  root: ResolvedMediaContentRoot
  relativePath: string
  signal: AbortSignal
  onProgress?: (bytesRead: bigint) => void | Promise<void>
  captureBytesLimit?: number
}): Promise<ContentFileInspection & { sha256: string; hashedAt: Date; bytesRead: bigint; content?: Buffer }> {
  const inspected = await inspectMediaContentFile(input)
  throwIfAborted(input.signal)
  const handle = await fs.open(inspected.absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const before = await handle.stat({ bigint: true })
    assertRegular(before)
    if (!sameContentFileState(inspected.state, stateOf(before))) throw changed()
    if (before.size > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new MediaContentFileError('INVALID_FILE', 'Media content exceeds the supported read offset')
    }
    if (input.captureBytesLimit !== undefined && before.size > BigInt(input.captureBytesLimit))
      throw new MediaContentFileError('INVALID_FILE', 'Visual input limit')
    const content = input.captureBytesLimit === undefined ? undefined : Buffer.alloc(Number(before.size))
    const hash = createHash('sha256')
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let offset = 0
    const expected = Number(before.size)
    while (offset < expected) {
      throwIfAborted(input.signal)
      const length = Math.min(buffer.length, expected - offset)
      const { bytesRead } = await handle.read(buffer, 0, length, offset)
      if (bytesRead === 0) throw changed()
      hash.update(buffer.subarray(0, bytesRead))
      content?.set(buffer.subarray(0, bytesRead), offset)
      offset += bytesRead
      await input.onProgress?.(BigInt(offset))
    }
    const after = await handle.stat({ bigint: true })
    const final = await fs.lstat(inspected.absolutePath, { bigint: true })
    assertRegular(final)
    if (
      !sameStats(before, after) ||
      !sameStats(after, final) ||
      offset !== expected ||
      (await fs.realpath(inspected.absolutePath)) !== inspected.absolutePath
    )
      throw changed()
    await assertMediaContentRootUnchanged(input.root)
    throwIfAborted(input.signal)
    return {
      ...inspected,
      state: stateOf(after),
      sha256: hash.digest('hex'),
      hashedAt: new Date(),
      bytesRead: BigInt(offset),
      ...(content ? { content } : {})
    }
  } finally {
    await handle.close()
  }
}

export function sameContentFileState(left: ContentFileState, right: ContentFileState): boolean {
  return (
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.deviceId === right.deviceId &&
    left.inode === right.inode
  )
}
function stateOf(value: BigIntStats): ContentFileState {
  return {
    size: value.size,
    mtimeNs: value.mtimeNs,
    ctimeNs: value.ctimeNs,
    deviceId: value.dev > 0n ? value.dev : null,
    inode: value.ino > 0n ? value.ino : null
  }
}
function assertRegular(value: BigIntStats) {
  if (!value.isFile() || value.isSymbolicLink() || value.size <= 0n) {
    throw new MediaContentFileError('INVALID_FILE', 'Media content must be a non-empty regular file')
  }
}
function sameStats(left: BigIntStats, right: BigIntStats) {
  return (
    left.isFile() &&
    right.isFile() &&
    left.size === right.size &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs
  )
}
function changed() {
  return new MediaContentFileError('FILE_CHANGED', 'Media content changed during inspection')
}
