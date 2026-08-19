import * as fs from 'node:fs/promises'
import path from 'node:path'
import { VideoKeyframePermanentError } from './types.ts'

export async function resolveSourceFile(scanRoot: string, relativePath: string) {
  const normalized = relativePath.replace(/^[/\\]+/, '')
  const root = await fs.realpath(scanRoot)
  const candidate = path.resolve(root, normalized)
  assertWithinRoot(root, candidate)
  const resolved = await fs.realpath(candidate)
  assertWithinRoot(root, resolved)
  const stat = await fs.stat(resolved)
  if (!stat.isFile()) throw new Error('Video path is not a file')
  return { sourcePath: resolved, stat }
}

export async function resolveKeyframePath(storageRoot: string, relativePath: string) {
  const root = await fs.realpath(storageRoot)
  const candidate = path.resolve(root, relativePath.replace(/^[/\\]+/, ''))
  assertWithinRoot(root, candidate)
  const ancestor = await nearestExistingAncestor(candidate)
  assertWithinRoot(root, await fs.realpath(ancestor))
  return candidate
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

function assertWithinRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return
  throw new VideoKeyframePermanentError('PATH_OUTSIDE_ALLOWED_ROOT', 'Video path is outside the configured root')
}
