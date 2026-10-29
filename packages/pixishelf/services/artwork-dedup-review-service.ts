import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import {
  Prisma,
  ArtworkDedupOperationError,
  isArtworkDedupPrepareRetryable,
  artworkDedupRequestDigest,
  freezeArtworkDedupOperation,
  prepareArtworkDedupQuickConfirmation,
  saveArtworkDedupReview,
  readArtworkDedupGroupChoices,
  lockArtworkDedupActor,
  lockArtworkDedupCommand,
  lockArtworkDedupOperation,
  authorizeArtworkDedupDirectDelete,
  retryArtworkDedupDirectDelete,
  requestArtworkDedupDirectDeleteStop,
  allowArtworkDedupDirectDeleteReimport,
  type ArtworkDedupGroupChoice
} from '@pixishelf/db'
import * as contract from '@pixishelf/job-contracts'
import { prisma } from '@/lib/prisma'
import { artworkDedupCoverUrls } from './artwork-dedup-cover'
import { assertArtworkDedupAccount } from './artwork-dedup-service'
import { writeJobEvent } from './background-task/job-event-service'
import { WORKER_HEARTBEAT_STALE_AFTER_MS } from './background-task/worker-heartbeat'
interface Database {
  $transaction<T>(body: (tx: Prisma.TransactionClient) => Promise<T>, options?: { timeout?: number }): Promise<T>
}
type Operation = Prisma.ArtworkDedupOperationGetPayload<Record<string, never>>
const databaseDefault = prisma as unknown as Database
function conflict(code = 'STALE'): never {
  throw new ArtworkDedupOperationError(code)
}
export async function mapArtworkDedupMaintenanceError<T>(body: () => Promise<T>): Promise<T> {
  try {
    return await body()
  } catch (error) {
    if (error instanceof ArtworkDedupOperationError) {
      throw new TRPCError({
        code: error.code === 'NOT_FOUND' ? 'NOT_FOUND' : error.code === 'ACCOUNT_CHANGED' ? 'FORBIDDEN' : 'CONFLICT',
        message:
          error.code === 'NOT_FOUND'
            ? '未找到审核记录'
            : error.code === 'CONFLICTING_SELECTION'
              ? '所选结果存在冲突：同一作品不能既保留又删除，也不能重复删除。请减少选择后重试'
              : error.code === 'CONTAINMENT_DIRECTION_REQUIRED'
                ? '完整包含只能保留包含全部原文件的作品'
                : error.code === 'VISUAL_SINGLE_PAIR_REQUIRED'
                  ? '部分重复和疑似版本每次只能处理一对，请在对照面板中单独核对'
                  : error.code === 'EXPLICIT_CHOICE_REQUIRED'
                    ? '所选结果需要先明确选择保留作品'
                    : '审核状态已变化，请刷新后重试'
      })
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new TRPCError({ code: 'CONFLICT', message: '请求已提交或范围正被其他维护操作占用' })
    }
    throw error
  }
}
export function assertArtworkDedupMode(
  mode: contract.ArtworkDedupMaintenanceMode,
  purpose: 'ISOLATION' | 'PURGE' | 'DIRECT_DELETE' = 'ISOLATION'
) {
  if (!contract.isArtworkDedupMaintenanceModeEnabled(mode, purpose)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: '此维护阶段尚未开放' })
  }
}
const cursorSchema = z
  .object({ v: z.literal(1), scope: z.string(), last: z.union([z.string(), z.number().int().nonnegative()]) })
  .strict()
