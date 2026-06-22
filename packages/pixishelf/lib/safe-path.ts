import { lstat, realpath } from 'fs/promises'
import path from 'path'

export class UnsafePathError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnsafePathError'
  }
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`))
}

function assertWithinRoot(root: string, candidate: string): void {
  if (!isWithinRoot(root, candidate)) {
    throw new UnsafePathError('Path escapes scan root')
  }
}

export function assertSafeFileName(fileName: string): string {
  if (!fileName || fileName === '.' || fileName === '..' || path.isAbsolute(fileName) || /[\\/]/.test(fileName)) {
    throw new UnsafePathError('Invalid file name')
  }

  return fileName
}

function resolveCandidate(root: string, candidate: string): { root: string; candidate: string } {
  const resolvedRoot = path.resolve(root)
  const resolvedCandidate = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(resolvedRoot, candidate)
  assertWithinRoot(resolvedRoot, resolvedCandidate)

  return { root: resolvedRoot, candidate: resolvedCandidate }
}

async function nearestExistingAncestor(candidate: string): Promise<string> {
  let current = candidate

  while (true) {
    try {
      await lstat(current)
      return current
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }

      const parent = path.dirname(current)
      if (parent === current) {
        throw error
      }
      current = parent
    }
  }
}

export async function resolveExistingPathWithinRoot(root: string, candidate: string): Promise<string> {
  const resolved = resolveCandidate(root, candidate)
  const [canonicalRoot, canonicalCandidate] = await Promise.all([realpath(resolved.root), realpath(resolved.candidate)])
  assertWithinRoot(canonicalRoot, canonicalCandidate)

  return canonicalCandidate
}

export async function resolveCreatablePathWithinRoot(root: string, candidate: string): Promise<string> {
  const resolved = resolveCandidate(root, candidate)
  const existingAncestor = await nearestExistingAncestor(resolved.candidate)
  const [canonicalRoot, canonicalAncestor] = await Promise.all([realpath(resolved.root), realpath(existingAncestor)])
  assertWithinRoot(canonicalRoot, canonicalAncestor)

  return resolved.candidate
}
