import { randomUUID } from 'node:crypto'
import { closeSync, constants, fstatSync, fsyncSync, openSync, writeFileSync, type BigIntStats } from 'node:fs'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { createRequire } from 'node:module'
import {
  assertMediaContentRootUnchanged,
  canonicalMediaContentPath,
  MediaContentFileError,
  resolveMediaContentPath,
  type ResolvedMediaContentRoot
} from '../media-content/roots.ts'
import { throwIfAborted } from '../scan/bounded.ts'

export const maintenanceFileErrorCodes = [
  'FILESYSTEM_CAPABILITY_UNAVAILABLE',
  'FILESYSTEM_DURABILITY_UNAVAILABLE',
  'DIRECTORY_BUDGET_EXCEEDED',
  'FILE_CONFLICT',
  'CROSS_DEVICE',
  'HARD_LINK'
] as const
export class MaintenanceFileError extends Error {
  constructor(
    readonly code: (typeof maintenanceFileErrorCodes)[number],
    options?: ErrorOptions
  ) {
    super(code, options)
    this.name = 'MaintenanceFileError'
  }
}
export interface MaintenanceFileState {
  size: bigint
  mtimeNs: bigint
  ctimeNs: bigint
  deviceId: bigint
  inode: bigint
  linkCount: bigint
}
export type MaintenanceFileKind = 'FILE' | 'DIRECTORY' | 'SYMLINK' | 'OTHER'
export interface MaintenanceInspection {
  canonicalPath: string
  rootIdentity: string
  kind: MaintenanceFileKind | 'MISSING'
  state: MaintenanceFileState | null
}
export interface MaintenanceDirectoryPage {
  entries: Array<{ name: string; kind: MaintenanceFileKind }>
  nextName: string | null
  state: MaintenanceFileState
}
export interface MaintenanceFilesystemCapability {
  platform: 'linux' | 'darwin'
  rootIdentity: string
  deviceId: bigint
  exclusiveRename: true
  fileSync: true
  directorySync: true
}
function state(value: BigIntStats): MaintenanceFileState {
  return {
    size: value.size,
    mtimeNs: value.mtimeNs,
    ctimeNs: value.ctimeNs,
    deviceId: value.dev,
    inode: value.ino,
    linkCount: value.nlink
  }
}
function kind(value: { isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean }): MaintenanceFileKind {
  return value.isSymbolicLink() ? 'SYMLINK' : value.isFile() ? 'FILE' : value.isDirectory() ? 'DIRECTORY' : 'OTHER'
}
function code(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : null
}
function sameDirectory(a: MaintenanceFileState, b: MaintenanceFileState) {
  return a.deviceId === b.deviceId && a.inode === b.inode && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs
}
export async function inspectMaintenanceFile(input: {
  root: ResolvedMediaContentRoot
  relativePath: string
  signal: AbortSignal
}): Promise<MaintenanceInspection> {
  throwIfAborted(input.signal)
  await assertMediaContentRootUnchanged(input.root)
  const relativePath = canonicalMediaContentPath(input.relativePath)
  const parent = path.posix.dirname(relativePath) === '.' ? '' : path.posix.dirname(relativePath)
  await resolveMediaContentPath(input.root, parent, { kind: 'directory', allowMissing: true })
  const absolute = path.join(input.root.absolutePath, relativePath)
  let value: BigIntStats
  try {
    value = await fs.lstat(absolute, { bigint: true })
  } catch (error) {
    if (code(error) !== 'ENOENT') throw error
    await assertMediaContentRootUnchanged(input.root)
    return { canonicalPath: relativePath, rootIdentity: input.root.rootIdentity, kind: 'MISSING', state: null }
  }
  const after = await fs.lstat(absolute, { bigint: true })
  if (
    !sameDirectory(state(value), state(after)) ||
    value.size !== after.size ||
    value.nlink !== after.nlink ||
    kind(value) !== kind(after)
  )
    throw new MediaContentFileError('FILE_CHANGED', 'FILE_CHANGED')
  await assertMediaContentRootUnchanged(input.root)
  throwIfAborted(input.signal)
  return { canonicalPath: relativePath, rootIdentity: input.root.rootIdentity, kind: kind(after), state: state(after) }
}
export async function inspectMaintenanceDirectory(input: {
  root: ResolvedMediaContentRoot
  relativePath: string
  afterName: string | null
  expectedState: MaintenanceFileState | null
  signal: AbortSignal
}): Promise<MaintenanceDirectoryPage> {
  throwIfAborted(input.signal)
  if (input.afterName !== null && (!input.afterName || /[\/\\\0]/.test(input.afterName)))
    throw new MediaContentFileError('UNSAFE_PATH', 'UNSAFE_PATH')
  if (input.afterName !== null && input.expectedState === null)
    throw new MediaContentFileError('FILE_CHANGED', 'FILE_CHANGED')
  const resolved = await resolveMediaContentPath(input.root, input.relativePath, { kind: 'directory' })
  const before = state(await fs.lstat(resolved.absolutePath, { bigint: true }))
  if (input.expectedState && !sameDirectory(before, input.expectedState))
    throw new MediaContentFileError('FILE_CHANGED', 'FILE_CHANGED')
  const entries: MaintenanceDirectoryPage['entries'] = []
  const directory = await fs.opendir(resolved.absolutePath)
  let inspected = 0,
    remaining = 0
  try {
    for (;;) {
      throwIfAborted(input.signal)
      const entry = await directory.read()
      if (!entry) break
      if (++inspected > 10_000) throw new MaintenanceFileError('DIRECTORY_BUDGET_EXCEEDED')
      if (input.afterName !== null && entry.name <= input.afterName) continue
      remaining++
      const position = entries.findIndex((other) => entry.name < other.name)
      entries.splice(position < 0 ? entries.length : position, 0, { name: entry.name, kind: kind(entry) })
      if (entries.length > 100) entries.pop()
    }
  } finally {
    await directory.close()
  }
  const after = state(await fs.lstat(resolved.absolutePath, { bigint: true }))
  if (!sameDirectory(before, after)) throw new MediaContentFileError('FILE_CHANGED', 'FILE_CHANGED')
  await assertMediaContentRootUnchanged(input.root)
  return { entries, nextName: remaining > entries.length ? entries.at(-1)!.name : null, state: after }
}
interface NativeRename {
  checkedUnlinkAt(parentFd: number, name: string, expected: bigint[], allowMissing: boolean): void
  renameExclusive(fromFd: number, from: string, toFd: number, to: string): void
  openDirectoryAt(parentFd: number, name: string): number
  mkdirAt(parentFd: number, name: string): void
  createFileAt(parentFd: number, name: string): number
  unlinkAt(parentFd: number, name: string): void
  rmdirAt(parentFd: number, name: string): void
}
let native: NativeRename | undefined
function nativeRename() {
  if (!process.send || !['linux', 'darwin'].includes(process.platform))
    throw new MaintenanceFileError('FILESYSTEM_CAPABILITY_UNAVAILABLE')
  if (!native) {
    const require = createRequire(typeof __filename === 'string' ? __filename : import.meta.url)
    const location =
      typeof __dirname === 'string'
        ? path.join(__dirname, 'artwork-dedup-native.node')
        : new URL('../../../pixishelf-worker/dist/artwork-dedup-native.node', import.meta.url).pathname
    try {
      native = require(location) as NativeRename
    } catch (cause) {
      throw new MaintenanceFileError('FILESYSTEM_CAPABILITY_UNAVAILABLE', { cause })
    }
  }
  return native
}
function pathError(cause: unknown): never {
  if (['ELOOP', 'ENOTDIR'].includes(code(cause) ?? ''))
    throw new MediaContentFileError('UNSAFE_PATH', 'UNSAFE_PATH', { cause })
  if (code(cause) === 'EXDEV') throw new MaintenanceFileError('CROSS_DEVICE', { cause })
  throw cause
}
async function openDirectory(root: ResolvedMediaContentRoot, relativePath: string) {
  canonicalMediaContentPath(relativePath, true)
  await assertMediaContentRootUnchanged(root)
  const adapter = nativeRename()
  // Only the binding root is opened by absolute path. Its inode must be the trusted anchor.
  const rootFd = openSync(root.absolutePath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
  let currentFd = rootFd
  try {
    const current = fstatSync(rootFd, { bigint: true })
    if (!current.isDirectory() || current.dev !== root.deviceId || current.ino !== root.inode)
      throw new MediaContentFileError('ROOT_CHANGED', 'ROOT_CHANGED')
    await assertMediaContentRootUnchanged(root)
    for (const segment of relativePath ? relativePath.split('/') : []) {
      const nextFd = adapter.openDirectoryAt(currentFd, segment)
      if (currentFd !== rootFd) closeSync(currentFd)
      currentFd = nextFd
    }
    return {
      fd: currentFd,
      close() {
        try {
          if (currentFd !== rootFd) closeSync(currentFd)
        } finally {
          closeSync(rootFd)
        }
      }
    }
  } catch (cause) {
    try {
      if (currentFd !== rootFd) closeSync(currentFd)
    } finally {
      closeSync(rootFd)
    }
    pathError(cause)
  }
}
function syncDirectoryFd(fd: number) {
  try {
    fsyncSync(fd)
  } catch (cause) {
    throw new MaintenanceFileError('FILESYSTEM_DURABILITY_UNAVAILABLE', { cause })
  }
}
export async function syncMaintenanceDirectory(root: ResolvedMediaContentRoot, relativePath: string) {
  const handle = await openDirectory(root, relativePath)
  try {
    await assertMediaContentRootUnchanged(root)
    syncDirectoryFd(handle.fd)
  } finally {
    handle.close()
  }
}
export async function ensureMaintenanceDirectory(root: ResolvedMediaContentRoot, relativePath: string) {
  canonicalMediaContentPath(relativePath)
  if (!relativePath.startsWith('.trash/artwork-dedup/')) throw new MediaContentFileError('UNSAFE_PATH', 'UNSAFE_PATH')
  const adapter = nativeRename()
  let relative = ''
  for (const segment of relativePath.split('/')) {
    const parent = await openDirectory(root, relative)
    try {
      await assertMediaContentRootUnchanged(root)
      let created = false
      try {
        adapter.mkdirAt(parent.fd, segment)
        created = true
      } catch (error) {
        if (code(error) !== 'EEXIST') pathError(error)
      }
      // An existing symlink is never accepted as a directory, including in the probe path.
      let child: number
      try {
        child = adapter.openDirectoryAt(parent.fd, segment)
      } catch (error) {
        pathError(error)
      }
      closeSync(child)
      if (created) {
        await assertMediaContentRootUnchanged(root)
        syncDirectoryFd(parent.fd)
      }
    } finally {
      parent.close()
    }
    relative = relative ? `${relative}/${segment}` : segment
  }
}
async function createProbeFile(root: ResolvedMediaContentRoot, relativePath: string, contents: string) {
  const directory = await openDirectory(root, path.posix.dirname(relativePath))
  try {
    await assertMediaContentRootUnchanged(root)
    const fd = nativeRename().createFileAt(directory.fd, path.posix.basename(relativePath))
    try {
      writeFileSync(fd, contents)
      fsyncSync(fd)
      return fstatSync(fd, { bigint: true }).ino
    } catch (cause) {
      throw new MaintenanceFileError('FILESYSTEM_DURABILITY_UNAVAILABLE', { cause })
    } finally {
      closeSync(fd)
    }
  } finally {
    directory.close()
  }
}
async function removeProbeEntry(root: ResolvedMediaContentRoot, relativePath: string, directoryEntry = false) {
  const parent = await openDirectory(root, path.posix.dirname(relativePath))
  try {
    await assertMediaContentRootUnchanged(root)
    const adapter = nativeRename()
    if (directoryEntry) adapter.rmdirAt(parent.fd, path.posix.basename(relativePath))
    else adapter.unlinkAt(parent.fd, path.posix.basename(relativePath))
  } finally {
    parent.close()
  }
}
/** Native call runs synchronously in this reader; there is no independently surviving file worker. */
export async function renameMaintenanceFile(root: ResolvedMediaContentRoot, from: string, to: string) {
  canonicalMediaContentPath(from)
  canonicalMediaContentPath(to)
  const adapter = nativeRename()
  const fromParent = path.posix.dirname(from) === '.' ? '' : path.posix.dirname(from)
  const toParent = path.posix.dirname(to) === '.' ? '' : path.posix.dirname(to)
  const source = await openDirectory(root, fromParent)
  try {
    const destination = await openDirectory(root, toParent)
    try {
      await assertMediaContentRootUnchanged(root)
      adapter.renameExclusive(source.fd, path.posix.basename(from), destination.fd, path.posix.basename(to))
    } catch (cause) {
      if (code(cause) === 'EEXIST') throw new MaintenanceFileError('FILE_CONFLICT', { cause })
      if (code(cause) === 'EXDEV') throw new MaintenanceFileError('CROSS_DEVICE', { cause })
      if (['ENOSYS', 'EINVAL', 'ENOTSUP'].includes(code(cause) ?? ''))
        throw new MaintenanceFileError('FILESYSTEM_CAPABILITY_UNAVAILABLE', { cause })
      throw cause
    } finally {
      await destination.close()
    }
  } finally {
    await source.close()
  }
}
export async function probeMaintenanceFilesystem(input: {
  root: ResolvedMediaContentRoot
  operationId: string
  signal: AbortSignal
}): Promise<MaintenanceFilesystemCapability> {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(input.operationId)) throw new MediaContentFileError('UNSAFE_PATH', 'UNSAFE_PATH')
  nativeRename()
  throwIfAborted(input.signal)
  const relative = `.trash/artwork-dedup/${input.operationId}/probe-${randomUUID()}`
  await ensureMaintenanceDirectory(input.root, relative)
  const paths = ['source', 'occupied', 'moved'].map((name) => `${relative}/${name}`)
  const ids: bigint[] = []
  for (const [index, file] of paths.slice(0, 2).entries()) {
    ids.push(await createProbeFile(input.root, file, String(index)))
  }
  await syncMaintenanceDirectory(input.root, relative)
  let refused = false
  try {
    await renameMaintenanceFile(input.root, paths[0]!, paths[1]!)
  } catch (error) {
    if (!(error instanceof MaintenanceFileError) || error.code !== 'FILE_CONFLICT') throw error
    refused = true
  }
  if (!refused) throw new MaintenanceFileError('FILESYSTEM_CAPABILITY_UNAVAILABLE')
  for (const [index, file] of paths.slice(0, 2).entries()) {
    const observed = await inspectMaintenanceFile({ ...input, relativePath: file })
    if (observed.kind !== 'FILE' || observed.state?.inode !== ids[index])
      throw new MaintenanceFileError('FILESYSTEM_CAPABILITY_UNAVAILABLE')
  }
  throwIfAborted(input.signal)
  await renameMaintenanceFile(input.root, paths[0]!, paths[2]!)
  await syncMaintenanceDirectory(input.root, relative)
  const moved = await inspectMaintenanceFile({ ...input, relativePath: paths[2]! })
  const source = await inspectMaintenanceFile({ ...input, relativePath: paths[0]! })
  if (
    source.kind !== 'MISSING' ||
    !moved.state ||
    moved.state.inode !== ids[0] ||
    moved.state.deviceId !== input.root.deviceId
  )
    throw new MaintenanceFileError('FILESYSTEM_CAPABILITY_UNAVAILABLE')
  // Remove only this successful probe's known files. Failed probes retain their evidence.
  await removeProbeEntry(input.root, paths[1]!)
  await removeProbeEntry(input.root, paths[2]!)
  await syncMaintenanceDirectory(input.root, relative)
  await removeProbeEntry(input.root, relative, true)
  await syncMaintenanceDirectory(input.root, path.posix.dirname(relative))
  return {
    platform: process.platform as 'linux' | 'darwin',
    rootIdentity: input.root.rootIdentity,
    deviceId: input.root.deviceId,
    exclusiveRename: true,
    fileSync: true,
    directorySync: true
  }
}

