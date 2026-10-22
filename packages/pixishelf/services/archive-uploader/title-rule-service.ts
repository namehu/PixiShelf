import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Prisma, type PrismaClient, cancelDiscoveryCreator, lockDiscoveryCreators } from '@pixishelf/db'
import {
  ARCHIVE_RULE_PREVIEW_JOB_TYPE,
  ARCHIVE_RULE_PREVIEW_DEFINITION_VERSION,
  archiveTitleRulesSchema,
  archiveTitleQuerySchema,
  archiveTitleReviewDecisionSchema,
  archiveTitleQueryIdentity,
  canonicalArchiveTitleRules,
  evaluateArchiveTitleRules,
  archiveTitleEvidenceFromCatalog,
  archiveTitleUploaderMatches,
  archiveTitleAccepted,
  legacyArchiveTitleRules,
  archiveTitleEvaluationSchema
} from '@pixishelf/job-contracts'
import { lockDiscoverySource } from '@pixishelf/job-executors'
import { prisma } from '@/lib/prisma'
import { ArchiveError } from '@/services/archive/errors'
import { runArchiveBulkOperation } from '@/services/archive/archive-bulk-operation'
import { cancelJobCommand } from '@/services/background-task/job-command-service'

const database = () => prisma as unknown as PrismaClient
const id = z.string().min(1).max(128)
const ids = z
  .array(id)
  .min(1)
  .max(100)
  .transform((values) => [...new Set(values)])
export const titleRuleSourceSchema = z.object({ sourceId: id }).strict()
export const previewTitleRulesSchema = titleRuleSourceSchema
  .extend({
    rules: archiveTitleRulesSchema,
    rulesVersion: z.number().int().positive(),
    requestId: z.string().uuid()
  })
  .strict()
export const titleRuleRevisionSchema = titleRuleSourceSchema.extend({ revisionId: id }).strict()
export const titleRulePreviewItemsSchema = titleRuleRevisionSchema
  .extend({
    cursor: id.nullish(),
    direction: z.enum(['forward', 'backward']).optional(),
    limit: z.number().int().min(1).max(100).default(50),
    view: z.enum(['ALL', 'ACCEPTED', 'FILTERED', 'NEWLY_ACCEPTED', 'NEWLY_FILTERED']).default('ALL')
  })
  .strict()
export const reviewTitleItemsSchema = titleRuleSourceSchema
  .extend({
    itemIds: ids,
    decision: archiveTitleReviewDecisionSchema,
    requestId: z.string().uuid(),
    rulesVersion: z.number().int().positive()
  })
  .strict()
export const titleCreatorCleanupPreviewSchema = titleRuleSourceSchema
  .extend({
    cursor: id.nullish(),
    direction: z.enum(['forward', 'backward']).optional(),
    limit: z.number().int().min(1).max(100).default(50)
  })
  .strict()
export const cleanupTitleCreatorsSchema = titleRuleSourceSchema
  .extend({ pendingIds: ids, rulesVersion: z.number().int().positive(), requestId: z.string().uuid() })
  .strict()

async function titleSource(tx: Prisma.TransactionClient, sourceId: string) {
  const source = await tx.archiveUploaderSource.findUnique({ where: { id: sourceId, sourceKind: 'TITLE_QUERY' } })
  if (!source) throw new ArchiveError('STATE_CONFLICT', '标题来源不存在')
  return source
}

