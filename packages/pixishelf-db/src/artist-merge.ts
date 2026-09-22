import { Prisma } from '@prisma/client'
import { creatorFingerprint, lockCreatorCatalog, visibleCreatorArtwork } from './creators'

export const availableArtist = { mergedIntoId: null } as const
const unfinished = ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'RETRY_WAIT', 'CANCELLING'] as const
const globalCreatorJobs = new Set([
  'SCAN',
  'LOCAL_DIRECTORY_IMPORT',
  'MIGRATION',
  'PENDING_REPLACE',
  'ARCHIVE_IMPORT',
  'ARCHIVE_MAINTENANCE',
  'PIXIV_ARTWORK_ENRICHMENT'
])

export async function requireAvailableArtist(tx: Prisma.TransactionClient, id: number) {
  const artist = await tx.artist.findUnique({ where: { id } })
  if (!artist || artist.mergedIntoId !== null) throw new Error('艺术家已不存在或已合并，请刷新后重新选择')
  return artist
}

export async function resolveArtistId(tx: Prisma.TransactionClient, id: number): Promise<number> {
  const visited = new Set<number>()
  for (;;) {
    if (visited.has(id)) throw new Error('艺术家合并链存在循环')
    visited.add(id)
    const artist = await tx.artist.findUniqueOrThrow({ where: { id }, select: { mergedIntoId: true } })
    if (artist.mergedIntoId === null) return id
    id = artist.mergedIntoId
  }
}

function record(value: Prisma.JsonValue | null): Prisma.JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

export async function artistMergeBlockers(tx: Prisma.TransactionClient, ids: number[], excludeJobId?: string) {
  const jobs = await tx.systemJob.findMany({
    where: { status: { in: [...unfinished] }, ...(excludeJobId ? { id: { not: excludeJobId } } : {}) },
    select: {
      id: true,
      type: true,
      status: true,
      payload: true,
      archiveUploaderScanRun: { select: { defaultCreatorIds: true } }
    },
    orderBy: { createdAt: 'asc' }
  })
  const blockers: { jobId: string; type: string; status: string; reason: string }[] = []
  for (const job of jobs) {
    const payload = record(job.payload)
    let relevant = globalCreatorJobs.has(job.type)
    let reason = '该任务可能读取或写入艺术家，无法证明与本次合并无关'
    if (job.type === 'PIXIV_ARTIST_ENRICHMENT') {
      relevant =
        typeof payload.artistId === 'number'
          ? ids.includes(payload.artistId)
          : Array.isArray(payload.artistIds)
            ? payload.artistIds.some((id) => typeof id === 'number' && ids.includes(id))
            : true
    }
    if (job.type === 'ARCHIVE_UPLOADER_SCAN' || job.type === 'ARCHIVE_SEARCH_SCAN') {
      const snapshot = job.archiveUploaderScanRun?.defaultCreatorIds
      relevant = !snapshot || snapshot.some((id) => ids.includes(id))
      reason = '扫描任务保存了艺术家绑定快照，请先完成或取消该任务'
    }
    if (job.type === 'CREATOR_MAINTENANCE') {
      const plan =
        typeof payload.planId === 'string'
          ? await tx.creatorMaintenancePlan.findUnique({ where: { id: payload.planId } })
          : null
      const input = record(plan?.input ?? null)
      // BACKFILL and REMAP may discover either entity through source evidence.
      relevant =
        input.command !== 'SERIES' &&
        (!Array.isArray(input.creatorIds) || input.creatorIds.some((id) => typeof id === 'number' && ids.includes(id)))
    }
    if (job.type === 'ARTIST_MERGE') relevant = true
    if (relevant) blockers.push({ jobId: job.id, type: job.type, status: job.status, reason })
  }
  return blockers
}

