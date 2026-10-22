import { Prisma } from '@pixishelf/db'
import {
  ARCHIVE_RULE_PREVIEW_JOB_TYPE,
  ARCHIVE_RULE_PREVIEW_DEFINITION_VERSION,
  archiveTitleRulePreviewPayloadSchema,
  archiveTitleRulesSchema,
  archiveTitleQuerySchema,
  archiveTitleEvidenceFromCatalog,
  evaluateArchiveTitleRules,
  archiveTitleAccepted,
  archiveTitleUploaderMatches
} from '@pixishelf/job-contracts'
import type { ExecutionContext, ExecutorDefinition, QueueSqlExecutor, EnqueuedChildJob } from '@pixishelf/job-runtime'
import { lockDiscoverySource } from './discovery-scan-enqueue.ts'

type Payload = { revisionId: string }

export function createArchiveTitleRulePreviewRegistration(
  definitionVersion: 1 | 2 = ARCHIVE_RULE_PREVIEW_DEFINITION_VERSION
): ExecutorDefinition<Payload> {
  return {
    jobType: ARCHIVE_RULE_PREVIEW_JOB_TYPE,
    executionLane: 'ARCHIVE_RESOLVE',
    definitionVersion,
    progressPolicy: 'STANDARD',
    parsePayload: (value) => archiveTitleRulePreviewPayloadSchema.parse(value),
    execute: (context) => executeArchiveTitleRulePreview(context)
  }
}

/** One bounded batch and its checkpoint commit under the worker fence. No remote requests or creator writes. */
export async function executeArchiveTitleRulePreview(
  context: ExecutionContext<Payload, EnqueuedChildJob>,
  now = () => new Date()
) {
  return context.finalizeInTransaction<Prisma.TransactionClient & QueueSqlExecutor>(async (scope) => {
    const tx = scope.transaction
    const initial = await tx.archiveTitleRuleRevision.findUnique({ where: { id: context.payload.revisionId } })
    if (!initial || initial.systemJobId !== context.job.id) {
      await scope.skip({ reason: 'PRECONDITION_NOT_MET', message: '规则预览已不存在' })
      return
    }
    await lockDiscoverySource(tx, initial.sourceId)
    const revision = await tx.archiveTitleRuleRevision.findUnique({
      where: { id: initial.id },
      include: { source: true }
    })
    if (!revision) {
      await scope.skip({ reason: 'PRECONDITION_NOT_MET', message: '来源或规则预览已删除' })
      return
    }
    if (scope.controlStatus === 'CANCEL_REQUESTED') {
      await tx.archiveTitleRuleRevision.update({ where: { id: revision.id }, data: { status: 'CANCELLED' } })
      await scope.cancel('规则预览已取消，当前规则未改变')
      return
    }
    if (scope.controlStatus === 'PAUSE_REQUESTED') {
      await scope.pause({ reason: 'USER_REQUESTED', message: '规则预览已暂停' })
      return
    }
    if (context.signal.aborted) {
      await scope.release('规则预览等待 Worker 恢复')
      return
    }
    if (revision.status !== 'PENDING') {
      await scope.complete({ result: { revisionId: revision.id }, message: '规则预览已完成' })
      return
    }
    if (
      revision.baseCatalogVersion !== revision.source.catalogVersion ||
      revision.baseRulesVersion !== revision.source.rulesVersion
    ) {
      await tx.archiveTitleRuleRevision.update({ where: { id: revision.id }, data: { status: 'STALE' } })
      await scope.complete({
        result: { revisionId: revision.id, stale: true },
        message: '候选或规则已变化，请重新预览'
      })
      return
    }
    const rules = archiveTitleRulesSchema.parse(revision.rules)
    const query = archiveTitleQuerySchema.parse(revision.source.titleQuery)
    const rows = await tx.archiveUploaderCatalogItem.findMany({
      where: { sourceId: revision.sourceId, ...(revision.cursor ? { id: { gt: revision.cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: 250
    })
    const evaluations = rows.map((row) => {
      const evaluation = evaluateArchiveTitleRules(
        rules,
        archiveTitleEvidenceFromCatalog(row),
        archiveTitleUploaderMatches(query, row.uploaderName)
      )
      return {
        revisionId: revision.id,
        catalogItemId: row.id,
        evaluation: JSON.parse(JSON.stringify(evaluation)) as Prisma.InputJsonValue,
        accepted: archiveTitleAccepted(evaluation, row.reviewDecision),
        previouslyAccepted: row.matchesQuery,
        reviewDecision: row.reviewDecision
      }
    })
    if (evaluations.length) await tx.archiveTitleRuleEvaluation.createMany({ data: evaluations })
    const done = rows.length < 250
    const updated = await tx.archiveTitleRuleRevision.update({
      where: { id: revision.id },
      data: {
        cursor: rows.at(-1)?.id ?? revision.cursor,
        checkedCount: { increment: rows.length },
        acceptedCount: { increment: evaluations.filter((row) => row.accepted).length },
        filteredCount: { increment: evaluations.filter((row) => !row.accepted).length },
        newlyAcceptedCount: { increment: evaluations.filter((row) => row.accepted && !row.previouslyAccepted).length },
        newlyFilteredCount: { increment: evaluations.filter((row) => !row.accepted && row.previouslyAccepted).length },
        manualCount: { increment: evaluations.filter((row) => row.reviewDecision !== 'AUTO').length },
        status: done ? 'READY' : 'PENDING'
      }
    })
    if (done)
      await scope.complete({
        result: { revisionId: revision.id },
        message: `已预览 ${updated.checkedCount} 条候选，请检查后应用`
      })
    else
      await scope.retry({
        availableAt: new Date(now().getTime() + 50),
        preserveAttempt: true,
        schedulingYield: true,
        errorCode: 'RESOURCE_BUSY',
        error: 'Title rule preview yielded at a durable batch boundary',
        message: `已预览 ${updated.checkedCount} 条候选`
      })
  })
}