export async function previewTitleRules(
  input: z.input<typeof previewTitleRulesSchema>,
  userId: string,
  db = database()
) {
  const parsed = previewTitleRulesSchema.parse(input)
  return db.$transaction(async (tx) => {
    await lockDiscoverySource(tx, parsed.sourceId)
    const source = await titleSource(tx, parsed.sourceId)
    const rules = canonicalArchiveTitleRules(parsed.rules)
    const existing = await tx.archiveTitleRuleRevision.findUnique({ where: { requestId: parsed.requestId } })
    if (existing) {
      if (
        existing.sourceId !== source.id ||
        existing.requestedByUserId !== userId ||
        JSON.stringify(canonicalArchiveTitleRules(archiveTitleRulesSchema.parse(existing.rules))) !==
          JSON.stringify(rules)
      ) {
        throw new ArchiveError('STATE_CONFLICT', '请求编号已用于其他规则预览')
      }
      return { revisionId: existing.id }
    }
    if (source.rulesVersion !== parsed.rulesVersion) {
      throw new ArchiveError('STATE_CONFLICT', '规则已变化，请刷新后重新预览')
    }
    const revisionId = randomUUID()
    const jobId = randomUUID()
    await tx.systemJob.create({
      data: {
        id: jobId,
        type: ARCHIVE_RULE_PREVIEW_JOB_TYPE,
        executionLane: 'ARCHIVE_RESOLVE',
        definitionVersion: ARCHIVE_RULE_PREVIEW_DEFINITION_VERSION,
        status: 'PENDING',
        triggerSource: 'MANUAL',
        requestedByUserId: userId,
        idempotencyKey: `title-rule-preview:${parsed.requestId}`,
        payload: { revisionId },
        queuePriority: 20,
        effectivePriority: 20,
        maxAttempts: 3,
        message: '等待预览全部标题候选'
      }
    })
    await tx.archiveTitleRuleRevision.create({
      data: {
        id: revisionId,
        sourceId: source.id,
        systemJobId: jobId,
        requestedByUserId: userId,
        requestId: parsed.requestId,
        rules,
        baseRulesVersion: source.rulesVersion,
        baseCatalogVersion: source.catalogVersion
      }
    })
    await tx.systemJobEvent.create({ data: { jobId, type: 'job.queued', message: '标题规则预览已创建' } })
    return { revisionId }
  })
}

export async function getTitleRulePreview(input: z.input<typeof titleRuleRevisionSchema>, db = database()) {
  const parsed = titleRuleRevisionSchema.parse(input)
  const row = await db.archiveTitleRuleRevision.findFirst({
    where: { id: parsed.revisionId, sourceId: parsed.sourceId },
    include: {
      source: { select: { catalogVersion: true, rulesVersion: true } },
      systemJob: { select: { status: true, message: true } }
    }
  })
  if (!row) throw new ArchiveError('STATE_CONFLICT', '规则预览不存在')
  const { baseCatalogVersion, source, systemJob, ...wire } = row
  const stale =
    row.status !== 'APPLIED' &&
    (baseCatalogVersion !== source.catalogVersion || row.baseRulesVersion !== source.rulesVersion)
  const cancelled =
    row.status === 'CANCELLED' || (row.status === 'PENDING' && (!systemJob || systemJob.status === 'CANCELLED'))
  return {
    ...wire,
    rules: archiveTitleRulesSchema.parse(row.rules),
    stale,
    jobStatus: systemJob?.status ?? null,
    status: cancelled ? ('CANCELLED' as const) : stale ? ('STALE' as const) : row.status
  }
}

export async function listTitleRulePreviewItems(input: z.input<typeof titleRulePreviewItemsSchema>, db = database()) {
  const parsed = titleRulePreviewItemsSchema.parse(input)
  await getTitleRulePreview({ sourceId: parsed.sourceId, revisionId: parsed.revisionId }, db)
  const where: Prisma.ArchiveTitleRuleEvaluationWhereInput = {
    revisionId: parsed.revisionId,
    ...(parsed.cursor ? { catalogItemId: { gt: parsed.cursor } } : {}),
    ...(parsed.view === 'ACCEPTED'
      ? { accepted: true }
      : parsed.view === 'FILTERED'
        ? { accepted: false }
        : parsed.view === 'NEWLY_ACCEPTED'
          ? { accepted: true, previouslyAccepted: false }
          : parsed.view === 'NEWLY_FILTERED'
            ? { accepted: false, previouslyAccepted: true }
            : {})
  }
  const rows = await db.archiveTitleRuleEvaluation.findMany({
    where,
    orderBy: { catalogItemId: 'asc' },
    take: parsed.limit + 1,
    include: { catalogItem: { select: { id: true, title: true, externalId: true } } }
  })
  const items = rows.slice(0, parsed.limit)
  return {
    items: items.map((row) => ({ ...row, evaluation: archiveTitleEvaluationSchema.parse(row.evaluation) })),
    nextCursor: rows.length > parsed.limit ? items.at(-1)!.catalogItemId : null
  }
}

