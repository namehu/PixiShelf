import { lockContentDirectories } from './media-content-common'
import { contentDirectoriesHaveWriter } from './media-content-directory'
import type { MediaContentDirectorySnapshot } from './media-content-types'
import { Prisma } from '@prisma/client'
import { ArtworkDedupOperationError } from './artwork-dedup-operation'
export const ARTWORK_DEDUP_VISUAL_EVIDENCE_VERSION = 'dct63-grid3-crop-local1-v1'
export function assertArtworkDedupVisualSummary(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ArtworkDedupOperationError('VISUAL_EVIDENCE_REQUIRED')
  const v = value as Record<string, Prisma.JsonValue>
  const counts = ['leftFileCount', 'rightFileCount', 'pairedCount', 'exactCount', 'similarCount', 'leftUnmatchedCount', 'rightUnmatchedCount', 'leftUncheckedCount', 'rightUncheckedCount']
  if (v.evidenceVersion !== ARTWORK_DEDUP_VISUAL_EVIDENCE_VERSION ||
    !Number.isSafeInteger(v.leftArtworkId) || !Number.isSafeInteger(v.rightArtworkId) ||
    Number(v.leftArtworkId) <= 0 || Number(v.leftArtworkId) >= Number(v.rightArtworkId) ||
    counts.some(key => typeof v[key] !== 'string' || !/^\d{1,10}$/.test(v[key] as string)))
    throw new ArtworkDedupOperationError('VISUAL_EVIDENCE_REQUIRED')
  const n = (key: string) => Number(v[key])
  if (!n('leftFileCount') || !n('rightFileCount') || !n('similarCount') ||
    n('leftFileCount') > 2000 || n('rightFileCount') > 2000 || n('leftUncheckedCount') || n('rightUncheckedCount') ||
    n('pairedCount') !== n('exactCount') + n('similarCount') ||
    n('pairedCount') + n('leftUnmatchedCount') !== n('leftFileCount') ||
    n('pairedCount') + n('rightUnmatchedCount') !== n('rightFileCount') ||
    n('pairedCount') / Math.min(n('leftFileCount'), n('rightFileCount')) < 0.8)
    throw new ArtworkDedupOperationError('VISUAL_EVIDENCE_REQUIRED')
  return { leftArtworkId: Number(v.leftArtworkId), rightArtworkId: Number(v.rightArtworkId), leftFileCount: BigInt(n('leftFileCount')), rightFileCount: BigInt(n('rightFileCount')) }
}

/** All root/ancestor directory locks precede Artwork locks, across both media roots. */
export async function assertArtworkDedupVisualDirectories(tx: Prisma.TransactionClient, snapshots: readonly MediaContentDirectorySnapshot[]) {
  if (snapshots.length > 10_000) throw new RangeError('Visual directory budget')
  if (!snapshots.length) return true
  const roots = new Map<string, MediaContentDirectorySnapshot>()
  for (const snapshot of snapshots) {
    const root = roots.get(snapshot.logicalRoot)
    if (root && root.rootIdentity !== snapshot.rootIdentity) return false
    roots.set(snapshot.logicalRoot, snapshot)
  }
  // Root locks serialize all ancestor mutations before directory batches. The
  // existing helper accepts at most 100 keys, even when this publication is larger.
  await lockContentDirectories(tx, [...roots.values()].map(root => ({ ...root, relativeDirectory: '' })))
  const ordered = [...snapshots].sort((a, b) => a.logicalRoot < b.logicalRoot ? -1 : a.logicalRoot > b.logicalRoot ? 1 : a.relativeDirectory < b.relativeDirectory ? -1 : a.relativeDirectory > b.relativeDirectory ? 1 : 0)
  for (let start = 0; start < ordered.length; start += 100) {
    const batch = ordered.slice(start, start + 100)
    const rows = await lockContentDirectories(tx, batch)
    if (batch.some(s => { const row = rows.get(`${s.logicalRoot}\0${s.relativeDirectory}`); return !row || row.id !== s.directoryId || row.generation !== s.generation })) return false
    if (await contentDirectoriesHaveWriter(tx, batch)) return false
  }
  return true
}
