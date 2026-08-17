import path from 'node:path'
import type { PendingReplaceFileSystemPort } from './types.js'
import { PendingReplacePermanentError } from './types.js'

export function normalizeStoredRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/')
  if (!normalized || normalized.length > 4_096 || path.posix.isAbsolute(normalized)) {
    throw new PendingReplacePermanentError('PATH_OUTSIDE_SCAN_ROOT', 'Persisted path is not a bounded relative path')
  }
  const segments = normalized.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\0'))) {
    throw new PendingReplacePermanentError('PATH_OUTSIDE_SCAN_ROOT', 'Persisted path contains an unsafe segment')
  }
  return normalized
}

export function toStoredPath(relativePath: string): string {
  return `/${normalizeStoredRelativePath(relativePath)}`
}

export function caseFoldPath(value: string): string {
  return normalizeStoredRelativePath(value).normalize('NFC').toLocaleLowerCase('en-US')
}

export async function resolveSafeExistingPath(
  fileSystem: PendingReplaceFileSystemPort,
  scanRoot: string,
  storedPath: string,
  expected: 'file' | 'directory'
): Promise<string> {
  const root = await resolveRoot(fileSystem, scanRoot)
  const relative = normalizeStoredRelativePath(storedPath)
  let cursor = root
  for (const segment of relative.split('/')) {
    cursor = path.join(cursor, segment)
    const stat = await fileSystem.lstat(cursor)
    if (stat.isSymbolicLink)
      throw new PendingReplacePermanentError('SYMLINK_NOT_ALLOWED', 'Symbolic links are not allowed')
    const resolved = await fileSystem.realpath(cursor)
    assertWithinRoot(root, resolved)
    cursor = resolved
  }
  const stat = await fileSystem.lstat(cursor)
  if ((expected === 'file' && !stat.isFile) || (expected === 'directory' && !stat.isDirectory)) {
    throw new PendingReplacePermanentError('SOURCE_CHANGED', `Expected a regular ${expected}`)
  }
  return cursor
}

export async function resolveSafeCreatablePath(
  fileSystem: PendingReplaceFileSystemPort,
  scanRoot: string,
  storedPath: string
): Promise<string> {
  const root = await resolveRoot(fileSystem, scanRoot)
  const segments = normalizeStoredRelativePath(storedPath).split('/')
  let cursor = root
  for (let index = 0; index < segments.length; index += 1) {
    const candidate = path.join(cursor, segments[index]!)
    try {
      const stat = await fileSystem.lstat(candidate)
      if (stat.isSymbolicLink)
        throw new PendingReplacePermanentError('SYMLINK_NOT_ALLOWED', 'Symbolic links are not allowed')
      const resolved = await fileSystem.realpath(candidate)
      assertWithinRoot(root, resolved)
      cursor = resolved
    } catch (error) {
      if (!isMissing(error)) throw error
      const unresolved = path.join(cursor, ...segments.slice(index))
      assertWithinRoot(root, unresolved)
      return unresolved
    }
  }
  return cursor
}

export function assertDistinctPaths(left: string, right: string, message: string): void {
  if (caseFoldPath(left) === caseFoldPath(right)) {
    throw new PendingReplacePermanentError('PATH_OUTSIDE_SCAN_ROOT', message)
  }
}

async function resolveRoot(fileSystem: PendingReplaceFileSystemPort, scanRoot: string) {
  if (!path.isAbsolute(scanRoot)) throw new Error('Pending replacement scanRoot must be absolute')
  const stat = await fileSystem.lstat(scanRoot)
  if (!stat.isDirectory || stat.isSymbolicLink)
    throw new Error('Pending replacement scanRoot must be a regular directory')
  return path.resolve(await fileSystem.realpath(scanRoot))
}

function assertWithinRoot(root: string, candidate: string): void {
  const relative = path.relative(root, path.resolve(candidate))
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return
  throw new PendingReplacePermanentError('PATH_OUTSIDE_SCAN_ROOT', 'Resolved path escapes scanRoot')
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT'
}
