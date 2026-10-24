import {
  ArtworkDedupOperationError,
  assertArtworkDedupSources,
  captureArtworkDedupSourceGroups,
  type Prisma
} from '@pixishelf/db'
import { parseArtworkDedupSourceSnapshot, serializeArtworkDedupSourceSnapshot } from '@pixishelf/job-contracts'
import { ArchiveError } from '@/services/archive/errors'
import { archiveProviderRegistry } from '@/services/archive/provider-registry'

export function parseArchiveIntakeSourceProof(snapshot: unknown, submittedUrl: string) {
  try {
    const parsed = parseArtworkDedupSourceSnapshot(snapshot)
    const expected = archiveProviderRegistry.getForUrl(submittedUrl).identifySource(submittedUrl)
    const source = parsed.sources[0]
    if (
      parsed.sources.length !== 1 ||
      source?.identity.kind !== 'PROVIDER' ||
      source.identity.providerKey !== expected.providerKey ||
      source.identity.externalId !== expected.externalId
    )
      {throw new Error('Source identity does not match submitted URL')}
    return parsed
  } catch (error) {
    throw new ArchiveError('STATE_CONFLICT', '原收件意图缺少有效来源证明，请重新提交链接。', { cause: error })
  }
}

export function hasArchiveIntakeSourceProof(snapshot: unknown, submittedUrl: string): boolean {
  try {
    parseArchiveIntakeSourceProof(snapshot, submittedUrl)
    return true
  } catch {
    return false
  }
}

/** Caller takes the creator catalog lock before the shared source locks. */
export async function captureArchiveIntakeSourceProofs(transaction: Prisma.TransactionClient, urls: readonly string[]) {
  try {
    const groups = await captureArtworkDedupSourceGroups(transaction, {
      groups: urls.map((url) => [archiveProviderRegistry.getForUrl(url).identifySource(url)])
    })
    return groups.map(serializeArtworkDedupSourceSnapshot)
  } catch (error) {
    if (error instanceof ArtworkDedupOperationError) {
      throw new ArchiveError('STATE_CONFLICT', '归档来源正在维护，当前不能创建新的收件意图。', { cause: error })
    }
    throw error
  }
}

export async function assertArchiveIntakeSourceProof(
  transaction: Prisma.TransactionClient,
  snapshot: unknown,
  submittedUrl: string
) {
  const parsed = parseArchiveIntakeSourceProof(snapshot, submittedUrl)
  try {
    await assertArtworkDedupSources(transaction, {
      sources: parsed.sources.map((source) => ({ ...source, generation: BigInt(source.generation) }))
    })
  } catch (error) {
    if (error instanceof ArtworkDedupOperationError) {
      throw new ArchiveError('STATE_CONFLICT', '原收件意图的来源证明已失效或正在维护，请重新提交链接。', {
        cause: error
      })
    }
    throw error
  }
}
