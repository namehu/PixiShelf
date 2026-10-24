import {
  ArtworkDedupOperationError,
  assertArtworkDedupSources,
  assertArtworkDedupPathWritable,
  lockCreatorCatalog,
  type MediaContentDirectoryKey,
  type Prisma
} from '@pixishelf/db'
import { parseArtworkDedupSourceSnapshot, type ArtworkDedupSourceSnapshot } from '@pixishelf/job-contracts'
import { ArchiveExecutorError } from './errors.ts'
import { lockArchiveUploaderCatalogIdentities } from './uploader-catalog-lock.ts'

export type ArchiveSourceProofOwner = {
  providerKey: string
  externalId: string
  dedupSourceSnapshot: unknown
}

export function parseArchiveSourceSnapshot(input: ArchiveSourceProofOwner): ArtworkDedupSourceSnapshot {
  let snapshot: ArtworkDedupSourceSnapshot
  try {
    snapshot = parseArtworkDedupSourceSnapshot(input.dedupSourceSnapshot)
  } catch {
    throw invalidProof()
  }
  const identity = snapshot.sources[0]?.identity
  if (
    snapshot.sources.length !== 1 ||
    identity?.kind !== 'PROVIDER' ||
    identity.providerKey !== input.providerKey ||
    identity.externalId !== input.externalId
  )
    {throw invalidProof()}
  return snapshot
}

export async function assertArchiveSourceSnapshot(
  transaction: Prisma.TransactionClient,
  input: ArchiveSourceProofOwner
) {
  const snapshot = parseArchiveSourceSnapshot(input)
  try {
    await assertArtworkDedupSources(transaction, {
      sources: snapshot.sources.map((source) => ({ ...source, generation: BigInt(source.generation) }))
    })
  } catch (error) {
    if (error instanceof ArtworkDedupOperationError) {
      throw new ArchiveExecutorError(
        'STATE_CONFLICT',
        `归档原来源证明已失效（${error.code}），请保留原任务并核对来源后重新提交`,
        { cause: error }
      )
    }
    throw error
  }
  return snapshot
}

/** Acquire the complete publication lock prefix before any content/Artwork helper. */
export async function lockArchiveSourcePublication(
  transaction: Prisma.TransactionClient,
  input: ArchiveSourceProofOwner & {
    canonicalUrl: string
    directory?: MediaContentDirectoryKey
  }
) {
  await lockCreatorCatalog(transaction)
  await transaction.$queryRawUnsafe('SELECT pg_advisory_xact_lock($1)::text', 7_341_902_117)
  await lockArchiveUploaderCatalogIdentities(transaction, [
    { providerKey: input.providerKey, externalId: input.externalId, canonicalUrls: [input.canonicalUrl] }
  ])
  if (input.directory)
    {await assertArtworkDedupPathWritable(transaction, { directory: input.directory, scope: { kind: 'DIRECTORY' } })}
  return assertArchiveSourceSnapshot(transaction, input)
}

export async function assertArchiveDownloadGeneration(
  transaction: Prisma.TransactionClient,
  input: {
    archiveImport: ArchiveSourceProofOwner & { id: string }
    jobId: string
    token: string
  }
) {
  await assertArchiveSourceSnapshot(transaction, input.archiveImport)
  const current = await transaction.archiveImport.findUnique({ where: { id: input.archiveImport.id } })
  const generation = await transaction.archiveStagingGeneration.findUnique({ where: { token: input.token } })
  if (
    !current ||
    current.systemJobId !== input.jobId ||
    current.phase !== 'DOWNLOAD' ||
    current.status !== 'RUNNING' ||
    current.generationToken !== input.token ||
    current.cleanupRequestedAt ||
    !generation ||
    generation.jobId !== input.jobId ||
    generation.archiveImportId !== current.id ||
    generation.drainedAt ||
    generation.sealedAt ||
    generation.cleanedAt ||
    JSON.stringify(parseArchiveSourceSnapshot(current)) !==
      JSON.stringify(parseArchiveSourceSnapshot(input.archiveImport))
  ) {
    throw new ArchiveExecutorError('STATE_CONFLICT', '归档下载代已变化或已有退出证明，不能继续媒体操作')
  }
}

function invalidProof() {
  return new ArchiveExecutorError('STATE_CONFLICT', '归档缺少与原意图匹配的持久来源证明；请保留原任务并新建提交')
}

export function assertArchiveSourceUnchanged(current: ArchiveSourceProofOwner, original: ArchiveSourceProofOwner) {
  if (JSON.stringify(parseArchiveSourceSnapshot(current)) !== JSON.stringify(parseArchiveSourceSnapshot(original)))
    {throw invalidProof()}
}
