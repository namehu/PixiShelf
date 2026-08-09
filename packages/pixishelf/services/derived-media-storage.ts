import 'server-only'

import path from 'node:path'
import { normalizeDerivedMediaRelativePath } from '@/lib/derived-media'

export function getDerivedMediaStorageRoot(options?: { configuredPath?: string; cwd?: string }): string {
  const configuredPath = options?.configuredPath ?? process.env.DERIVED_MEDIA_STORAGE_PATH
  const cwd = options?.cwd ?? process.cwd()
  return path.resolve(configuredPath?.trim() || path.join(cwd, '.local-data', 'derived-media'))
}

export const DERIVED_MEDIA_STORAGE_ROOT = getDerivedMediaStorageRoot()
export const VIDEO_POSTER_STORAGE_ROOT = path.join(DERIVED_MEDIA_STORAGE_ROOT, 'video', 'posters')
export const VIDEO_CHAPTER_PREVIEW_STORAGE_ROOT = path.join(DERIVED_MEDIA_STORAGE_ROOT, 'video', 'chapters')

export function resolveDerivedMediaStoragePath(typeRoot: string, relativePath: string): string {
  const normalized = normalizeDerivedMediaRelativePath(relativePath)
  if (!normalized) {
    throw new Error(`Invalid derived media path: ${relativePath}`)
  }

  const resolvedRoot = path.resolve(typeRoot)
  const resolvedPath = path.resolve(resolvedRoot, ...normalized.split('/'))
  const relativeToRoot = path.relative(resolvedRoot, resolvedPath)
  if (relativeToRoot === '..' || relativeToRoot.startsWith(`..${path.sep}`) || path.isAbsolute(relativeToRoot)) {
    throw new Error(`Derived media path escapes its storage root: ${relativePath}`)
  }

  return resolvedPath
}
