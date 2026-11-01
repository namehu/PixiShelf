import type { Prisma } from '@pixishelf/db'
import type { DedupRoots } from './reader-protocol.ts'

export function rootBindings(roots: DedupRoots) {
  return {
    version: 1,
    source: {
      logicalRoot: roots.source.logicalRoot,
      rootIdentity: roots.source.rootIdentity,
      physicalIdentity: roots.source.physicalIdentity ?? roots.source.rootIdentity
    },
    archive: {
      logicalRoot: roots.archive.logicalRoot,
      rootIdentity: roots.archive.rootIdentity,
      physicalIdentity: roots.archive.physicalIdentity ?? roots.archive.rootIdentity
    },
    archiveRelativePrefix: roots.archiveRelativePrefix
  }
}
export function sameRootBindings(value: Prisma.JsonValue, current: ReturnType<typeof rootBindings>): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const saved = value as Partial<ReturnType<typeof rootBindings>>
  return (
    saved.version === current.version &&
    saved.source?.logicalRoot === current.source.logicalRoot &&
    saved.source?.rootIdentity === current.source.rootIdentity &&
    (saved.source.physicalIdentity ?? saved.source.rootIdentity) === current.source.physicalIdentity &&
    saved.archive?.logicalRoot === current.archive.logicalRoot &&
    saved.archive?.rootIdentity === current.archive.rootIdentity &&
    (saved.archive.physicalIdentity ?? saved.archive.rootIdentity) === current.archive.physicalIdentity &&
    saved.archiveRelativePrefix === current.archiveRelativePrefix
  )
}
