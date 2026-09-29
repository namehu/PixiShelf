import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { ScanExecutorError } from './errors.ts'
import { hashScanRootIdentity } from './inventory.ts'
import { resolveSafeScanRoot, type SafeScanRoot } from './paths.ts'
import type { ScanTransaction } from './types.ts'

export const PIXIV_ROOT_MARKER = '.pixishelf-root'
const markerSchema = z.object({ version: z.literal(1), id: z.uuid() }).strict()

export async function readPixivRootMarker(root: SafeScanRoot): Promise<string | null> {
  const markerPath = path.join(root.absolutePath, PIXIV_ROOT_MARKER)
  try {
    const before = await fs.lstat(markerPath, { bigint: true })
    if (!before.isFile() || before.isSymbolicLink() || before.size > 1024n) {
      throw rootConflict('Pixiv root marker must be a regular file of at most 1024 bytes')
    }
    const handle = await fs.open(markerPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
    try {
      const opened = await handle.stat({ bigint: true })
      if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino) {
        throw rootConflict('Pixiv root marker changed while opening it')
      }
      const buffer = Buffer.alloc(1025)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
      const parsed = markerSchema.safeParse(JSON.parse(buffer.subarray(0, bytesRead).toString('utf8')))
      const after = await fs.lstat(markerPath, { bigint: true })
      if (
        bytesRead > 1024 ||
        !parsed.success ||
        after.isSymbolicLink() ||
        after.dev !== opened.dev ||
        after.ino !== opened.ino ||
        after.size !== opened.size ||
        after.mtimeNs !== opened.mtimeNs ||
        after.ctimeNs !== opened.ctimeNs
      )
        throw rootConflict('Pixiv root marker is invalid or changed while reading it')
      return parsed.data.id.toLowerCase()
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (nodeCode(error) === 'ENOENT') return null
    if (error instanceof ScanExecutorError) throw error
    throw rootConflict('Pixiv root marker cannot be read or is invalid; run pixiv-root-identity inspect')
  }
}

export async function createPixivRootMarker(root: SafeScanRoot, identity: string = randomUUID()): Promise<string> {
  if (!z.uuid().safeParse(identity).success) throw rootConflict('Invalid Pixiv root UUID')
  await assertScanRootUnchanged(root)
  try {
    const handle = await fs.open(path.join(root.absolutePath, PIXIV_ROOT_MARKER), 'wx', 0o644)
    try {
      await handle.writeFile(`${JSON.stringify({ version: 1, id: identity })}\n`, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
  } catch (error) {
    if (nodeCode(error) !== 'EEXIST') {
      throw rootConflict(
        'Pixiv root marker could not be created; check Worker write permission and run pixiv-root-identity inspect'
      )
    }
    // An incomplete exclusive write is deliberately not repaired or overwritten.
  }
  await assertScanRootUnchanged(root)
  const actual = await readPixivRootMarker(root)
  if (!actual) throw rootConflict('Pixiv root marker disappeared during creation')
  return actual
}

export async function assertScanRootUnchanged(root: SafeScanRoot): Promise<void> {
  const actual = await resolveSafeScanRoot(root.absolutePath)
  if (actual.absolutePath !== root.absolutePath || actual.deviceId !== root.deviceId || actual.inode !== root.inode) {
    throw rootConflict('Pixiv scan root changed during execution')
  }
}

export async function assertPixivRootUnchanged(root: SafeScanRoot): Promise<void> {
  await assertScanRootUnchanged(root)
  if (!root.rootIdentity || (await readPixivRootMarker(root)) !== root.rootIdentity) {
    throw rootConflict('Pixiv root UUID changed during execution')
  }
  await assertScanRootUnchanged(root)
}

/** Filesystem publication may survive a rolled-back DB transaction. Reuse its valid marker on retry. */
export async function bindPixivInventoryRoot(
  transaction: ScanTransaction,
  root: SafeScanRoot,
  now: Date,
  confirmLegacy = false
) {
  const state = await transaction.pixivMetadataInventoryState.findUnique({ where: { id: 'pixiv' } })
  const rootPathHash = hashScanRootIdentity(root.absolutePath)
  if (state && state.rootPathHash !== rootPathHash)
    throw rootConflict('Pixiv scan root path differs from the inventory')
  if (
    state &&
    !state.rootIdentity &&
    !confirmLegacy &&
    (state.rootDeviceId === null ||
      state.rootInode === null ||
      state.rootDeviceId !== root.deviceId ||
      state.rootInode !== root.inode)
  ) {
    throw rootConflict(
      'Legacy Pixiv root identity needs confirmation; stop Worker and run pixiv-root-identity inspect, then bind'
    )
  }
  let identity = await readPixivRootMarker(root)
  if (state?.rootIdentity) {
    if (identity !== state.rootIdentity) {
      throw rootConflict('Pixiv root UUID is missing or does not match the inventory; run pixiv-root-identity inspect')
    }
  } else {
    identity ??= await createPixivRootMarker(root)
  }
  await assertPixivRootUnchanged({ ...root, rootIdentity: identity! })
  const data = { rootIdentity: identity!, rootDeviceId: root.deviceId, rootInode: root.inode }
  if (!state) {
    const created = await transaction.pixivMetadataInventoryState.create({
      data: { id: 'pixiv', rootPathHash, ...data, status: 'INITIALIZING', baselineStartedAt: now }
    })
    return { state: created, remounted: false }
  }
  const remounted =
    Boolean(state.rootIdentity) && (state.rootDeviceId !== root.deviceId || state.rootInode !== root.inode)
  if (!state.rootIdentity || remounted) {
    const changed = await transaction.pixivMetadataInventoryState.updateMany({
      where: { id: state.id, updatedAt: state.updatedAt, rootIdentity: state.rootIdentity },
      data
    })
    if (changed.count !== 1) throw rootConflict('Pixiv inventory changed during root binding; inspect again')
    return {
      state: await transaction.pixivMetadataInventoryState.findUniqueOrThrow({ where: { id: state.id } }),
      remounted
    }
  }
  return { state, remounted }
}

function rootConflict(message: string) {
  return new ScanExecutorError('STATE_CONFLICT', message)
}

function nodeCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
}
