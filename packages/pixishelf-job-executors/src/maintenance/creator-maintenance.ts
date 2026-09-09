import { creatorMaintenanceInputSchema, type CreatorMaintenancePayload } from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext, QueueSqlExecutor } from '@pixishelf/job-runtime'
import {
  Prisma,
  creatorFingerprint,
  editArtworkCreators,
  lockCreatorCatalog,
  readSourceCreatorTags,
  remapCreatorTag,
  syncSourceCreators,
  visibleCreatorArtwork
} from '@pixishelf/db'

type Transaction = Prisma.TransactionClient & QueueSqlExecutor
const BATCH_SIZE = 25

export async function captureCreatorArtwork(tx: Prisma.TransactionClient, id: number) {
  const artwork = await tx.artwork.findUnique({
    where: { id },
    include: {
      creators: { orderBy: { id: 'asc' }, include: { artist: true, evidence: { orderBy: { id: 'asc' } } } },
      externalRefs: {
        where: { providerKey: 'e-hentai' },
        orderBy: { id: 'asc' },
        include: { snapshots: { orderBy: [{ fetchedAt: 'desc' }, { id: 'desc' }], take: 1 } }
      }
    }
  })
  if (!artwork || artwork.deletedAt || artwork.archiveLifecycleState !== 'ACTIVE') return null
  const refs = []
  for (const ref of artwork.externalRefs) {
    const snapshot = ref.snapshots[0]
    let tags = snapshot ? readSourceCreatorTags(snapshot.normalizedMetadata, snapshot.rawMetadata) : null
    const complete = tags !== null
    if (!complete) {
      const evidence = await tx.artworkTag.findMany({
        where: {
          artworkId: id,
          sourceRefId: ref.id,
          provenance: 'SOURCE',
          tag: { namespace: { in: ['artist', 'group'] } }
        },
        include: { tag: true },
        orderBy: { tagId: 'asc' }
      })
      tags = evidence.length
        ? evidence.map(({ tag }) => ({
            namespace: tag.namespace as 'artist' | 'group',
            name: tag.name.trim().toLocaleLowerCase('en-US')
          }))
        : null
    }
    const mappings = tags?.length
      ? await tx.artistSourceTagMapping.findMany({
          where: {
            providerKey: 'e-hentai',
            OR: tags.map((tag) => ({ namespace: tag.namespace, sourceName: tag.name }))
          },
          orderBy: [{ namespace: 'asc' }, { sourceName: 'asc' }]
        })
      : []
    refs.push({
      id: ref.id,
      tags,
      complete,
      hash: snapshot?.metadataHash ?? null,
      // A newly auto-created version-1 mapping has the same meaning as an absent mapping.
      remapped: mappings
        .filter((m) => m.version > 1)
        .map((m) => ({ id: m.id, version: m.version, artistId: m.artistId }))
    })
  }
  const state = {
    id,
    refs,
    evidence: artwork.creators.map((m) => ({
      artistId: m.artistId,
      evidence: m.evidence.map((e) => ({
        id: e.id,
        present: e.present,
        excludedAt: e.excludedAt,
        provenance: e.provenance
      }))
    }))
  }
  return {
    ...state,
    title: artwork.title,
    creatorNames: artwork.creators
      .filter((m) => m.evidence.some((e) => e.present && !e.excludedAt))
      .map((m) => m.artist.name),
    fingerprint: creatorFingerprint(state)
  }
}

async function captureMapping(tx: Prisma.TransactionClient, id: string) {
  const mapping = await tx.artistSourceTagMapping.findUniqueOrThrow({ where: { id } })
  const evidence = await tx.artworkArtistEvidence.findMany({
    where: { tagMappingId: id },
    orderBy: { id: 'asc' },
    select: { id: true, membershipId: true, present: true, excludedAt: true }
  })
  return { mapping, count: evidence.length, fingerprint: creatorFingerprint({ mapping, evidence }) }
}