export async function captureArtistMerge(tx: Prisma.TransactionClient, sourceArtistId: number, targetArtistId: number) {
  if (sourceArtistId === targetArtistId) throw new Error('不能合并到自身')
  const source = await requireAvailableArtist(tx, sourceArtistId)
  const target = await requireAvailableArtist(tx, targetArtistId)
  if (source.kind !== target.kind) throw new Error('艺术家和社团不能互相合并')
  const where = { artistId: { in: [sourceArtistId, targetArtistId] } }
  const refs = await tx.artistExternalRef.findMany({ where, orderBy: { id: 'asc' } })
  const conflicts = refs.filter(
    (ref) =>
      ref.artistId === sourceArtistId &&
      refs.some(
        (other) =>
          other.artistId === targetArtistId &&
          other.providerKey === ref.providerKey &&
          other.externalId !== ref.externalId
      )
  )
  const memberships = await tx.artworkArtist.findMany({
    where,
    orderBy: { id: 'asc' },
    include: {
      evidence: { orderBy: { id: 'asc' } },
      artwork: { select: { deletedAt: true, archiveLifecycleState: true } }
    }
  })
  const tagMappings = await tx.artistSourceTagMapping.findMany({ where, orderBy: { id: 'asc' } })
  const localMappings = await tx.localImportArtistMapping.findMany({ where, orderBy: { id: 'asc' } })
  const defaults = await tx.discoverySourceCreator.findMany({
    where,
    orderBy: [{ sourceId: 'asc' }, { artistId: 'asc' }]
  })
  const pending = await tx.discoveryPendingCreator.findMany({ where, orderBy: { id: 'asc' } })
  const suppressions = await tx.discoveryCreatorSuppression.findMany({
    where,
    orderBy: [{ providerKey: 'asc' }, { externalId: 'asc' }, { artistId: 'asc' }]
  })
  const visible = (id: number) =>
    new Set(
      memberships
        .filter(
          (m) =>
            m.artistId === id &&
            m.artwork.deletedAt === visibleCreatorArtwork.deletedAt &&
            m.artwork.archiveLifecycleState === visibleCreatorArtwork.archiveLifecycleState &&
            m.evidence.some((e) => e.present && e.excludedAt === null)
        )
        .map((m) => m.artworkId)
    )
  const sourceWorks = visible(sourceArtistId),
    targetWorks = visible(targetArtistId)
  const before = { source, target, refs, memberships, tagMappings, localMappings, defaults, pending, suppressions }
  return {
    before,
    fingerprint: creatorFingerprint(before),
    summary: {
      source: {
        id: source.id,
        name: source.name,
        kind: source.kind,
        bio: source.bio,
        avatar: source.avatar,
        backgroundImg: source.backgroundImg,
        isStarred: source.isStarred
      },
      target: {
        id: target.id,
        name: target.name,
        kind: target.kind,
        bio: target.bio,
        avatar: target.avatar,
        backgroundImg: target.backgroundImg,
        isStarred: target.isStarred
      },
      sourceCount: sourceWorks.size,
      targetCount: targetWorks.size,
      commonCount: [...sourceWorks].filter((id) => targetWorks.has(id)).length,
      mergedCount: new Set([...sourceWorks, ...targetWorks]).size,
      allMemberships: memberships.filter((m) => m.artistId === sourceArtistId).length,
      identities: refs.map((ref) => ({
        artistId: ref.artistId,
        providerKey: ref.providerKey,
        externalId: ref.externalId
      })),
      tagMappings: tagMappings.filter((row) => row.artistId === sourceArtistId).length,
      localMappings: localMappings.filter((row) => row.artistId === sourceArtistId).length,
      defaults: defaults.filter((row) => row.artistId === sourceArtistId).length,
      pending: pending.filter((row) => row.artistId === sourceArtistId).length,
      suppressions: suppressions.filter((row) => row.artistId === sourceArtistId).length,
      conflicts: conflicts.map((ref) => `${ref.providerKey} 绑定了不同外部账号，不能合并`)
    }
  }
}

export function mergeEvidenceState(
  a: { present: boolean; excludedAt: Date | null },
  b: { present: boolean; excludedAt: Date | null }
) {
  const active = (a.present && !a.excludedAt) || (b.present && !b.excludedAt)
  return { present: a.present || b.present, excludedAt: active ? null : (a.excludedAt ?? b.excludedAt) }
}

export const mergeJson = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue

