import * as fs from 'node:fs/promises'
import path from 'node:path'
import { ScanExecutorError } from './errors.ts'
import { throwIfAborted } from './bounded.ts'
import { compareCodePoints } from './stable-order.ts'

export interface SafeScanRoot {
  absolutePath: string
  deviceId: bigint
  inode: bigint
}

export interface SafeScanPath {
  absolutePath: string
  relativePath: string
}

export interface WalkSafeFilesOptions {
  pageSize: number
  maxDepth: number
  maxEntries: number
  signal: AbortSignal
  include: (relativePath: string) => boolean
  onEntry?: () => void
}

export async function resolveSafeScanRoot(configuredRoot: string): Promise<SafeScanRoot> {
  const trimmed = configuredRoot.trim()
  if (!trimmed) throw new ScanExecutorError('CONFIGURATION_INVALID', 'Scan root is required')
  let rootMetadata: Awaited<ReturnType<typeof fs.lstat>>
  try {
    rootMetadata = await fs.lstat(trimmed)
  } catch (error) {
    if (nodeErrorCode(error) === 'ENOENT') throw new ScanExecutorError('SOURCE_NOT_FOUND', 'Scan root does not exist')
    throw new ScanExecutorError('SOURCE_NOT_READABLE', 'Scan root cannot be inspected')
  }
  if (rootMetadata.isSymbolicLink()) {
    throw new ScanExecutorError('SYMLINK_NOT_ALLOWED', 'Scan root must not be a symbolic link')
  }
  if (!rootMetadata.isDirectory()) {
    throw new ScanExecutorError('CONFIGURATION_INVALID', 'Scan root is not a directory')
  }
  const absolutePath = await fs.realpath(trimmed)
  // Capture the identity of the resolved directory itself. A path hash alone cannot detect a
  // remounted/replaced source at the same configured pathname during a consistency audit.
  const resolvedMetadata = await fs.lstat(absolutePath, { bigint: true })
  if (!resolvedMetadata.isDirectory()) {
    throw new ScanExecutorError('CONFIGURATION_INVALID', 'Scan root is not a directory')
  }
  return { absolutePath, deviceId: resolvedMetadata.dev, inode: resolvedMetadata.ino }
}

export async function resolveSafeExistingPath(
  root: SafeScanRoot,
  relativeInput: string,
  expectedKind: 'file' | 'directory'
): Promise<SafeScanPath> {
  const relativePath = normalizeRelativeScanPath(relativeInput)
  const segments = relativePath.split('/')
  let candidate = root.absolutePath
  for (const segment of segments) {
    candidate = path.join(candidate, segment)
    let metadata: Awaited<ReturnType<typeof fs.lstat>>
    try {
      metadata = await fs.lstat(candidate)
    } catch (error) {
      if (nodeErrorCode(error) === 'ENOENT') {
        throw new ScanExecutorError('SOURCE_NOT_FOUND', 'Scan input does not exist')
      }
      throw new ScanExecutorError('SOURCE_NOT_READABLE', 'Scan input cannot be inspected')
    }
    if (metadata.isSymbolicLink()) {
      throw new ScanExecutorError('SYMLINK_NOT_ALLOWED', 'Scan input must not contain symbolic links')
    }
  }
  const resolved = await fs.realpath(candidate)
  assertWithinRoot(root.absolutePath, resolved)
  const finalMetadata = await fs.lstat(resolved)
  if (expectedKind === 'file' ? !finalMetadata.isFile() : !finalMetadata.isDirectory()) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', `Scan input is not a ${expectedKind}`)
  }
  return { absolutePath: resolved, relativePath }
}

