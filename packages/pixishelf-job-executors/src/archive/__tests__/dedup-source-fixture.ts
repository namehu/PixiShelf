import { captureArtworkDedupSources, type PrismaClient } from '@pixishelf/db'
import { serializeArtworkDedupSourceSnapshot } from '@pixishelf/job-contracts'

/** Synthetic new-intent fixture only; never used to upgrade a persisted historical intent. */
export function captureArchiveFixtureSource(database: PrismaClient, providerKey: string, externalId: string) {
  return database.$transaction(async (transaction) =>
    serializeArtworkDedupSourceSnapshot(
      await captureArtworkDedupSources(transaction, { identities: [{ kind: 'PROVIDER', providerKey, externalId }] })
    )
  )
}
