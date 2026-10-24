import type { PrismaClient } from '@pixishelf/db'
import { resolveMediaContentRoots } from '../../media-content/index.ts'

/** Called only after the suite's executors stop, before deleting its temporary roots. */
export async function cleanupFixtureContentDirectories(
  database: Pick<PrismaClient, 'mediaContentDirectoryState' | 'mediaContentPathWrite'>,
  roots: readonly string[]
) {
  const rootIdentities: string[] = []
  for (const root of roots) {
    try {
      const bindings = await resolveMediaContentRoots({
        sourceRoot: root,
        archiveRoot: root,
        expectedPixivRootIdentity: null
      })
      rootIdentities.push(bindings.source.rootIdentity)
    } catch {
      // Deliberately invalid/missing roots never acquire a content directory binding.
    }
  }
  if (rootIdentities.length) {
    await database.mediaContentPathWrite.deleteMany({ where: { directory: { rootIdentity: { in: rootIdentities } } } })
    await database.mediaContentDirectoryState.deleteMany({ where: { rootIdentity: { in: rootIdentities } } })
  }
}