export async function applyTitleRules(input: z.input<typeof titleRuleRevisionSchema>, db = database()) {
  const parsed = titleRuleRevisionSchema.parse(input)
  try {
    return await db.$transaction(
      async (tx) => {
        await lockDiscoverySource(tx, parsed.sourceId)
        // Catalog invalidation triggers lock this row before committing a concurrent mutation.
        await tx.$queryRaw(Prisma.sql`SELECT id FROM archive_uploader_sources WHERE id = ${parsed.sourceId} FOR UPDATE`)
        const source = await titleSource(tx, parsed.sourceId)
        const revision = await tx.archiveTitleRuleRevision.findFirst({
          where: { id: parsed.revisionId, sourceId: source.id }
        })
        if (!revision) throw new ArchiveError('STATE_CONFLICT', '规则预览不存在')
        if (revision.status === 'APPLIED') return { applied: true, rulesVersion: source.rulesVersion }
        if (
          revision.status !== 'READY' ||
          revision.baseRulesVersion !== source.rulesVersion ||
          revision.baseCatalogVersion !== source.catalogVersion
        ) {
          throw new ArchiveError('STATE_CONFLICT', '预览未完成或已经过期，请重新预览')
        }
        if (
          await tx.archiveUploaderScanRun.findFirst({
            where: {
              sourceId: source.id,
              OR: [
                { status: { in: ['PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSED'] } },
                { systemJob: { status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'] } } }
              ]
            }
          })
        ) {
          throw new ArchiveError('STATE_CONFLICT', '请等待当前扫描完成，或取消扫描后再应用规则')
        }
        const rules = archiveTitleRulesSchema.parse(revision.rules)
        const queryKey = createHash('sha256')
          .update(archiveTitleQueryIdentity(archiveTitleQuerySchema.parse(source.titleQuery), rules))
          .digest('hex')
        const duplicate = await tx.archiveUploaderSource.findUnique({ where: { queryKey } })
        if (duplicate && duplicate.id !== source.id) {
          throw new ArchiveError(
            'STATE_CONFLICT',
            `相同条件已存在于来源“${duplicate.displayName}”，请使用该来源或调整规则`
          )
        }
        const count = await tx.archiveUploaderCatalogItem.count({ where: { sourceId: source.id } })
        if (
          count !== revision.checkedCount ||
          count !== (await tx.archiveTitleRuleEvaluation.count({ where: { revisionId: revision.id } }))
        ) {
          throw new ArchiveError('STATE_CONFLICT', '预览数据不完整，请重新预览')
        }
        await tx.$executeRaw(Prisma.sql`
        UPDATE archive_uploader_catalog_items c SET
          "matchesQuery" = e.accepted,
          "ruleMatches" = (e.evaluation->>'matched')::boolean,
          "uploaderMatches" = (e.evaluation->>'uploaderMatches')::boolean,
          "matchEvaluation" = e.evaluation,
          "firstMatchedAt" = CASE WHEN e.accepted THEN COALESCE(c."firstMatchedAt", CURRENT_TIMESTAMP) ELSE c."firstMatchedAt" END,
          "updatedAt" = CURRENT_TIMESTAMP
        FROM archive_title_rule_evaluations e
        WHERE e."revisionId" = ${revision.id} AND c.id = e."catalogItemId" AND c."sourceId" = ${source.id}
      `)
        await tx.archiveUploaderSource.update({
          where: { id: source.id },
          data: { titleRules: rules, queryKey, rulesVersion: { increment: 1 } }
        })
        await tx.archiveTitleRuleRevision.update({
          where: { id: revision.id },
          data: { status: 'APPLIED', appliedAt: new Date() }
        })
        return { applied: true, rulesVersion: source.rulesVersion + 1 }
      },
      { timeout: 30_000 }
    )
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new ArchiveError('STATE_CONFLICT', '相同条件已存在，请刷新后检查其他来源')
    }
    throw error
  }
}

export async function cancelTitleRulePreview(input: z.input<typeof titleRuleRevisionSchema>, db = database()) {
  const parsed = titleRuleRevisionSchema.parse(input)
  const revision = await getTitleRulePreview(parsed, db)
  if (
    revision.systemJobId &&
    revision.jobStatus &&
    ['PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSED', 'PAUSE_REQUESTED'].includes(revision.jobStatus)
  ) {
    await cancelJobCommand({ jobId: revision.systemJobId }, db)
  }
  return { cancelled: true }
}

export async function reviewTitleItems(input: z.input<typeof reviewTitleItemsSchema>, userId: string, db = database()) {
  const parsed = reviewTitleItemsSchema.parse(input)
  return runArchiveBulkOperation(
    {
      idempotencyKey: parsed.requestId,
      requestedByUserId: userId,
      commandType: 'REVIEW_TITLE_MATCH',
      targetType: 'DISCOVERY_ITEM',
      targetIds: parsed.itemIds,
      requestOptions: { sourceId: parsed.sourceId, rulesVersion: parsed.rulesVersion, decision: parsed.decision }
    },
    async (tx, itemId) => {
      await lockDiscoverySource(tx, parsed.sourceId)
      const source = await titleSource(tx, parsed.sourceId)
      if (source.rulesVersion !== parsed.rulesVersion) {
        return { result: 'CONFLICT', message: '规则已变化，请刷新后重新复核' }
      }
      const item = await tx.archiveUploaderCatalogItem.findFirst({ where: { id: itemId, sourceId: source.id } })
      if (!item) return { result: 'CONFLICT', message: '候选已不存在' }
      const query = archiveTitleQuerySchema.parse(source.titleQuery)
      const rules = archiveTitleRulesSchema.parse(source.titleRules ?? legacyArchiveTitleRules(query))
      const evaluation = evaluateArchiveTitleRules(
        rules,
        archiveTitleEvidenceFromCatalog(item),
        archiveTitleUploaderMatches(query, item.uploaderName)
      )
      if (parsed.decision === 'INCLUDE' && !evaluation.uploaderMatches) {
        return { result: 'CONFLICT', message: '手动接纳不能绕过上传者限制' }
      }
      const accepted = archiveTitleAccepted(evaluation, parsed.decision)
      await tx.archiveUploaderCatalogItem.update({
        where: { id: item.id },
        data: {
          reviewDecision: parsed.decision,
          reviewedByUserId: userId,
          reviewedAt: new Date(),
          ruleMatches: evaluation.matched,
          uploaderMatches: evaluation.uploaderMatches,
          matchEvaluation: JSON.parse(JSON.stringify(evaluation)) as Prisma.InputJsonValue,
          matchesQuery: accepted,
          ...(accepted && !item.firstMatchedAt ? { firstMatchedAt: new Date() } : {})
        }
      })
      return { result: 'APPLIED' }
    },
    { database: db }
  )
}

export async function getTitleReviewCounts(input: z.input<typeof titleRuleSourceSchema>, db = database()) {
  const { sourceId } = titleRuleSourceSchema.parse(input)
  await titleSource(db, sourceId)
  const [counts] = await db.$queryRaw<
    Array<{ accepted: number; filtered: number; unreviewed: number; excluded: number }>
  >(Prisma.sql`
    SELECT count(*) FILTER (WHERE c."matchesQuery")::int AS accepted,
      count(*) FILTER (WHERE NOT c."matchesQuery")::int AS filtered,
      count(*) FILTER (WHERE NOT c."matchesQuery" AND c."reviewDecision" = 'AUTO')::int AS unreviewed,
      count(*) FILTER (WHERE NOT c."matchesQuery" AND c."reviewDecision" = 'EXCLUDE')::int AS excluded
    FROM archive_uploader_catalog_items c WHERE c."sourceId" = ${sourceId}
      AND NOT EXISTS (SELECT 1 FROM archive_uploader_ignored_items i WHERE i."providerKey"=c."providerKey" AND i."externalId"=c."externalId")
  `)
  return counts!
}

export async function latestTitleRulePreview(input: z.input<typeof titleRuleSourceSchema>, db = database()) {
  const { sourceId } = titleRuleSourceSchema.parse(input)
  await titleSource(db, sourceId)
  const row = await db.archiveTitleRuleRevision.findFirst({
    where: { sourceId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
  })
  return row ? getTitleRulePreview({ sourceId, revisionId: row.id }, db) : null
}

export async function previewTitleCreatorCleanup(
  input: z.input<typeof titleCreatorCleanupPreviewSchema>,
  db = database()
) {
  const parsed = titleCreatorCleanupPreviewSchema.parse(input)
  const source = await titleSource(db, parsed.sourceId)
  const rows = await db.$queryRaw<
    Array<{ id: string; title: string; externalId: string; artistId: number; artistName: string; otherSources: number }>
  >(Prisma.sql`
    SELECT p.id, c.title, p."externalId", p."artistId", a.name AS "artistName",
      (SELECT count(*)::int FROM archive_uploader_catalog_items other WHERE other."providerKey"=p."providerKey" AND other."externalId"=p."externalId" AND other."sourceId" <> ${source.id}) AS "otherSources"
    FROM discovery_pending_creators p
    JOIN archive_uploader_catalog_items c ON c."providerKey"=p."providerKey" AND c."externalId"=p."externalId"
    JOIN discovery_source_creators d ON d."sourceId"=c."sourceId" AND d."artistId"=p."artistId"
    JOIN "Artist" a ON a.id=p."artistId"
    WHERE c."sourceId"=${source.id} AND NOT c."matchesQuery"
      ${parsed.cursor ? Prisma.sql`AND p.id > ${parsed.cursor}` : Prisma.empty}
    ORDER BY p.id ASC LIMIT ${parsed.limit + 1}
  `)
  const items = rows.slice(0, parsed.limit)
  return { items, rulesVersion: source.rulesVersion, nextCursor: rows.length > parsed.limit ? items.at(-1)!.id : null }
}

export async function cleanupTitleCreators(
  input: z.input<typeof cleanupTitleCreatorsSchema>,
  userId: string,
  db = database()
) {
  const parsed = cleanupTitleCreatorsSchema.parse(input)
  return runArchiveBulkOperation(
    {
      idempotencyKey: parsed.requestId,
      requestedByUserId: userId,
      commandType: 'CANCEL_PENDING_CREATORS',
      targetType: 'PENDING_CREATOR_BINDING',
      targetIds: parsed.pendingIds,
      requestOptions: { sourceId: parsed.sourceId, rulesVersion: parsed.rulesVersion, filteredOnly: true }
    },
    async (tx, pendingId) => {
      await lockDiscoverySource(tx, parsed.sourceId)
      const source = await titleSource(tx, parsed.sourceId)
      if (source.rulesVersion !== parsed.rulesVersion) {
        return { result: 'CONFLICT', message: '规则已变化，请重新检查清理清单' }
      }
      const pending = await tx.discoveryPendingCreator.findUnique({ where: { id: pendingId } })
      if (!pending) return { result: 'SKIPPED', message: '绑定已生效或已取消' }
      await lockDiscoveryCreators(tx, pending)
      const fresh = await tx.discoveryPendingCreator.findUnique({ where: { id: pendingId } })
      if (!fresh) return { result: 'SKIPPED', message: '绑定已生效或已取消' }
      const candidate = await tx.archiveUploaderCatalogItem.findFirst({
        where: {
          sourceId: source.id,
          providerKey: fresh.providerKey,
          externalId: fresh.externalId,
          matchesQuery: false,
          source: { defaultCreators: { some: { artistId: fresh.artistId } } }
        }
      })
      if (!candidate) return { result: 'CONFLICT', message: '候选已接纳或固定艺术家配置已变化，请重新检查' }
      return { result: (await cancelDiscoveryCreator(tx, fresh.id)) ? 'APPLIED' : 'SKIPPED' }
    },
    { database: db }
  )
}