export async function executeCreatorMaintenance(
  context: ExecutionContext<CreatorMaintenancePayload, EnqueuedChildJob>
) {
  return context.finalizeInTransaction<Transaction>(async (scope) => {
    if (scope.executionStatus === 'CANCELLING') {
      await scope.cancel('已取消，已提交的整理结果保留')
      return
    }
    if (scope.executionStatus === 'PAUSING') {
      await scope.pause({ reason: 'USER_REQUESTED', message: '创作者整理已暂停' })
      return
    }
    if (context.signal.aborted) {
      await scope.release('等待 Worker 恢复')
      return
    }
    const tx = scope.transaction
    await lockCreatorCatalog(tx)
    const plan = await tx.creatorMaintenancePlan.findUniqueOrThrow({ where: { id: context.payload.planId } })
    const input = creatorMaintenanceInputSchema.parse(plan.input)
    if (context.payload.phase === 'PREVIEW') {
      if (plan.status !== 'PREPARING') {
        await scope.complete({ result: { planId: plan.id }, message: '预览已生成' })
        return
      }
      if (input.command === 'REMAP') {
        const current = await captureMapping(tx, input.mappingId)
        const target = await tx.artist.findUniqueOrThrow({ where: { id: input.artistId } })
        if (current.mapping.version !== input.expectedVersion) throw new Error('映射版本已变化，请重新预览')
        if (target.kind !== (current.mapping.namespace === 'group' ? 'GROUP' : 'PERSON'))
          throw new Error('目标类型不匹配')
        await tx.creatorMaintenanceItem.create({
          data: {
            planId: plan.id,
            artworkId: 0,
            fingerprint: current.fingerprint,
            payload: {
              ...input,
              previousArtistId: current.mapping.artistId,
              affected: current.count,
              sourceName: current.mapping.sourceName,
              targetName: target.name
            }
          }
        })
      } else {
        const previous = await tx.creatorMaintenanceItem.aggregate({
          where: { planId: plan.id },
          _max: { artworkId: true }
        })
        const ids = await tx.artwork.findMany({
          where: {
            ...visibleCreatorArtwork,
            ...(input.command === 'BACKFILL' ? { createdVia: 'URL_ARCHIVE' as const } : {}),
            id: {
              gt: previous._max.artworkId ?? 0,
              lte: plan.maximumArtworkId,
              ...('artworkIds' in input && input.artworkIds ? { in: input.artworkIds } : {})
            }
          },
          orderBy: { id: 'asc' },
          take: BATCH_SIZE,
          select: { id: true }
        })
        const targets =
          'creatorIds' in input
            ? await tx.artist.findMany({ where: { id: { in: input.creatorIds } }, select: { name: true } })
            : []
        if ('creatorIds' in input && targets.length !== new Set(input.creatorIds).size)
          throw new Error('所选创作者已不存在')
        const series =
          input.command === 'SERIES'
            ? await tx.series.findUniqueOrThrow({ where: { id: input.seriesId }, select: { title: true } })
            : null
        for (const { id } of ids) {
          const snapshot = await captureCreatorArtwork(tx, id)
          if (!snapshot) continue
          const sourceTags = snapshot.refs.flatMap((ref) => ref.tags ?? []).map((tag) => tag.namespace + ':' + tag.name)
          const description =
            '当前：' +
            (snapshot.creatorNames.join('、') || '未关联') +
            '；' +
            (input.command === 'BACKFILL'
              ? snapshot.refs.some((ref) => ref.tags !== null)
                ? '同步来源标签：' + (sourceTags.join('、') || '已确认无作者／社团标签') + '；保留人工归属和排除'
                : '来源依据不足，跳过并待人工整理'
              : input.command === 'SERIES'
                ? '加入系列：' + series!.title
                : (input.command === 'ADD' ? '人工追加：' : '排除归属：') +
                  targets.map((target) => target.name).join('、'))
          await tx.creatorMaintenanceItem.create({
            data: {
              planId: plan.id,
              artworkId: id,
              fingerprint: snapshot.fingerprint,
              payload: JSON.parse(JSON.stringify({ ...snapshot, description })) as Prisma.InputJsonValue
            }
          })
        }
        if (ids.length === BATCH_SIZE) {
          await scope.retry({
            availableAt: new Date(Date.now() + 1000),
            errorCode: 'RESOURCE_BUSY',
            error: 'Preview batch yielded',
            message: '正在冻结逐件作品的来源与归属依据',
            preserveAttempt: true
          })
          return
        }
      }
      const count = await tx.creatorMaintenanceItem.count({ where: { planId: plan.id } })
      await tx.creatorMaintenancePlan.update({
        where: { id: plan.id },
        data: { status: 'READY', fingerprint: creatorFingerprint({ id: plan.id, count, input }) }
      })
      await scope.complete({ result: { planId: plan.id, count }, message: '预览已就绪，请检查后确认执行' })
      return
    }
    if (!['APPLYING', 'COMPLETE'].includes(plan.status)) throw new Error('该预览尚未确认执行')
    const items = await tx.creatorMaintenanceItem.findMany({
      where: { planId: plan.id, status: 'PENDING' },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE
    })
    for (const item of items) {
      let status = 'SUCCESS'
      let result: Prisma.InputJsonValue = {}
      if (input.command === 'REMAP') {
        const current = await captureMapping(tx, input.mappingId)
        if (current.fingerprint !== item.fingerprint) {
          status = 'STALE'
          result = { reason: '映射或关联已变化，请重新预览' }
        } else result = await remapCreatorTag(tx, input.mappingId, input.artistId, input.expectedVersion)
      } else {
        const current = await captureCreatorArtwork(tx, item.artworkId)
        if (!current || current.fingerprint !== item.fingerprint) {
          status = 'STALE'
          result = { reason: '作品、来源依据或人工整理已变化' }
        } else if (input.command === 'BACKFILL') {
          let known = false
          for (const ref of current.refs) {
            const synced = await syncSourceCreators(tx, item.artworkId, ref.id, 'e-hentai', ref.tags, ref.complete)
            known ||= synced.known
          }
          if (!known) {
            status = 'UNKNOWN'
            result = { reason: '缺少可验证作者标签，请人工整理' }
          }
        } else if (input.command === 'SERIES') {
          await tx.$queryRawUnsafe('SELECT id FROM "Series" WHERE id=$1 FOR UPDATE', input.seriesId)
          await tx.series.findUniqueOrThrow({ where: { id: input.seriesId } })
          const last = await tx.seriesArtwork.aggregate({
            where: { seriesId: input.seriesId },
            _max: { sortOrder: true }
          })
          await tx.seriesArtwork.upsert({
            where: { seriesId_artworkId: { seriesId: input.seriesId, artworkId: item.artworkId } },
            create: {
              seriesId: input.seriesId,
              artworkId: item.artworkId,
              sortOrder: (last._max.sortOrder ?? 0) + 1,
              provenance: 'MANUAL'
            },
            update: { excludedAt: null }
          })
        } else await editArtworkCreators(tx, item.artworkId, input.creatorIds, input.command)
      }
      await tx.creatorMaintenanceItem.update({ where: { id: item.id }, data: { status, result } })
    }
    const remaining = await tx.creatorMaintenanceItem.count({ where: { planId: plan.id, status: 'PENDING' } })
    if (!remaining) {
      await tx.creatorMaintenancePlan.update({ where: { id: plan.id }, data: { status: 'COMPLETE' } })
      const counts = await tx.creatorMaintenanceItem.groupBy({
        by: ['status'],
        where: { planId: plan.id },
        _count: true
      })
      await scope.complete({
        result: { planId: plan.id, counts },
        message: '整理完成，可查看逐项结果及需重新预览的作品'
      })
    } else
      await scope.retry({
        availableAt: new Date(Date.now() + 1000),
        errorCode: 'RESOURCE_BUSY',
        error: 'Curation batch yielded',
        message: '已提交一批创作者关系整理，剩余 ' + remaining + ' 件',
        preserveAttempt: true
      })
  })
}
