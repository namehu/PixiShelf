import { Prisma, type PrismaClient } from '@pixishelf/db'
import { ARTWORK_SUMMARY_ALGORITHM_VERSION, artworkSummaryPayloadSchema, groupLogicalMedia,
  groupSummaryMedia, summaryFeatureSchema, type ArtworkSummaryPayload } from '@pixishelf/job-contracts'
import type { ExecutionContext, EnqueuedChildJob, ExecutorDefinition, FencedExecutionTransaction, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { IsolatedSummaryProbe, type SummaryProbe, type SummaryProbeResult } from './probe.ts'

type Tx = Prisma.TransactionClient & QueueSqlExecutor
const sharedProbe = new IsolatedSummaryProbe()

export function createArtworkSummaryExecutor(dependencies: { database: PrismaClient; scanRoot: string }): ExecutorDefinition {
  return { jobType: 'ARTWORK_SUMMARY_GENERATE', definitionVersion: 1, executionLane: 'BACKGROUND_WRITER',
    progressPolicy: 'STANDARD', parsePayload: (value) => artworkSummaryPayloadSchema.parse(value),
    execute: (context: ExecutionContext<ArtworkSummaryPayload, EnqueuedChildJob>) => executeArtworkSummary(context, dependencies)
  } as ExecutorDefinition
}

export async function executeArtworkSummary(context: ExecutionContext<ArtworkSummaryPayload, EnqueuedChildJob>,
  dependencies: { database: Pick<PrismaClient, 'artwork' | 'image' | 'artworkSummary' | 'artworkSummaryFeature'>; scanRoot: string; probe?: SummaryProbe; now?: () => number }) {
  const { artworkId, generationId, sourceRevision } = context.payload
  const database = dependencies.database
  const summary = await database.artworkSummary.findUnique({ where: { artworkId } })
  const artwork = await database.artwork.findUnique({ where: { id: artworkId }, select: { deletedAt: true, archiveLifecycleState: true } })
  if (!artwork || artwork.deletedAt || artwork.archiveLifecycleState !== 'ACTIVE' || !summary ||
    summary.generationId !== generationId || summary.sourceRevision !== sourceRevision) {
    return { kind: 'completed' as const, result: { stale: true }, message: '作品已变化，请重新生成摘要' }
  }
  const rows = await database.image.findMany({ where: { artworkId }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { summaryFeature: true } })
  const logical = groupLogicalMedia(rows)
  if (summary.replaceInProgress || rows.some((row) => row.summaryFeature?.writeInProgress)) {
    return context.finalizeInTransaction<Tx>(async (scope) => {
      await pauseForAction(scope, '原图正在写入，完成后请重新生成摘要')
    })
  }
  const probe = dependencies.probe ?? sharedProbe
  const now = dependencies.now ?? Date.now
  const started = now()
  let count = 0
  for (const { item, members } of logical) {
    if (item.summaryFeature?.generationId === generationId) continue
    if (context.signal.aborted || count >= 10 || (count > 0 && now() - started >= 5_000)) break
    const previous = item.summaryFeature
    const parsed = summaryFeatureSchema.safeParse(previous?.feature)
    let result: SummaryProbeResult = { sourceKey: null, feature: null, failureCode: 'NON_STATIC' }
    if (members.length === 1 && item.mediaType !== 'VIDEO' && item.mediaType !== 'ANIMATION' && item.webpAnimationStatus !== 2 &&
      !/\.(?:gif|apng|mp4|webm|mkv|mov|avi|m4v|wmv|flv)$/i.test(item.path)) {
      try {
        result = await probe.analyze(dependencies.scanRoot, item.path,
          !context.payload.force && previous?.algorithmVersion === ARTWORK_SUMMARY_ALGORITHM_VERSION && parsed.success
            ? { sourceKey: previous.sourceKey, feature: parsed.data, failureCode: null } : null, context.signal)
      } catch (error) {
        if (context.signal.aborted) break
        if (error instanceof Error && error.message === 'SUMMARY_CHILD_UNAVAILABLE') {
          return context.finalizeInTransaction<Tx>(async (scope) => {
            await pauseForAction(scope, '图片分析进程未退出，请检查存储后重试')
          })
        }
        result = { sourceKey: null, feature: null, failureCode: 'TIMEOUT' }
      }
    }
    await context.mutateInTransaction<Tx>(async (tx) => {
      const current = await lockSummary(tx, artworkId)
      if (!current || current.generationId !== generationId || current.sourceRevision !== sourceRevision || current.replaceInProgress) throw new Error('SUMMARY_SOURCE_CHANGED')
      const image = await tx.image.findUnique({ where: { id: item.id }, include: { summaryFeature: true } })
      if (!image || image.path !== item.path || image.artworkId !== artworkId || image.summaryFeature?.writeInProgress ||
        (image.summaryFeature?.sourceRevision ?? 0) !== (previous?.sourceRevision ?? 0)) throw new Error('SUMMARY_SOURCE_CHANGED')
      await tx.artworkSummaryFeature.upsert({ where: { imageId: item.id },
        create: { imageId: item.id, generationId, sourceKey: result.sourceKey, feature: result.feature ?? Prisma.DbNull,
          algorithmVersion: ARTWORK_SUMMARY_ALGORITHM_VERSION, failureCode: result.failureCode },
        update: { generationId, sourceKey: result.sourceKey, feature: result.feature ?? Prisma.DbNull,
          algorithmVersion: ARTWORK_SUMMARY_ALGORITHM_VERSION, failureCode: result.failureCode } })
    })
    count++
  }
  return context.finalizeInTransaction<Tx>(async (scope) => {
    if (scope.executionStatus === 'CANCELLING') { await scope.cancel('摘要生成已取消'); return }
    if (scope.executionStatus === 'PAUSING') { await scope.pause({ reason: 'USER_REQUESTED', message: '摘要生成已暂停' }); return }
    if (context.signal.aborted) { await scope.release('摘要生成等待恢复'); return }
    const current = await lockSummary(scope.transaction, artworkId)
    if (!current || current.generationId !== generationId || current.sourceRevision !== sourceRevision || current.replaceInProgress) {
      await scope.complete({ result: { stale: true }, message: '作品已变化，请重新生成摘要' }); return
    }
    const features = await scope.transaction.artworkSummaryFeature.findMany({ where: { imageId: { in: logical.map(({ item }) => item.id) }, generationId } })
    if (features.some((feature) => feature.writeInProgress)) throw new Error('SUMMARY_SOURCE_CHANGED')
    const processed = features.length
    const message = `正在整理摘要 · ${processed} / ${logical.length}`
    if (processed < logical.length) {
      await scope.transaction.systemJob.update({ where: { id: context.job.id }, data: {
        progress: Math.floor(processed / Math.max(1, logical.length) * 99), stage: 'YIELDING', message,
        result: { processed, total: logical.length }
      } })
      await scope.retry({ availableAt: new Date(now() + 5_000), errorCode: 'RESOURCE_BUSY', error: 'Summary batch yielded',
        message, preserveAttempt: true, schedulingYield: true }); return
    }
    const byId = new Map(features.map((row) => [row.imageId, summaryFeatureSchema.safeParse(row.feature)]))
    const groups = groupSummaryMedia(logical.map(({ item }) => {
      const feature = byId.get(item.id)
      return { mediaId: item.id, feature: feature?.success ? feature.data : null }
    }))
    await scope.transaction.artworkSummary.update({ where: { artworkId }, data: {
      publishedRevision: sourceRevision, algorithmVersion: ARTWORK_SUMMARY_ALGORITHM_VERSION, groups
    } })
    await scope.complete({ result: { processed, total: logical.length, groups: groups.length,
      standalone: features.filter((row) => row.failureCode && row.failureCode !== 'NON_STATIC').length }, message: '摘要已就绪' })
  })
}

async function lockSummary(tx: Tx, artworkId: number) {
  await tx.$queryRaw(Prisma.sql`SELECT id FROM "Artwork" WHERE id = ${artworkId} FOR UPDATE`)
  await tx.$queryRaw(Prisma.sql`SELECT "artworkId" FROM "ArtworkSummary" WHERE "artworkId" = ${artworkId} FOR UPDATE`)
  return tx.artworkSummary.findUnique({ where: { artworkId } })
}

async function pauseForAction(scope: FencedExecutionTransaction<Tx>, message: string) {
  if (scope.executionStatus === 'CANCELLING') { await scope.cancel('摘要生成已取消'); return }
  if (scope.executionStatus === 'PAUSING') { await scope.pause({ reason: 'USER_REQUESTED', message: '摘要生成已暂停' }); return }
  await scope.pause({ reason: 'ACTION_REQUIRED', message })
}
