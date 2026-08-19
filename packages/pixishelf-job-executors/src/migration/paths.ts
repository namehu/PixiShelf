import { createHash } from 'node:crypto'
import path from 'node:path'
import type { MigrationFileSystemPort } from './types.ts'
import { MigrationPermanentError } from './types.ts'

const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i

export function assertSafePathSegment(value: string, label: string): string {
  if (
    value.length === 0 ||
    value.length > 255 ||
    value === '.' ||
    value === '..' ||
    hasControlCharacter(value) ||
    /[<>:"/\\|?*]/.test(value) ||
    /[. ]$/.test(value) ||
    WINDOWS_RESERVED_SEGMENT.test(value)
  ) {
    throw new MigrationPermanentError('INVALID_PATH_SEGMENT', `${label} is not a safe path segment`)
  }
  return value
}

function hasControlCharacter(value: string) {
  return [...value].some((character) => character.charCodeAt(0) <= 0x1f)
}

export function normalizeStoredRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/')
  if (/^[a-zA-Z]:/.test(normalized) || normalized.startsWith('//')) {
    throw new MigrationPermanentError('PATH_OUTSIDE_ALLOWED_ROOT', 'Absolute and UNC image paths are not allowed')
  }
  const withoutDatabaseSlash = normalized.startsWith('/') ? normalized.slice(1) : normalized
  const segments = withoutDatabaseSlash.split('/')
  if (segments.length === 0 || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new MigrationPermanentError('PATH_OUTSIDE_ALLOWED_ROOT', 'Image path contains an unsafe segment')
  }
  return segments.join('/')
}

export function toDatabaseStoredPath(relativePath: string): string {
  return `/${normalizeStoredRelativePath(relativePath)}`
}

export function buildCanonicalTargetDirectory(artistUserId: string, externalId: string): string {
  return `${assertSafePathSegment(artistUserId, 'artist.userId')}/${assertSafePathSegment(externalId, 'artwork.externalId')}`
}

export function buildCanonicalTargetPath(targetDirectory: string, sourceRelativePath: string): string {
  const filename = path.posix.basename(normalizeStoredRelativePath(sourceRelativePath))
  assertSafePathSegment(filename, 'image filename')
  return `${targetDirectory}/${filename}`
}

export function buildStagedRelativePath(input: {
  stagingDirectoryName: string
  systemJobId: string
  attempt: number
  artworkId: number
  ordinal: number
  filename: string
}): string {
  const stagingDirectory = assertSafePathSegment(input.stagingDirectoryName, 'migration staging directory')
  const jobToken = createHash('sha256').update(input.systemJobId).digest('hex').slice(0, 24)
  const filename = assertSafePathSegment(input.filename, 'image filename')
  return `${stagingDirectory}/${jobToken}/attempt-${input.attempt}/artwork-${input.artworkId}/${input.ordinal}-${filename}`
}

/** Exact directory membership avoids the legacy `artist/123` versus `artist/1234` prefix bug. */
export function isPathInExactDirectory(relativePath: string, expectedDirectory: string): boolean {
  return (
    path.posix.dirname(normalizeStoredRelativePath(relativePath)) === normalizeStoredRelativePath(expectedDirectory)
  )
}

export function isExternalIdOwnedFilename(filename: string, externalId: string): boolean {
  assertSafePathSegment(externalId, 'artwork.externalId')
  const escaped = externalId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const owned = new RegExp(`^${escaped}(?:$|[_.-])`).test(filename)
  if (owned) assertSafePathSegment(filename, 'legacy sidecar filename')
  return owned
}

export function caseFoldPath(relativePath: string): string {
  return normalizeStoredRelativePath(relativePath).normalize('NFC').toLocaleLowerCase('en-US')
}

export async function resolveSafeExistingDirectory(
  fileSystem: MigrationFileSystemPort,
  root: string,
  relativePath: string
): Promise<string> {
  if (relativePath === '.') return fileSystem.realpath(path.resolve(root))
  return resolveSafeExistingPath(fileSystem, root, relativePath, 'directory')
}

