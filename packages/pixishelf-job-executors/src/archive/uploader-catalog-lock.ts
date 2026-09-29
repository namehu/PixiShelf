import {
  ARCHIVE_UPLOADER_IDENTITY_LOCK_NAMESPACE,
  archiveUploaderIdentityLockKey,
  archiveUploaderUrlLockKey
} from '@pixishelf/job-contracts'

interface AdvisoryLockTransaction {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>
}

export async function lockArchiveUploaderCatalogIdentities(
  transaction: AdvisoryLockTransaction,
  identities: Array<{
    providerKey?: string | null | undefined
    externalId?: string | null | undefined
    canonicalUrls?: Array<string | null | undefined>
  }>
) {
  const keys = [
    ...new Set(
      identities.flatMap((identity) => [
        ...(identity.providerKey && identity.externalId
          ? [archiveUploaderIdentityLockKey(identity.providerKey, identity.externalId)]
          : []),
        ...(identity.canonicalUrls ?? [])
          .filter((value): value is string => Boolean(value))
          .map(archiveUploaderUrlLockKey)
      ])
    )
  ].sort()
  for (const key of keys) {
    await transaction.$queryRawUnsafe(
      'SELECT pg_advisory_xact_lock($1::integer, hashtext($2::text))::text AS "lock"',
      ARCHIVE_UPLOADER_IDENTITY_LOCK_NAMESPACE,
      key
    )
  }
}