export async function* walkSafeFiles(
  root: SafeScanRoot,
  relativeDirectory: string,
  options: WalkSafeFilesOptions
): AsyncGenerator<SafeScanPath[]> {
  validateWalkOptions(options)
  const start = relativeDirectory
    ? await resolveSafeExistingPath(root, relativeDirectory, 'directory')
    : {
        absolutePath: root.absolutePath,
        relativePath: ''
      }
  let visitedEntries = 0
  let page: SafeScanPath[] = []

  async function* visit(directory: SafeScanPath, depth: number): AsyncGenerator<SafeScanPath[]> {
    throwIfAborted(options.signal)
    if (depth > options.maxDepth) {
      throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Scan directory depth exceeds the configured limit')
    }
    const entryNames: string[] = []
    const handle = await fs.opendir(directory.absolutePath)
    try {
      for await (const entry of handle) {
        throwIfAborted(options.signal)
        visitedEntries += 1
        options.onEntry?.()
        if (visitedEntries > options.maxEntries) {
          throw new ScanExecutorError(
            'INPUT_SNAPSHOT_INVALID',
            `Scan discovery exceeds the configured entry limit (${options.maxEntries})`
          )
        }
        if (entry.name === '.' || entry.name === '..') continue
        entryNames.push(entry.name)
      }
    } finally {
      await handle.close().catch(() => undefined)
    }
    entryNames.sort(compareCodePoints)
    for (const entryName of entryNames) {
      throwIfAborted(options.signal)
      const relativePath = joinRelative(directory.relativePath, entryName)
      const absolutePath = path.join(directory.absolutePath, entryName)
      const metadata = await fs.lstat(absolutePath)
      if (metadata.isSymbolicLink()) {
        throw new ScanExecutorError('SYMLINK_NOT_ALLOWED', 'Scan discovery encountered a symbolic link')
      }
      if (metadata.isDirectory()) {
        yield* visit({ absolutePath, relativePath }, depth + 1)
        continue
      }
      if (!metadata.isFile() || !options.include(relativePath)) continue
      const resolved = await fs.realpath(absolutePath)
      assertWithinRoot(root.absolutePath, resolved)
      page.push({ absolutePath: resolved, relativePath })
      if (page.length === options.pageSize) {
        const completedPage = page
        page = []
        yield completedPage
      }
    }
  }

  yield* visit(start, 0)
  if (page.length > 0) yield page
}

export function normalizeRelativeScanPath(value: string): string {
  const normalizedSlashes = value.trim().replace(/\\/g, '/')
  if (!normalizedSlashes || normalizedSlashes.includes('\0') || path.posix.isAbsolute(normalizedSlashes)) {
    throw new ScanExecutorError('PATH_OUTSIDE_SCAN_ROOT', 'Scan input must be a non-empty relative path')
  }
  if (/^[A-Za-z]:/.test(normalizedSlashes)) {
    throw new ScanExecutorError('PATH_OUTSIDE_SCAN_ROOT', 'Scan input must not contain a drive prefix')
  }
  const segments = normalizedSlashes.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new ScanExecutorError('PATH_OUTSIDE_SCAN_ROOT', 'Scan input contains an unsafe path segment')
  }
  return segments.join('/')
}

export function assertCanonicalRelativeScanPath(value: string): string {
  const normalized = normalizeRelativeScanPath(value)
  if (normalized !== value) {
    throw new ScanExecutorError('INPUT_SNAPSHOT_INVALID', 'Frozen input path is not canonical POSIX relative form')
  }
  return normalized
}

export function relativeFromRoot(root: SafeScanRoot, absolutePath: string): string {
  assertWithinRoot(root.absolutePath, absolutePath)
  const relative = path.relative(root.absolutePath, absolutePath).replace(/\\/g, '/')
  if (!relative) throw new ScanExecutorError('PATH_OUTSIDE_SCAN_ROOT', 'Scan root itself is not an input item')
  return normalizeRelativeScanPath(relative)
}

function joinRelative(parent: string, child: string): string {
  return parent ? `${parent}/${child}` : child
}

function assertWithinRoot(root: string, candidate: string): void {
  const relative = path.relative(root, candidate)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return
  throw new ScanExecutorError('PATH_OUTSIDE_SCAN_ROOT', 'Scan input resolves outside the configured root')
}

function validateWalkOptions(options: WalkSafeFilesOptions): void {
  for (const [name, value] of [
    ['pageSize', options.pageSize],
    ['maxDepth', options.maxDepth],
    ['maxEntries', options.maxEntries]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new ScanExecutorError('CONFIGURATION_INVALID', `${name} must be a positive integer`)
    }
  }
}

function nodeErrorCode(error: unknown): string | undefined {
  return error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined
}
