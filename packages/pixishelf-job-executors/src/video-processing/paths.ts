import * as fs from 'node:fs/promises'
import path from 'node:path'
import { VideoProcessingPermanentError } from './types.ts'

export async function resolveExistingPathWithinRoot(root: string, relativePath: string): Promise<string> {
  const normalized = normalizeRelativePath(relativePath)
  assertRelativePath(normalized)
  const lexicalTarget = path.resolve(root, normalized)
  await assertNoFinalSymlink(lexicalTarget)
  const [realRoot, realTarget] = await Promise.all([fs.realpath(root), fs.realpath(lexicalTarget)])
  assertContained(realRoot, realTarget)
  return realTarget
}

export async function resolveCreatablePathWithinRoot(root: string, relativePath: string): Promise<string> {
  const normalized = normalizeRelativePath(relativePath)
  assertRelativePath(normalized)
  const realRoot = await fs.realpath(root)
  const target = path.resolve(realRoot, normalized)
  assertContained(realRoot, target)
  await assertNoFinalSymlink(target)
  await fs.mkdir(path.dirname(target), { recursive: true })
  const realParent = await fs.realpath(path.dirname(target))
  assertContained(realRoot, realParent)
  return path.join(realParent, path.basename(target))
}

export async function assertNoFinalSymlink(filePath: string) {
  try {
    const stat = await fs.lstat(filePath)
    if (stat.isSymbolicLink()) {
      throw new VideoProcessingPermanentError(
        'PATH_OUTSIDE_ALLOWED_ROOT',
        'Symbolic links are not allowed for video processing source or artifact files'
      )
    }
    return stat
  } catch (error) {
    if ((error as NodeJS.ErrnoException | null)?.code === 'ENOENT') return null
    throw error
  }
}

export function normalizeArtifactId(value: string): string {
  const normalized = value.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 120)
  if (!normalized) throw new Error('Artifact id must contain at least one safe character')
  return normalized
}

function assertRelativePath(relativePath: string) {
  if (
    !relativePath ||
    path.isAbsolute(relativePath) ||
    /^[a-zA-Z]:/.test(relativePath) ||
    relativePath.split(/[\\/]+/).includes('..')
  ) {
    throw new VideoProcessingPermanentError(
      'PATH_OUTSIDE_ALLOWED_ROOT',
      'Media path must be relative and remain inside the configured root'
    )
  }
}

function normalizeRelativePath(relativePath: string) {
  return relativePath
    .replace(/^[/\\]+/, '')
    .split(/[\\/]+/)
    .join(path.sep)
}

function assertContained(root: string, target: string) {
  const relative = path.relative(root, target)
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new VideoProcessingPermanentError(
      'PATH_OUTSIDE_ALLOWED_ROOT',
      'Resolved media path escapes the configured root'
    )
  }
}