export function artworkDedupCursor(scope: unknown, last: string | number) {
  return Buffer.from(JSON.stringify({ v: 1, scope: JSON.stringify(scope), last })).toString('base64url')
}
export function readArtworkDedupCursor(value: string | undefined, scope: unknown): string | number | null {
  if (!value) return null
  try {
    if (value.length > 2000 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error()
    const parsed = cursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
    if (parsed.scope !== JSON.stringify(scope)) throw new Error()
    return parsed.last
  } catch {
    throw new TRPCError({ code: 'BAD_REQUEST', message: '分页范围已变化，请重新打开第一页' })
  }
}
export async function artworkDedupMembers(
  tx: Prisma.TransactionClient,
  userId: string,
  ids: number[]
): Promise<contract.ArtworkDedupMemberDto[]> {
  if (!ids.length) return []
  const rows = await tx.artwork.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      title: true,
      source: true,
      createdAt: true,
      likes: { where: { userId }, select: { level: true } },
      readingSummaries: {
        where: { userId },
        select: { lastViewedAt: true, seenCount: true, totalCount: true, stateVersion: true }
      }
    }
  })
  const counts = await tx.$queryRaw<
    {
      artworkId: number
      bookmarksAvailable: number
      bookmarksUnavailable: number
      likesAvailable: number
      likesUnavailable: number
      other: boolean
    }[]
  >(Prisma.sql`SELECT a.id "artworkId",
    (SELECT count(*)::int FROM "MediaMark" m WHERE m."artworkId"=a.id AND m."userId"=${userId} AND m."bookmarkedAt" IS NOT NULL AND m."mediaId" IS NOT NULL) "bookmarksAvailable",
    (SELECT count(*)::int FROM "MediaMark" m WHERE m."artworkId"=a.id AND m."userId"=${userId} AND m."bookmarkedAt" IS NOT NULL AND m."mediaId" IS NULL) "bookmarksUnavailable",
    (SELECT count(*)::int FROM "MediaMark" m WHERE m."artworkId"=a.id AND m."userId"=${userId} AND m."likedAt" IS NOT NULL AND m."mediaId" IS NOT NULL) "likesAvailable",
    (SELECT count(*)::int FROM "MediaMark" m WHERE m."artworkId"=a.id AND m."userId"=${userId} AND m."likedAt" IS NOT NULL AND m."mediaId" IS NULL) "likesUnavailable",
    EXISTS(SELECT 1 FROM "ArtworkLike" l WHERE l."artworkId"=a.id AND l."userId"<>${userId}) OR EXISTS(SELECT 1 FROM "MediaMark" m WHERE m."artworkId"=a.id AND m."userId"<>${userId} AND(m."bookmarkedAt" IS NOT NULL OR m."likedAt" IS NOT NULL)) other
    FROM "Artwork" a WHERE a.id IN(${Prisma.join(ids)})`)
  const covers = await artworkDedupCoverUrls(tx, ids, userId)
  const byId = new Map(counts.map((row) => [row.artworkId, row]))
  return rows.map((row) => {
    const n = byId.get(row.id)!
    const reading = row.readingSummaries[0]
    return contract.artworkDedupMemberDtoSchema.parse({
      artworkId: row.id,
      title: row.title,
      thumbnailUrl: covers.get(row.id) ?? null,
      sourceLabel: row.source,
      createdAt: row.createdAt.toISOString(),
      ownOrganization: {
        rating: row.likes[0]?.level ?? null,
        bookmarks: { available: n.bookmarksAvailable, unavailable: n.bookmarksUnavailable },
        likes: { available: n.likesAvailable, unavailable: n.likesUnavailable }
      },
      ownReading: reading ? { ...reading, lastViewedAt: reading.lastViewedAt?.toISOString() ?? null } : null,
      otherAccountHasOrganization: n.other
    })
  })
}
function groupDto(
  choice: ArtworkDedupGroupChoice,
  members: contract.ArtworkDedupMemberDto[]
): contract.ArtworkDedupGroupDto {
  return {
    groupId: choice.groupId,
    relationKind: choice.relationKind,
    visual: choice.visual ? contract.artworkDedupVisualSummarySchema.parse(choice.visual) : null,
    containedArtworkId: choice.containedArtworkId,
    containerArtworkId: choice.containerArtworkId,
    containedFileCount: choice.containedFileCount?.toString() ?? null,
    containerFileCount: choice.containerFileCount?.toString() ?? null,
    extraFileCount:
      choice.containerFileCount !== null && choice.containedFileCount !== null
        ? (choice.containerFileCount - choice.containedFileCount).toString()
        : null,
    memberCount: choice.memberCount,
    fileCount: choice.fileCount.toString(),
    previewMembers: members.slice(0, 3),
    keeper: members.find((member) => member.artworkId === choice.keeperArtworkId) ?? null,
    recommendedKeeperArtworkId: ['VISUAL', 'PARTIAL'].includes(choice.relationKind) ? null : choice.keeperArtworkId,
    recommendationReason: choice.reason,
    savedReview:
      choice.saved && choice.keeperArtworkId
        ? { groupId: choice.groupId, keeperArtworkId: choice.keeperArtworkId, reviewVersion: choice.reviewVersion }
        : null,
    reviewVersion: choice.reviewVersion,
    needsExplicitChoice: choice.keeperArtworkId === null,
    eligibility: !choice.eligible ? 'STALE' : choice.keeperArtworkId === null ? 'NEEDS_CHOICE' : 'ELIGIBLE',
    reasons: !choice.eligible
      ? ['CONTENT_OR_SCOPE_CHANGED']
      : choice.keeperArtworkId === null
        ? [
            ['VISUAL', 'PARTIAL'].includes(choice.relationKind)
              ? 'EXPLICIT_CHOICE_REQUIRED'
              : choice.relationKind === 'CONTAINS'
                ? 'CONTAINED_HAS_ORGANIZATION'
                : 'MULTIPLE_ORGANIZED_MEMBERS'
          ]
        : []
  }
}
export async function listArtworkDedupReviewGroups(
  userId: string,
  input: z.infer<typeof contract.artworkDedupReviewListGroupsInputSchema>,
  database: Database = databaseDefault
): Promise<contract.ArtworkDedupListGroupsDto> {
  assertArtworkDedupAccount(userId, input.expectedUserId)
  return mapArtworkDedupMaintenanceError(() =>
    database.$transaction(async (tx) => {
      const run = await tx.artworkDedupRun.findUnique({ where: { id: input.runId } })
      if (!run) conflict('NOT_FOUND')
      const state = await tx.artworkDedupReviewState.findUnique({ where: { runId_userId: { runId: run.id, userId } } })
      const common = {
        runId: run.id,
        runVersion: run.version,
        reviewRevision: state?.reviewRevision ?? 0,
        allowedActions:
          run.status === 'COMPLETED' && contract.isArtworkDedupMaintenanceModeEnabled('PREPARE')
            ? contract.isArtworkDedupMaintenanceModeEnabled('PREPARE', 'DIRECT_DELETE')
              ? (['SAVE_REVIEW', 'PREPARE_CLEANUP'] as const)
              : (['SAVE_REVIEW'] as const)
            : []
      }
      const scope = [
        userId,
        run.id,
        run.version,
        common.reviewRevision,
        'groupId' in input ? 'MEMBERS' : 'GROUPS',
        'groupId' in input ? input.groupId : null
      ]
      if ('groupId' in input) {
        const after = readArtworkDedupCursor(input.memberCursor, scope)
        if (after !== null && typeof after !== 'number') conflict('INVALID_CURSOR')
        const choice = (await readArtworkDedupGroupChoices(tx, { runId: run.id, userId, groupId: input.groupId }))[0]
        if (!choice) conflict('NOT_FOUND')
        const rows = await tx.$queryRaw<{ artworkId: number }[]>(Prisma.sql`
          SELECT "artworkId" FROM "ArtworkDedupResultMember" WHERE "runId"=${run.id} AND "groupId"=${input.groupId} AND "artworkId">${after ?? 0}
          ORDER BY "artworkId" LIMIT ${input.limit + 1}`)
        const page = rows.slice(0, input.limit),
          ids = page.map((row) => row.artworkId)
        const members = await artworkDedupMembers(tx, userId, [
          ...ids,
          ...(choice.keeperArtworkId ? [choice.keeperArtworkId] : [])
        ])
        const byId = new Map(members.map((member) => [member.artworkId, member]))
        const items = ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
        return contract.artworkDedupListGroupsDtoSchema.parse({
          ...common,
          kind: 'MEMBERS',
          group: groupDto(choice, items),
          keeper: choice.keeperArtworkId ? (byId.get(choice.keeperArtworkId) ?? null) : null,
          items,
          nextMemberCursor: rows.length > input.limit ? artworkDedupCursor(scope, page.at(-1)!.artworkId) : null
        })
      }
      const after = readArtworkDedupCursor(input.cursor, scope)
      if (after !== null && typeof after !== 'string') conflict('INVALID_CURSOR')
      const choices =
        run.status === 'COMPLETED'
          ? await readArtworkDedupGroupChoices(tx, {
              runId: run.id,
              userId,
              afterGroupId: after ?? '',
              limit: input.limit + 1
            })
          : []
      const page = choices.slice(0, input.limit)
      const previews = page.length
        ? await tx.$queryRaw<{ groupId: string; artworkId: number }[]>(
            Prisma.sql`SELECT g.id "groupId",m."artworkId" FROM "ArtworkDedupResult" g CROSS JOIN LATERAL(SELECT "artworkId" FROM "ArtworkDedupResultMember" WHERE "groupId"=g.id ORDER BY "artworkId" LIMIT 3)m WHERE g.id IN(${Prisma.join(page.map((c) => c.groupId))})`
          )
        : []
      const members = await artworkDedupMembers(tx, userId, [
        ...previews.map((row) => row.artworkId),
        ...page.flatMap((choice) => (choice.keeperArtworkId ? [choice.keeperArtworkId] : []))
      ])
      const byId = new Map(members.map((row) => [row.artworkId, row]))
      const totals = await tx.$queryRaw<{ total: number; recommended: number }[]>(
        Prisma.sql`SELECT count(*)::int total,count(*) FILTER(WHERE eligible AND "keeperArtworkId" IS NOT NULL AND "relationKind" NOT IN ('VISUAL','PARTIAL'))::int recommended FROM artwork_dedup_group_choices(${run.id},${userId})`
      )
      return contract.artworkDedupListGroupsDtoSchema.parse({
        ...common,
        kind: 'GROUPS',
        items: page.map((choice) =>
          groupDto(
            choice,
            [
              ...previews.filter((row) => row.groupId === choice.groupId).map((row) => row.artworkId),
              ...(choice.keeperArtworkId &&
              !previews.some((row) => row.groupId === choice.groupId && row.artworkId === choice.keeperArtworkId)
                ? [choice.keeperArtworkId]
                : [])
            ].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
          )
        ),
        nextCursor: choices.length > input.limit ? artworkDedupCursor(scope, page.at(-1)!.groupId) : null,
        totalGroups: totals[0]?.total ?? 0,
        recommendedGroupCount: totals[0]?.recommended ?? 0
      })
    })
  )
}
export async function listArtworkDedupComparisons(
  userId: string,
  input: z.infer<typeof contract.artworkDedupListComparisonsInputSchema>,
  database: Database = databaseDefault
): Promise<contract.ArtworkDedupListComparisonsDto> {
  assertArtworkDedupAccount(userId, input.expectedUserId)
  return mapArtworkDedupMaintenanceError(() =>
    database.$transaction(async (tx) => {
      const run = await tx.artworkDedupRun.findUnique({
        where: { id: input.runId },
        select: { status: true, version: true }
      })
      if (!run || run.status !== 'COMPLETED') conflict('NOT_FOUND')
      const pair = await tx.artworkDedupVisualPair.findUnique({ where: { id: input.groupId } })
      if (!pair || pair.runId !== input.runId) conflict('NOT_FOUND')
      const visual = contract.artworkDedupVisualSummarySchema.parse(pair.summary)
      const scope = [userId, input.runId, run.version, input.groupId, visual.evidenceVersion, input.filter]
      const after = readArtworkDedupCursor(input.cursor, scope)
      if (after !== null && typeof after !== 'number') conflict('INVALID_CURSOR')
      const rows = await tx.artworkDedupVisualPage.findMany({
        where: {
          pairId: pair.id,
          ordinal: { gt: after ?? 0 },
          ...(input.filter === 'DIFFERENT'
            ? { kind: { not: 'EXACT' } }
            : input.filter === 'PAIRED'
              ? { kind: { in: ['EXACT', 'SIMILAR'] } }
              : input.filter === 'UNMATCHED' || input.filter === 'UNCHECKED'
                ? { kind: input.filter }
                : {})
        },
        orderBy: { ordinal: 'asc' },
        take: input.limit + 1
      })
      const page = rows.slice(0, input.limit)
      const imageIds = page.flatMap((row) =>
        [row.leftImageId, row.rightImageId].filter((id): id is number => id !== null)
      )
      const images = imageIds.length
        ? await tx.image.findMany({
            where: {
              id: { in: imageIds },
              artworkId: { in: [pair.leftArtworkId, pair.rightArtworkId] },
              artwork: { deletedAt: null, archiveLifecycleState: 'ACTIVE' }
            },
            select: { id: true, artworkId: true }
          })
        : []
      const byId = new Map(images.map((image) => [image.id, image.artworkId]))
      const media = (artworkId: number, imageId: number | null, index: number | null, unchecked: boolean) =>
        imageId === null || index === null
          ? null
          : {
              artworkId,
              imageId,
              index,
              thumbnailUrl:
                !unchecked && byId.get(imageId) === artworkId
                  ? `/api/artwork-dedup/cover/${artworkId}?expectedUserId=${encodeURIComponent(userId)}&imageId=${imageId}`
                  : null
            }
      return contract.artworkDedupListComparisonsDtoSchema.parse({
        runId: input.runId,
        groupId: pair.id,
        visual,
        items: page.map((row) => ({
          id: row.ordinal,
          kind: row.kind,
          left: media(pair.leftArtworkId, row.leftImageId, row.leftIndex, row.kind === 'UNCHECKED'),
          right: media(pair.rightArtworkId, row.rightImageId, row.rightIndex, row.kind === 'UNCHECKED')
        })),
        nextCursor: rows.length > input.limit ? artworkDedupCursor(scope, page.at(-1)!.ordinal) : null
      })
    })
  )
}
export async function saveArtworkDedupReviewService(
  userId: string,
  input: z.infer<typeof contract.artworkDedupSaveReviewInputSchema>,
  database: Database = databaseDefault
) {
  assertArtworkDedupAccount(userId, input.expectedUserId)
  assertArtworkDedupMode('PREPARE')
  return mapArtworkDedupMaintenanceError(() =>
    database.$transaction(async (tx) => {
      const result = await saveArtworkDedupReview(tx, { ...input, userId })
      return {
        review: contract.artworkDedupReviewDtoSchema.parse(result.review),
        reviewRevision: result.reviewRevision
      }
    })
  )
}
type RetryJob = Parameters<typeof isArtworkDedupPrepareRetryable>[1]
function operationActions(
  op: Operation,
  job: RetryJob,
  now: Date
): contract.ArtworkDedupOperationDto['allowedActions'] {
  if (op.preparePurpose === 'DIRECT_DELETE') {
    if (!contract.isArtworkDedupMaintenanceModeEnabled('DIRECT_DELETE', 'DIRECT_DELETE')) return []
    if (op.mode === 'DIRECT_DELETE') {
      if (op.status === 'DELETED') return ['ALLOW_REIMPORT']
      if (op.status === 'CANCELLED') return []
      if (op.readerState === 'BLOCKED') return []
      const idle = !op.readerToken && op.readerState === 'IDLE'
      const jobInactive = !job || ['FAILED', 'CANCELLED', 'COMPLETED', 'PAUSED'].includes(job.status)
      if (idle && jobInactive && ['RECOVERY_REQUIRED', 'STOPPED', 'FAILED'].includes(op.status)) {
        return op.cancelRequestedAt ? ['RETRY_OPERATION'] : ['RETRY_OPERATION', op.deleteStartedAt ? 'STOP' : 'CANCEL']
      }
      return op.cancelRequestedAt ? [] : [op.deleteStartedAt ? 'STOP' : 'CANCEL']
    }
    if (![1, 2, 3, 4].includes(op.protocolVersion ?? 0)) return []
    if (op.status === 'BUILDING') return op.cancelRequestedAt ? [] : ['CANCEL']
    if (op.readerToken || op.readerState !== 'IDLE') return []
    if (op.status === 'READY' && op.scopeDigest) return ['DIRECT_DELETE']
    if (isArtworkDedupPrepareRetryable(op, job, now)) return ['RETRY_PREPARE', 'REPREPARE']
    return ['STALE', 'FAILED', 'CANCELLED'].includes(op.status) ? ['REPREPARE'] : []
  }
  if (op.readerToken || op.readerState === 'BLOCKED') return []
  const actions: contract.ArtworkDedupOperationDto['allowedActions'] = []
  if (op.status === 'BUILDING' && contract.isArtworkDedupMaintenanceModeEnabled('PREPARE')) actions.push('CANCEL')
  if (
    ['STALE', 'FAILED', 'CANCELLED'].includes(op.status) &&
    op.originalAction === 'PREPARE' &&
    contract.isArtworkDedupMaintenanceModeEnabled('PREPARE')
  ) {
    actions.push('REPREPARE')
  }
  if (isArtworkDedupPrepareRetryable(op, job, now) && contract.isArtworkDedupMaintenanceModeEnabled('PREPARE')) {
    actions.push('RETRY_PREPARE')
  }
  if (op.status === 'READY' && contract.isArtworkDedupMaintenanceModeEnabled('ISOLATE')) actions.push('ISOLATE')
  if (op.status === 'ISOLATED' && contract.isArtworkDedupMaintenanceModeEnabled('RESTORE')) actions.push('RESTORE')
  if (op.status === 'ISOLATED' && contract.isArtworkDedupMaintenanceModeEnabled('PREPARE', 'PURGE')) {
    actions.push('PREPARE_PURGE')
  }
  if (
    op.status === 'ISOLATED' &&
    op.purgePreviewStatus === 'READY' &&
    contract.isArtworkDedupMaintenanceModeEnabled('PURGE')
  ) {
    actions.push('PURGE')
  }
  if (op.status === 'RECOVERY_REQUIRED' && contract.isArtworkDedupMaintenanceModeEnabled('ISOLATE')) {
    actions.push('RETRY_OPERATION')
  }
  if (op.status === 'PURGED' && contract.isArtworkDedupMaintenanceModeEnabled('PURGE')) actions.push('ALLOW_REIMPORT')
  return actions
}
export function artworkDedupOperationDto(
  op: Operation,
  job: RetryJob = null,
  now = new Date(),
  progress?: {
    completedCopies: number
    remainingCopies: number
    blockedCopies: number
    remainingFiles: string
    deleteIntentFiles: string
  }
): contract.ArtworkDedupOperationDto {
  return contract.artworkDedupOperationDtoSchema.parse({
    operationId: op.id,
    artistId: op.artistId,
    runId: op.runId,
    runVersion: op.runVersion,
    version: op.version,
    executionVersion: op.executionVersion,
    jobId: op.jobId,
    mode: op.mode,
    originalAction: op.originalAction,
    preparePurpose: op.preparePurpose,
    protocolVersion: op.protocolVersion ?? null,
    scopeDigest: op.scopeDigest ?? null,
    status: op.status,
    stage: op.stage,
    preparationVersion: op.preparationVersion,
    createdAt: op.createdAt.toISOString(),
    updatedAt: op.updatedAt.toISOString(),
    validatedAt: op.validatedAt?.toISOString() ?? null,
    deleteStartedAt: op.deleteStartedAt?.toISOString() ?? null,
    stopRequested: Boolean(op.cancelRequestedAt),
    counts: {
      selectedGroups: op.selectedGroups,
      excludedGroups: op.excludedGroups,
      blockedGroups: op.blockedGroups,
      keepers: op.keepers,
      copies: op.copies,
      preparedArtworks: op.preparedArtworks,
      preparedFiles: op.preparedFiles.toString(),
      verifiedFiles: (op.verifiedFiles ?? 0n).toString(),
      logicalBytes: op.logicalBytes?.toString() ?? null,
      movedFiles: op.movedFiles.toString(),
      restoredFiles: op.restoredFiles.toString(),
      deletedFiles: op.deletedFiles.toString(),
      ...(progress ?? {
        completedCopies: op.status === 'DELETED' ? op.copies : 0,
        remainingCopies: op.status === 'DELETED' ? 0 : op.copies,
        blockedCopies: 0,
        remainingFiles: '0',
        deleteIntentFiles: '0'
      })
    },
    requiresOrganizationConfirmation: op.requiresOrganizationConfirmation,
    backupCheckpointRef: op.backupCheckpointRef,
    purgePreview: op.purgePreviewStatus
      ? {
          status: op.purgePreviewStatus,
          version: op.purgePreviewVersion,
          validatedAt: op.purgePreviewValidatedAt?.toISOString() ?? null
        }
      : null,
    allowedActions: operationActions(op, job, now),
    failure: op.errorCode
      ? {
          code: op.errorCode,
          message:
            op.errorCode === 'FILESYSTEM_CAPABILITY_UNAVAILABLE'
              ? '当前文件系统无法完成安全文件操作，请检查存储配置'
              : op.errorCode === 'SNAPSHOT_CHANGED'
                ? '审核依据已变化，请重新生成预览'
                : '维护未完成，请查看预览中的阻断原因'
        }
      : null
  })
}
async function assertDirectDeleteWorker(
  tx: Prisma.TransactionClient,
  replay?: { userId: string; idempotencyKey: string; prepare?: boolean }
) {
  if (replay) {
    const where = { requestedBy_idempotencyKey: { requestedBy: replay.userId, idempotencyKey: replay.idempotencyKey } }
    const prior = replay.prepare
      ? await tx.artworkDedupOperation.findUnique({ where, select: { id: true } })
      : await tx.artworkDedupCommand.findUnique({ where, select: { operationId: true } })
    // The domain still validates the canonical replay. An existing intent needs no new Worker capability.
    if (prior) return
  }
  const workers = await tx.workerInstance.findMany({
    where: { status: 'READY', heartbeatAt: { gte: new Date(Date.now() - WORKER_HEARTBEAT_STALE_AFTER_MS) } },
    orderBy: { heartbeatAt: 'desc' },
    take: 20,
    select: { capabilities: true }
  })
  if (
    !workers.some(
      ({ capabilities }) =>
        Array.isArray(capabilities) &&
        capabilities.some(
          (entry) =>
            entry !== null &&
            typeof entry === 'object' &&
            !Array.isArray(entry) &&
            entry.jobType === 'ARTWORK_DEDUP_MAINTENANCE' &&
            entry.executionLane === 'BACKGROUND_WRITER' &&
            Array.isArray(entry.definitionVersions) &&
            entry.definitionVersions.includes(contract.ARTWORK_DEDUP_DIRECT_DELETE_DEFINITION_VERSION)
        )
    )
  ) {
    throw new TRPCError({ code: 'PRECONDITION_FAILED', message: '支持直接删除协议的 Worker 尚未就绪' })
  }
}
async function projectOperation(tx: Prisma.TransactionClient, op: Operation, userId: string, job: RetryJob = null) {
  let progress: Parameters<typeof artworkDedupOperationDto>[3]
  if (op.preparePurpose === 'DIRECT_DELETE') {
    const [counts] = await tx.$queryRaw<
      {
        completedCopies: number
        remainingCopies: number
        blockedCopies: number
        remainingFiles: string
        deleteIntentFiles: string
      }[]
    >(Prisma.sql`
      SELECT count(*) FILTER(WHERE a.status='DELETED')::int "completedCopies",
        count(*) FILTER(WHERE a.status<>'DELETED')::int "remainingCopies",
        count(*) FILTER(WHERE a.status='BLOCKED' OR a."errorCode" IS NOT NULL)::int "blockedCopies",
        (SELECT count(*)::text FROM "ArtworkDedupOperationFile" f JOIN "ArtworkDedupOperationArtwork" b USING("operationId","artworkId") WHERE f."operationId"=${op.id} AND b.role='COPY' AND f.status<>'DELETED') "remainingFiles",
        (SELECT count(DISTINCT r."fileId")::text FROM "ArtworkDedupFileReceipt" r WHERE r."operationId"=${op.id} AND r.step='DELETE') "deleteIntentFiles"
      FROM "ArtworkDedupOperationArtwork" a WHERE a."operationId"=${op.id} AND a.role='COPY'`)
    progress = counts
  }
  const dto = artworkDedupOperationDto(op, job, new Date(), progress)
  if (op.requestedBy !== userId) dto.allowedActions = []
  return dto
}
async function enqueueOperation(tx: Prisma.TransactionClient, op: Operation) {
  const direct = op.preparePurpose === 'DIRECT_DELETE'
  const job = await tx.systemJob.create({
    data: {
      id: randomUUID(),
      type: 'ARTWORK_DEDUP_MAINTENANCE',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: direct ? op.preparationVersion === 2 ? 6 : 5 : 1,
      triggerSource: 'SYSTEM',
      queuePriority: 900,
      effectivePriority: 900,
      maxAttempts: 3,
      requestedByUserId: op.requestedBy,
      payload: contract.artworkDedupMaintenancePayloadSchema.parse({
        operationId: op.id,
        executionVersion: op.executionVersion,
        mode: op.mode,
        ...(direct && op.mode === 'PREPARE' ? { purpose: 'DIRECT_DELETE', protocolVersion: op.protocolVersion } : {})
      }),
      idempotencyKey: `artwork-dedup-maintenance:${op.id}:${op.executionVersion}`
    }
  })
  const updated = await tx.artworkDedupOperation.update({ where: { id: op.id }, data: { jobId: job.id } })
  await writeJobEvent(tx, {
    jobId: job.id,
    type: 'job.queued',
    message: '重复作品维护已排队',
    data: { operationId: op.id, mode: op.mode }
  })
  return updated
}
export async function prepareArtworkDedupCleanup(
  userId: string,
  input:
    | z.infer<typeof contract.artworkDedupPrepareCleanupInputSchema>
    | z.infer<typeof contract.artworkDedupPrepareDirectDeleteInputSchema>,
  database: Database = databaseDefault
) {
  assertArtworkDedupAccount(userId, input.expectedUserId)
  const purpose = 'purpose' in input ? input.purpose : 'ISOLATION'
  assertArtworkDedupMode('PREPARE', purpose)
  return mapArtworkDedupMaintenanceError(() =>
    database.$transaction(async (tx) => {
      if (purpose === 'DIRECT_DELETE') {
        await assertDirectDeleteWorker(tx, { userId, idempotencyKey: input.idempotencyKey, prepare: true })
      }
      if ('sourceOperationId' in input) {
        const source = await tx.artworkDedupOperation.findUnique({ where: { id: input.sourceOperationId } })
        if (source?.requestedBy !== userId || source.preparePurpose !== purpose) conflict('SCOPE_MISMATCH')
      }
      const result = await freezeArtworkDedupOperation(tx, { ...input, userId, preparePurpose: purpose })
      return artworkDedupOperationDto(result.created
        ? purpose === 'DIRECT_DELETE' ? await prepareArtworkDedupQuickConfirmation(tx, result.operation.id) : await enqueueOperation(tx, result.operation)
        : result.operation)
    }, { timeout: 30000 })
  )
}
export async function getArtworkDedupOperation(
  userId: string,
  input: z.infer<typeof contract.artworkDedupGetOperationInputSchema>,
  database: Database = databaseDefault
): Promise<contract.ArtworkDedupOperationResponseDto> {
  assertArtworkDedupAccount(userId, input.expectedUserId)
  return mapArtworkDedupMaintenanceError(() =>
    database.$transaction(async (tx) => {
      const op = await tx.artworkDedupOperation.findUnique({ where: { id: input.operationId } })
      if (!op) conflict('NOT_FOUND')
      const job = op.jobId ? await tx.systemJob.findUnique({ where: { id: op.jobId } }) : null
      const operation = await projectOperation(tx, op, userId, job),
        preview = input.preview
      if (!preview) return { operation, preview: null }
      const scope = [
        userId,
        op.id,
        op.version,
        preview.kind,
        preview.kind === 'FILES' ? (preview.artworkId ?? null) : null
      ]
      const after = readArtworkDedupCursor(preview.cursor, scope)
      if (preview.kind === 'FILES') {
        if (
          preview.artworkId !== undefined &&
          !(await tx.artworkDedupOperationArtwork.findUnique({
            where: { operationId_artworkId: { operationId: op.id, artworkId: preview.artworkId } },
            select: { artworkId: true }
          }))
        ) {
          conflict('SCOPE_MISMATCH')
        }
        if (after !== null && typeof after !== 'string') conflict('INVALID_CURSOR')
        const rows = await tx.artworkDedupOperationFile.findMany({
            where: {
              operationId: op.id,
              ...(preview.artworkId ? { artworkId: preview.artworkId } : {}),
              fileId: { gt: after ?? '' }
            },
            orderBy: { fileId: 'asc' },
            include: { artwork: { select: { role: true, title: true } } },
            take: preview.limit + 1
          }),
          page = rows.slice(0, preview.limit)
        return contract.artworkDedupOperationResponseDtoSchema.parse({
          operation,
          preview: {
            kind: 'FILES',
            items: page.map((file) => ({
              fileId: file.fileId,
              artworkId: file.artworkId,
              role: file.role,
              artworkRole: file.artwork.role,
              artworkTitle: file.artwork.title,
              relativeName: file.canonicalPath.split('/').at(-1) ?? '文件',
              sizeBytes: file.size?.toString() ?? null,
              inspectionStatus: file.inspectionStatus,
              ownershipStatus: file.ownershipStatus,
              requiresReview: file.requiresReview,
              blockReason: file.blockReason,
              status: file.status
            })),
            nextCursor: rows.length > preview.limit ? artworkDedupCursor(scope, page.at(-1)!.fileId) : null
          }
        })
      }
      if (after !== null && typeof after !== 'number') conflict('INVALID_CURSOR')
      const rows = await tx.artworkDedupOperationArtwork.findMany({
          where: { operationId: op.id, artworkId: { gt: after ?? 0 } },
          orderBy: { artworkId: 'asc' },
          take: preview.limit + 1
        }),
        page = rows.slice(0, preview.limit)
      const members = await artworkDedupMembers(
        tx,
        userId,
        page.map((item) => item.artworkId)
      )
      const byId = new Map(members.map((row) => [row.artworkId, row]))
      const resultEvidence = await tx.artworkDedupOperationGroup.findMany({
        where: { operationId: op.id, groupId: { in: page.map((item) => item.groupId) } }
      })
      const resultById = new Map(resultEvidence.map((result) => [result.groupId, result]))
      const bindings = await tx.artworkDedupOperationSource.findMany({
        where: { operationId: op.id, artworkId: { in: page.map((item) => item.artworkId) } },
        include: { source: true }
      })
      return contract.artworkDedupOperationResponseDtoSchema.parse({
        operation,
        preview: {
          kind: 'ARTWORKS',
          items: page.map((item) => ({
            ...(byId.get(item.artworkId) ?? {
              artworkId: item.artworkId,
              title: item.title,
              sourceLabel: item.sourceLabel,
              thumbnailUrl: null,
              createdAt: item.artworkCreatedAt.toISOString(),
              ownOrganization: {
                rating: null,
                bookmarks: { available: 0, unavailable: 0 },
                likes: { available: 0, unavailable: 0 }
              },
              ownReading: null,
              otherAccountHasOrganization: false
            }),
            // These fields are durable display evidence even after the business row is gone.
            title: item.title,
            sourceLabel: item.sourceLabel,
            createdAt: item.artworkCreatedAt.toISOString(),
            personalRecords:
              item.status === 'DELETED' ? 'REMOVED' : byId.has(item.artworkId) ? 'CURRENT' : 'UNAVAILABLE',
            mediaCount: item.memberCount.toString(),
            fileCount: item.fileCount.toString(),
            itemId: item.artworkId,
            groupId: item.groupId,
            relationKind: resultById.get(item.groupId)?.relationKind ?? 'EXACT',
            visual: resultById.get(item.groupId)?.visual ?? null,
            containedArtworkId: resultById.get(item.groupId)?.containedArtworkId ?? null,
            containerArtworkId: resultById.get(item.groupId)?.containerArtworkId ?? null,
            containedFileCount: resultById.get(item.groupId)?.containedFileCount?.toString() ?? null,
            containerFileCount: resultById.get(item.groupId)?.containerFileCount?.toString() ?? null,
            extraFileCount:
              resultById.get(item.groupId)?.relationKind === 'CONTAINS'
                ? (
                    resultById.get(item.groupId)!.containerFileCount! -
                    resultById.get(item.groupId)!.containedFileCount!
                  ).toString()
                : null,
            role: item.role,
            status:
              op.preparePurpose === 'DIRECT_DELETE' && op.status === 'CANCELLED' && item.role === 'COPY'
                ? 'CANCELLED'
                : item.status,
            reasons: item.errorCode ? [item.errorCode] : [],
            canAllowReimport:
              ['PURGED', 'DELETED'].includes(item.status) &&
              operation.allowedActions.includes('ALLOW_REIMPORT') &&
              bindings.some(
                (b) =>
                  b.artworkId === item.artworkId &&
                  b.source.status === 'TOMBSTONE' &&
                  b.source.ownerOperationId === op.id
              ),
            sources: bindings
              .filter((b) => b.artworkId === item.artworkId)
              .map((b) => ({
                sourceId: b.sourceId,
                displayName:
                  b.source.kind === 'PROVIDER'
                    ? `${b.source.providerKey ?? '外部'} 来源`
                    : `${b.source.kind === 'DIRECTORY' ? '目录' : '原件'} · ${b.source.canonicalPath?.split('/').at(-1) || '媒体来源'}`,
                generation: b.source.generation.toString(),
                status: b.source.status
              }))
          })),
          nextCursor: rows.length > preview.limit ? artworkDedupCursor(scope, page.at(-1)!.artworkId) : null
        }
      })
    })
  )
}
export async function listArtworkDedupOperations(
  userId: string,
  input: z.infer<typeof contract.artworkDedupListOperationsInputSchema>,
  database: Database = databaseDefault
) {
  assertArtworkDedupAccount(userId, input.expectedUserId)
  return mapArtworkDedupMaintenanceError(() =>
    database.$transaction(async (tx) => {
      const scope = [userId, 'OPERATIONS', input.artistId ?? null],
        after = readArtworkDedupCursor(input.cursor, scope)
      if (after !== null && typeof after !== 'string') conflict('INVALID_CURSOR')
      const prior = after
        ? await tx.artworkDedupOperation.findUnique({
            where: { id: after },
            select: { createdAt: true, artistId: true }
          })
        : null
      if (after && (!prior || (input.artistId && prior.artistId !== input.artistId))) conflict('INVALID_CURSOR')
      const rows = await tx.artworkDedupOperation.findMany({
          where: {
            ...(input.artistId ? { artistId: input.artistId } : {}),
            ...(prior
              ? {
                  OR: [
                    { createdAt: { lt: prior.createdAt } },
                    { createdAt: prior.createdAt, id: { lt: after as string } }
                  ]
                }
              : {})
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: input.limit + 1
        }),
        page = rows.slice(0, input.limit)
      const jobs = await tx.systemJob.findMany({
        where: { id: { in: page.flatMap((op) => (op.jobId ? [op.jobId] : [])) } }
      })
      const jobsById = new Map(jobs.map((job) => [job.id, job]))
      return {
        items: await Promise.all(
          page.map((op) => projectOperation(tx, op, userId, op.jobId ? (jobsById.get(op.jobId) ?? null) : null))
        ),
        nextCursor: rows.length > input.limit ? artworkDedupCursor(scope, page.at(-1)!.id) : null
      }
    })
  )
}
export async function controlArtworkDedupPrepare(
  userId: string,
  input: z.infer<typeof contract.artworkDedupRetryOperationInputSchema>,
  action: 'RETRY' | 'CANCEL',
  database: Database = databaseDefault
): Promise<contract.ArtworkDedupOperationDto> {
  assertArtworkDedupAccount(userId, input.expectedUserId)
  return mapArtworkDedupMaintenanceError(() =>
    database.$transaction(async (tx) => {
      const current = await tx.artworkDedupOperation.findUnique({ where: { id: input.operationId } })
      if (!current) conflict('NOT_FOUND')
      const directPurpose = current.preparePurpose === 'DIRECT_DELETE' || current.mode === 'DIRECT_DELETE'
      assertArtworkDedupMode(
        current.mode === 'DIRECT_DELETE' ? 'DIRECT_DELETE' : 'PREPARE',
        directPurpose ? 'DIRECT_DELETE' : 'ISOLATION'
      )
      if (directPurpose) {
        if (input.itemIds !== undefined) conflict('SCOPE_MISMATCH')
        contract.artworkDedupDirectDeleteRetryInputSchema.parse(input)
        if (current.requestedBy !== userId) conflict('ACCOUNT_CHANGED')
      }
      await lockArtworkDedupActor(tx, userId)
      await lockArtworkDedupCommand(tx, userId, input.idempotencyKey)
      const digest = artworkDedupRequestDigest({ input, action })
      const prior = await tx.artworkDedupCommand.findUnique({
        where: { requestedBy_idempotencyKey: { requestedBy: userId, idempotencyKey: input.idempotencyKey } }
      })
      if (prior) {
        // A PREPARE control receipt remains valid after the operation advances to DIRECT_DELETE.
        const directAction = action === 'RETRY' ? 'RETRY_DIRECT_DELETE' : 'STOP_DIRECT_DELETE'
        let expectedDigest = digest
        if (prior.action !== `${action}_OPERATION`) {
          if (!directPurpose || prior.action !== directAction) conflict('IDEMPOTENCY_CONFLICT')
          const command = contract.artworkDedupDirectDeleteRetryInputSchema.parse(input)
          expectedDigest = artworkDedupRequestDigest({ ...command, userId })
        }
        if (
          prior.operationId !== input.operationId ||
          prior.expectedVersion !== input.expectedVersion ||
          prior.requestDigest !== expectedDigest
        ) {
          conflict('IDEMPOTENCY_CONFLICT')
        }
        const replay = await tx.artworkDedupOperation.findUniqueOrThrow({ where: { id: input.operationId } })
        return projectOperation(
          tx,
          replay,
          userId,
          replay.jobId ? await tx.systemJob.findUnique({ where: { id: replay.jobId } }) : null
        )
      }
      if (current.mode === 'DIRECT_DELETE') {
        const command = contract.artworkDedupDirectDeleteRetryInputSchema.parse(input)
        if (action === 'RETRY') {
          await assertDirectDeleteWorker(tx, { userId, idempotencyKey: input.idempotencyKey })
          const result = await retryArtworkDedupDirectDelete(tx, { ...command, userId })
          const op = result.created ? await enqueueOperation(tx, result.operation) : result.operation
          return projectOperation(tx, op, userId)
        }
        let op = await requestArtworkDedupDirectDeleteStop(tx, { ...command, userId })
        if (!op.jobId) {
          await assertDirectDeleteWorker(tx)
          op = await enqueueOperation(tx, op)
        }
        return projectOperation(tx, op, userId)
      }
      if (current.preparePurpose === 'DIRECT_DELETE') {
        if (action === 'RETRY') await assertDirectDeleteWorker(tx)
      }
      const before = await tx.artworkDedupOperation.findUnique({ where: { id: input.operationId } })
      if (!before) conflict('NOT_FOUND')
      await tx.$queryRaw`SELECT "resourceKey" FROM job_resource_leases WHERE "resourceKey"='lane/background-writer' FOR UPDATE`
      if (before.jobId) await tx.$queryRaw(Prisma.sql`SELECT id FROM system_jobs WHERE id=${before.jobId} FOR UPDATE`)
      let op = await lockArtworkDedupOperation(tx, input.operationId)
      if (
        op.version !== input.expectedVersion ||
        op.jobId !== before.jobId ||
        op.mode !== 'PREPARE' ||
        op.originalAction !== 'PREPARE' ||
        !['ISOLATION', 'DIRECT_DELETE'].includes(op.preparePurpose) ||
        input.itemIds?.length
      ) {
        conflict()
      }
      if (action === 'RETRY') {
        const job = op.jobId ? await tx.systemJob.findUnique({ where: { id: op.jobId } }) : null
        if (!isArtworkDedupPrepareRetryable(op, job, new Date())) conflict()
        op = await tx.artworkDedupOperation.update({
          where: { id: op.id },
          data: {
            status: 'BUILDING',
            executionVersion: { increment: 1 },
            version: { increment: 1 },
            cancelRequestedAt: null,
            errorCode: null
          }
        })
        op = await enqueueOperation(tx, op)
      } else {
        if (op.status !== 'BUILDING') conflict()
        const job = op.jobId ? await tx.systemJob.findUnique({ where: { id: op.jobId } }) : null
        if (!job) conflict()
        const now = new Date(),
          running = ['RUNNING', 'PAUSING', 'CANCELLING'].includes(job.status)
        if (!running && !['PENDING', 'RETRY_WAIT', 'PAUSED'].includes(job.status)) conflict()
        await tx.systemJob.update({
          where: { id: job.id },
          data: running ? { status: 'CANCELLING' } : { status: 'CANCELLED', finishedAt: now }
        })
        op = await tx.artworkDedupOperation.update({
          where: { id: op.id },
          data: { cancelRequestedAt: now, ...(!running ? { status: 'CANCELLED' } : {}), version: { increment: 1 } }
        })
      }
      await tx.artworkDedupCommand.create({
        data: {
          runId: op.runId,
          requestedBy: userId,
          idempotencyKey: input.idempotencyKey,
          expectedVersion: input.expectedVersion,
          action: `${action}_OPERATION`,
          resultingVersion: op.version,
          operationId: op.id,
          requestDigest: digest
        }
      })
      return artworkDedupOperationDto(op)
    })
  )
}
export async function directDeleteArtworkDedupOperation(
  userId: string,
  input: z.infer<typeof contract.artworkDedupDirectDeleteInputSchema>,
  database: Database = databaseDefault
) {
  assertArtworkDedupAccount(userId, input.expectedUserId)
  assertArtworkDedupMode('DIRECT_DELETE', 'DIRECT_DELETE')
  const parsed = contract.artworkDedupDirectDeleteInputSchema.parse(input)
  return mapArtworkDedupMaintenanceError(() =>
    database.$transaction(async (tx) => {
      await assertDirectDeleteWorker(tx, { userId, idempotencyKey: input.idempotencyKey })
      const result = await authorizeArtworkDedupDirectDelete(tx, { ...parsed, userId })
      const op = result.created ? await enqueueOperation(tx, result.operation) : result.operation
      return projectOperation(tx, op, userId)
    })
  )
}
export async function allowArtworkDedupReimport(
  userId: string,
  input: z.infer<typeof contract.artworkDedupAllowReimportInputSchema>,
  database: Database = databaseDefault
) {
  assertArtworkDedupAccount(userId, input.expectedUserId)
  assertArtworkDedupMode('DIRECT_DELETE', 'DIRECT_DELETE')
  const parsed = contract.artworkDedupAllowReimportInputSchema.parse(input)
  return mapArtworkDedupMaintenanceError(() =>
    database.$transaction(async (tx) => {
      const op = await allowArtworkDedupDirectDeleteReimport(tx, {
        ...parsed,
        userId,
        sources: parsed.sources.map((source) => ({ ...source, expectedGeneration: BigInt(source.expectedGeneration) }))
      })
      return projectOperation(tx, op, userId)
    })
  )
}
/** All advanced routes use the same release check before entering their domain transaction. */
export async function artworkDedupAdvancedOperation(
  userId: string,
  input: { expectedUserId: string },
  mode: contract.ArtworkDedupMaintenanceMode,
  purpose: 'ISOLATION' | 'PURGE' = 'ISOLATION'
): Promise<contract.ArtworkDedupOperationDto> {
  assertArtworkDedupAccount(userId, input.expectedUserId)
  assertArtworkDedupMode(mode, purpose)
  throw new TRPCError({ code: 'FORBIDDEN', message: '此维护阶段尚未完成验收' })
}