/** Caller must commit this mutation and the queue terminal state in the same fenced transaction. */
export async function applyArtistMerge(tx: Prisma.TransactionClient, mergeId: string, jobId?: string) {
  await lockCreatorCatalog(tx)
  const plan = await tx.artistMerge.findUniqueOrThrow({ where: { id: mergeId } })
  if (plan.status === 'COMPLETE') return plan.summary
  if (plan.status !== 'QUEUED') throw new Error('合并尚未确认')
  const current = await captureArtistMerge(tx, plan.sourceArtistId, plan.targetArtistId)
  if (current.fingerprint !== plan.fingerprint) throw new Error('资料或绑定已变化，请重新预览')
  if (current.summary.conflicts.length) throw new Error(current.summary.conflicts.join('；'))
  if ((await artistMergeBlockers(tx, [plan.sourceArtistId, plan.targetArtistId], jobId)).length)
    throw new Error('存在相关未结束任务，请处理后重试')
  const sourceId = plan.sourceArtistId,
    targetId = plan.targetArtistId
  for (const membership of current.before.memberships.filter((m) => m.artistId === sourceId)) {
    const target = await tx.artworkArtist.upsert({
      where: { artworkId_artistId: { artworkId: membership.artworkId, artistId: targetId } },
      create: { artworkId: membership.artworkId, artistId: targetId },
      update: {}
    })
    for (const evidence of membership.evidence) {
      const duplicate = await tx.artworkArtistEvidence.findUnique({
        where: { membershipId_evidenceKey: { membershipId: target.id, evidenceKey: evidence.evidenceKey } }
      })
      if (duplicate) {
        await tx.artworkArtistEvidence.update({
          where: { id: duplicate.id },
          data: mergeEvidenceState(duplicate, evidence)
        })
        await tx.artworkArtistEvidence.delete({ where: { id: evidence.id } })
      } else await tx.artworkArtistEvidence.update({ where: { id: evidence.id }, data: { membershipId: target.id } })
    }
    await tx.artworkArtist.delete({ where: { id: membership.id } })
  }
  await tx.artistExternalRef.updateMany({ where: { artistId: sourceId }, data: { artistId: targetId } })
  await tx.localImportArtistMapping.updateMany({ where: { artistId: sourceId }, data: { artistId: targetId } })
  await tx.artistSourceTagMapping.updateMany({
    where: { artistId: sourceId },
    data: { artistId: targetId, version: { increment: 1 } }
  })
  for (const row of current.before.defaults.filter((r) => r.artistId === sourceId)) {
    await tx.discoverySourceCreator.upsert({
      where: { sourceId_artistId: { sourceId: row.sourceId, artistId: targetId } },
      create: { sourceId: row.sourceId, artistId: targetId },
      update: {}
    })
  }
  await tx.discoverySourceCreator.deleteMany({ where: { artistId: sourceId } })
  for (const row of current.before.pending.filter((r) => r.artistId === sourceId)) {
    await tx.discoveryPendingCreator.upsert({
      where: {
        providerKey_externalId_artistId: {
          providerKey: row.providerKey,
          externalId: row.externalId,
          artistId: targetId
        }
      },
      create: {
        providerKey: row.providerKey,
        externalId: row.externalId,
        title: row.title,
        requestedByUserId: row.requestedByUserId,
        createdAt: row.createdAt,
        artistId: targetId
      },
      update: {}
    })
  }
  await tx.discoveryPendingCreator.deleteMany({ where: { artistId: sourceId } })
  for (const row of current.before.suppressions.filter((r) => r.artistId === sourceId)) {
    await tx.discoveryCreatorSuppression.upsert({
      where: {
        providerKey_externalId_artistId: {
          providerKey: row.providerKey,
          externalId: row.externalId,
          artistId: targetId
        }
      },
      create: { ...row, artistId: targetId },
      update: {}
    })
  }
  await tx.discoveryCreatorSuppression.deleteMany({ where: { artistId: sourceId } })
  const after = await captureArtistMerge(tx, sourceId, targetId)
  const completedAt = new Date()
  await tx.artist.update({ where: { id: sourceId }, data: { mergedIntoId: targetId, mergedAt: completedAt } })
  await tx.artistMerge.update({
    where: { id: mergeId },
    data: {
      status: 'COMPLETE',
      completedAt,
      after: mergeJson({
        ...after.before,
        source: { ...after.before.source, mergedIntoId: targetId, mergedAt: completedAt }
      })
    }
  })
  return plan.summary
}
