import type { PrismaClient } from '@pixishelf/db'
import { readMediaContentRootBinding, resolveMediaContentRoots } from '../../media-content/index.ts'
import { hashScanRootIdentity } from '../inventory.ts'

/** Called only after the suite's executors stop, before deleting its temporary roots. */
export async function cleanupFixtureContentDirectories(
  database: Pick<PrismaClient, 'mediaContentDirectoryState' | 'mediaContentPathWrite' | 'pixivMetadataInventoryState'>,
  roots: readonly string[]
) {
  const rootIdentities: string[] = []
  const binding = await readMediaContentRootBinding(database)
  for (const root of roots) {
    try {
      const bindings = await resolveMediaContentRoots({
        sourceRoot: root,
        archiveRoot: root,
        expectedPixivRootIdentity: null
      })
      rootIdentities.push(bindings.source.rootIdentity)
      if (binding.sourceRootBinding?.pathHash === hashScanRootIdentity(bindings.source.absolutePath)) {
        const bound = await resolveMediaContentRoots({ sourceRoot: root, archiveRoot: root, ...binding })
        rootIdentities.push(bound.source.rootIdentity)
      }
    } catch {
      // Deliberately invalid/missing roots never acquire a content directory binding.
    }
  }
  if (rootIdentities.length) {
    await database.mediaContentPathWrite.deleteMany({ where: { directory: { rootIdentity: { in: rootIdentities } } } })
    await database.mediaContentDirectoryState.deleteMany({ where: { rootIdentity: { in: rootIdentities } } })
  }
}
