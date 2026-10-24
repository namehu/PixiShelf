import { serializeArtworkDedupSourceSnapshot } from '@pixishelf/job-contracts'
import { pixivScanSourceIdentities } from '../dedup-source-snapshot.ts'

/** A new synthetic input intent; never use this to repair a persisted legacy row. */
export function pixivSourceProofFixture(relativePath = 'a/42-meta.json') {
  return serializeArtworkDedupSourceSnapshot(
    pixivScanSourceIdentities({ rootIdentity: 'fixture-root', relativePath }).map((identity, index) => ({
      identity,
      sourceId: `fixture-source-${index}`,
      generation: 3n
    }))
  )
}
export function localSourceProofFixture(relativePath = 'local-imports/Artist/Work') {
  return serializeArtworkDedupSourceSnapshot([
    {
      identity: {
        kind: 'DIRECTORY',
        logicalRoot: 'source-media:v1',
        rootIdentity: 'fixture-root',
        canonicalPath: relativePath
      },
      sourceId: 'fixture-local',
      generation: 3n
    }
  ])
}
