import * as fs from 'node:fs/promises'
import path from 'node:path'
import { VideoMediaPermanentError } from './types.js'

export async function resolveVideoSource(scanRoot: string, relativePath: string) {
  const root = await fs.realpath(scanRoot)
  const candidate = path.resolve(root, relativePath.replace(/^[/\\]+/, ''))
  assertWithinRoot(root, candidate)
  let resolved: string
  try {
    resolved = await fs.realpath(candidate)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new VideoMediaPermanentError('SOURCE_NOT_FOUND', 'Video source file was not found')
    }
    throw error
  }
  assertWithinRoot(root, resolved)
  const metadata = await fs.stat(resolved)
  if (!metadata.isFile()) throw new VideoMediaPermanentError('PRECONDITION_FAILED', 'Video source path is not a file')
  return { sourcePath: resolved, stat: metadata }
}

export async function resolvePosterOutput(posterRoot: string, relativePath: string) {
  await fs.mkdir(posterRoot, { recursive: true })
  const root = await fs.realpath(posterRoot)
  const candidate = path.resolve(root, relativePath.replace(/^[/\\]+/, ''))
  assertWithinRoot(root, candidate)
  const ancestor = await nearestExistingAncestor(candidate)
  assertWithinRoot(root, await fs.realpath(ancestor))
  return candidate
}

export async function inspectGcCandidate(storageRoot: string, relativePath: string) {
  const outputPath = await resolvePosterOutput(storageRoot, relativePath)
  let metadata: Awaited<ReturnType<typeof fs.lstat>>
  try {
    metadata = await fs.lstat(outputPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { outputPath, exists: false as const }
    throw error
  }
  if (metadata.isSymbolicLink()) {
    throw new VideoMediaPermanentError('PATH_OUTSIDE_ALLOWED_ROOT', 'GC refuses to follow a symbolic link')
  }
  const root = await fs.realpath(storageRoot)
  const resolved = await fs.realpath(outputPath)
  assertWithinRoot(root, resolved)
  if (!metadata.isFile()) throw new VideoMediaPermanentError('PRECONDITION_FAILED', 'GC candidate is not a file')
  return { outputPath: resolved, exists: true as const }
}

function assertWithinRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return
  throw new VideoMediaPermanentError('PATH_OUTSIDE_ALLOWED_ROOT', 'Path is outside the configured media root')
}

async function nearestExistingAncestor(candidate: string): Promise<string> {
  let current = candidate
  while (true) {
    try {
      await fs.lstat(current)
      return current
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      const parent = path.dirname(current)
      if (parent === current) throw error
      current = parent
    }
  }
}