export interface DirectDeleteFileReceipt { location: 'ABSENT'; directoriesSynced: true }
/** This is called only by the fixed reader child, after a durable original DELETE_INTENT. */
export async function deleteMaintenanceFile(input: {
  root: ResolvedMediaContentRoot; relativePath: string; expectedState: MaintenanceFileState;
  allowMissing: boolean; signal: AbortSignal
}): Promise<DirectDeleteFileReceipt> {
  throwIfAborted(input.signal)
  canonicalMediaContentPath(input.relativePath)
  const parent = path.posix.dirname(input.relativePath)
  const handle = await openDirectory(input.root, parent === '.' ? '' : parent)
  try {
    await assertMediaContentRootUnchanged(input.root)
    throwIfAborted(input.signal)
    const s = input.expectedState
    if (s.linkCount !== 1n || s.deviceId !== input.root.deviceId) throw new MaintenanceFileError('FILE_CONFLICT')
    const adapter = nativeRename()
    if (typeof adapter.checkedUnlinkAt !== 'function') throw new MaintenanceFileError('FILESYSTEM_CAPABILITY_UNAVAILABLE')
    try {
      adapter.checkedUnlinkAt(handle.fd, path.posix.basename(input.relativePath), [s.deviceId,s.inode,s.size,s.mtimeNs,s.ctimeNs,s.linkCount], input.allowMissing)
    } catch (cause) {
      if (code(cause) === 'FILE_CHANGED') throw new MediaContentFileError('FILE_CHANGED','FILE_CHANGED',{cause})
      pathError(cause)
    }
    return { location: 'ABSENT', directoriesSynced: true }
  } finally { handle.close() }
}