export async function resolveSafeExistingFile(
  fileSystem: MigrationFileSystemPort,
  root: string,
  relativePath: string
): Promise<string> {
  return resolveSafeExistingPath(fileSystem, root, relativePath, 'file')
}

async function resolveSafeExistingPath(
  fileSystem: MigrationFileSystemPort,
  root: string,
  relativePath: string,
  expected: 'file' | 'directory'
) {
  const rootRealPath = await fileSystem.realpath(path.resolve(root))
  const segments = normalizeStoredRelativePath(relativePath).split('/')
  let current = rootRealPath
  for (const [index, segment] of segments.entries()) {
    const candidate = path.resolve(current, segment)
    assertContained(rootRealPath, candidate)
    const stat = await fileSystem.lstat(candidate)
    const isLast = index === segments.length - 1
    if (stat.isSymbolicLink || (!isLast && !stat.isDirectory)) {
      throw new MigrationPermanentError(
        'PATH_OUTSIDE_ALLOWED_ROOT',
        'Migration path must remain non-symlink and cross directories only'
      )
    }
    if (isLast && (expected === 'file' ? !stat.isFile : !stat.isDirectory)) {
      throw new MigrationPermanentError(
        'PATH_OUTSIDE_ALLOWED_ROOT',
        `Migration ${expected} must be regular and non-symlink`
      )
    }
    const resolved = await fileSystem.realpath(candidate)
    assertContained(rootRealPath, resolved)
    current = resolved
  }
  return current
}

export async function resolveSafeOptionalFile(
  fileSystem: MigrationFileSystemPort,
  root: string,
  relativePath: string
): Promise<string | null> {
  try {
    return await resolveSafeExistingFile(fileSystem, root, relativePath)
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

export async function ensureSafeDirectory(
  fileSystem: MigrationFileSystemPort,
  root: string,
  relativeDirectory: string
): Promise<string> {
  const rootRealPath = await fileSystem.realpath(path.resolve(root))
  const segments = normalizeStoredRelativePath(relativeDirectory).split('/')
  let current = rootRealPath
  for (const segment of segments) {
    assertSafePathSegment(segment, 'directory segment')
    const next = path.resolve(current, segment)
    assertContained(rootRealPath, next)
    try {
      const stat = await fileSystem.lstat(next)
      if (stat.isSymbolicLink || !stat.isDirectory) {
        throw new MigrationPermanentError('PATH_OUTSIDE_ALLOWED_ROOT', 'Migration directory crosses a symlink or file')
      }
    } catch (error) {
      if (!isMissing(error)) throw error
      try {
        await fileSystem.mkdir(next)
      } catch (mkdirError) {
        if (!isAlreadyExists(mkdirError)) throw mkdirError
      }
      const created = await fileSystem.lstat(next)
      if (created.isSymbolicLink || !created.isDirectory) {
        throw new MigrationPermanentError(
          'PATH_OUTSIDE_ALLOWED_ROOT',
          'Migration directory was replaced while creating it'
        )
      }
    }
    const realNext = await fileSystem.realpath(next)
    assertContained(rootRealPath, realNext)
    current = realNext
  }
  return current
}

export function resolvePathInsideRoot(root: string, relativePath: string): string {
  const rootPath = path.resolve(root)
  const candidate = path.resolve(rootPath, ...normalizeStoredRelativePath(relativePath).split('/'))
  assertContained(rootPath, candidate)
  return candidate
}

function assertContained(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  if (relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    return
  }
  throw new MigrationPermanentError('PATH_OUTSIDE_ALLOWED_ROOT', 'Migration path escapes the configured scan root')
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException | null)?.code === 'ENOENT'
}

function isAlreadyExists(error: unknown) {
  return (error as NodeJS.ErrnoException | null)?.code === 'EEXIST'
}
