import { createHash } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import { readPixivRootMarker } from '../scan/root-identity.ts'
import { resolveSafeScanRoot, type SafeScanRoot } from '../scan/paths.ts'

export type MediaContentLogicalRoot = 'source-media:v1' | 'archive-media:v1'

export interface ResolvedMediaContentRoot {
  logicalRoot: MediaContentLogicalRoot
  rootIdentity: string
  absolutePath: string
  deviceId: bigint
  inode: bigint
}

export class MediaContentFileError extends Error {
  constructor(
    readonly code: 'ROOT_CHANGED' | 'UNSAFE_PATH' | 'NOT_READABLE' | 'INVALID_FILE' | 'FILE_CHANGED',
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options)
    this.name = 'MediaContentFileError'
  }
}

export async function resolveMediaContentRoots(input: {
  sourceRoot: string
  archiveRoot: string
  expectedPixivRootIdentity: string | null
}): Promise<{
  source: ResolvedMediaContentRoot
  archive: ResolvedMediaContentRoot
  archiveRelativePrefix: string
}> {
  const source = await resolveRoot(input.sourceRoot, 'source-media:v1', input.expectedPixivRootIdentity)
  const archivePath = path.resolve(input.archiveRoot)
  // Source and archive frequently share a mount. Resolve to one namespace even for nested archives.
  const candidate = await resolveSafeScanRoot(archivePath)
  if (within(source.absolutePath, candidate.absolutePath)) {
    return { source, archive: source, archiveRelativePrefix: relative(source.absolutePath, candidate.absolutePath) }
  }
  if (within(candidate.absolutePath, source.absolutePath)) {
    throw new MediaContentFileError('ROOT_CHANGED', 'Archive root must not contain the source root')
  }
  const archive = await resolveRoot(candidate.absolutePath, 'archive-media:v1', null)
  return { source, archive, archiveRelativePrefix: '' }
}

async function resolveRoot(
  configuredRoot: string,
  logicalRoot: MediaContentLogicalRoot,
  expectedIdentity: string | null
): Promise<ResolvedMediaContentRoot> {
  const safe = await resolveSafeScanRoot(configuredRoot)
  const marker = await readPixivRootMarker(safe)
  if (expectedIdentity !== null && marker !== expectedIdentity.toLowerCase()) {
    throw new MediaContentFileError('ROOT_CHANGED', 'Media root identity does not match the bound inventory')
  }
  await assertRootPath(safe)
  const hash = createHash('sha256')
  for (const field of [
    'pixishelf-media-root-v1',
    marker === null ? 'configured' : 'pixiv',
    marker ?? '',
    safe.absolutePath,
    safe.deviceId.toString(),
    safe.inode.toString()
  ]) {
    const value = Buffer.from(field)
    const size = Buffer.allocUnsafe(4)
    size.writeUInt32BE(value.length)
    hash.update(size).update(value)
  }
  return { logicalRoot, rootIdentity: hash.digest('hex'), ...safe }
}

export async function assertMediaContentRootUnchanged(root: ResolvedMediaContentRoot): Promise<void> {
  const observed = await resolveRoot(root.absolutePath, root.logicalRoot, null)
  if (observed.rootIdentity !== root.rootIdentity) {
    throw new MediaContentFileError('ROOT_CHANGED', 'Media root changed during content inspection')
  }
}

export function canonicalMediaContentPath(value: string, allowRoot = false): string {
  if (allowRoot && value === '') return ''
  if (
    !value ||
    value.includes('\\') ||
    value.includes('\0') ||
    value.startsWith('/') ||
    /^[A-Za-z]:/.test(value) ||
    value.split('/').some((part) => !part || part === '.' || part === '..')
  ) {
    throw new MediaContentFileError('UNSAFE_PATH', 'Media content path must be a canonical relative path')
  }
  return value
}

export async function resolveMediaContentPath(
  root: ResolvedMediaContentRoot,
  relativePath: string,
  options: { allowMissing?: boolean; kind?: 'file' | 'directory' } = {}
): Promise<{ absolutePath: string; relativePath: string; relativeDirectory: string }> {
  const normalized = canonicalMediaContentPath(relativePath, options.kind === 'directory')
  await assertRootPath(root)
  let candidate = root.absolutePath
  const segments = normalized ? normalized.split('/') : []
  let missing = false
  for (let index = 0; index < segments.length; index++) {
    candidate = path.join(candidate, segments[index]!)
    if (missing) continue
    let state
    try {
      state = await fs.lstat(candidate, { bigint: true })
    } catch (error) {
      if (options.allowMissing && errorCode(error) === 'ENOENT') {
        missing = true
        continue
      }
      throw new MediaContentFileError('NOT_READABLE', 'Media content path cannot be inspected', { cause: error })
    }
    if (state.isSymbolicLink())
      throw new MediaContentFileError('UNSAFE_PATH', 'Media content path contains a symbolic link')
    const last = index === segments.length - 1
    if (!last && !state.isDirectory()) throw new MediaContentFileError('UNSAFE_PATH', 'Media parent is not a directory')
    if (last && (options.kind === 'directory' ? !state.isDirectory() : !state.isFile())) {
      throw new MediaContentFileError('INVALID_FILE', 'Media content path has the wrong file type')
    }
  }
  if (!within(root.absolutePath, candidate))
    throw new MediaContentFileError('UNSAFE_PATH', 'Media content path escapes its root')
  if (!missing && (await fs.realpath(candidate)) !== candidate) {
    throw new MediaContentFileError('UNSAFE_PATH', 'Media content path changed during resolution')
  }
  await assertRootPath(root)
  return {
    absolutePath: candidate,
    relativePath: normalized,
    relativeDirectory:
      options.kind === 'directory'
        ? normalized
        : path.posix.dirname(normalized) === '.'
          ? ''
          : path.posix.dirname(normalized)
  }
}

async function assertRootPath(root: Pick<SafeScanRoot, 'absolutePath' | 'deviceId' | 'inode'>) {
  const state = await fs.lstat(root.absolutePath, { bigint: true })
  if (
    !state.isDirectory() ||
    state.isSymbolicLink() ||
    state.dev !== root.deviceId ||
    state.ino !== root.inode ||
    (await fs.realpath(root.absolutePath)) !== root.absolutePath
  ) {
    throw new MediaContentFileError('ROOT_CHANGED', 'Media root path changed')
  }
}

function within(root: string, candidate: string) {
  const value = path.relative(root, candidate)
  return value === '' || (!path.isAbsolute(value) && value !== '..' && !value.startsWith('..' + path.sep))
}
function relative(root: string, candidate: string) {
  return path.relative(root, candidate).split(path.sep).join('/')
}
function errorCode(error: unknown) {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
}
