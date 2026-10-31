import 'server-only'
import { randomUUID } from 'node:crypto'
import { Prisma } from '@pixishelf/db'
import { TRPCError } from '@trpc/server'
import {
  artworkBatchDeletePayloadSchema,
  artworkBatchDeleteResultSchema,
  type ArtworkBatchDeletePayload
} from '@pixishelf/job-contracts'
import { prisma } from '@/lib/prisma'
import { previewDeleteArtwork } from './artwork-service/delete-artwork'
import { writeJobEvent } from './background-task/job-event-service'

export function assertDeleteAccount(userId: string, expectedUserId: string) {
  if (userId !== expectedUserId) throw new TRPCError({ code: 'FORBIDDEN', message: '账户已切换，请刷新后重试' })
}
const conflict = (message: string): never => {
  throw new TRPCError({ code: 'CONFLICT', message })
}
const db = prisma as unknown as import('@pixishelf/db').PrismaClient
export async function previewArtworkBatchDelete(
  userId: string,
  input: { expectedUserId: string; artworkIds: number[]; idempotencyKey: string },
  origin: ArtworkBatchDeletePayload['origin'] = null
) {
  assertDeleteAccount(userId, input.expectedUserId)
  const artworkIds = [...new Set(input.artworkIds)].sort((a, b) => a - b)
  const key = `artwork-batch-delete:${userId}:${input.idempotencyKey}`
  const previous = await db.systemJob.findUnique({ where: { idempotencyKey: key } })
  if (previous) {
    const payload = artworkBatchDeletePayloadSchema.parse(previous.payload)
    if (
      JSON.stringify(payload.items.map((item) => item.artworkId)) !== JSON.stringify(artworkIds) ||
      JSON.stringify(payload.origin) !== JSON.stringify(origin)
    ) {
      conflict('同一请求的删除范围已变化')
    }
    return getArtworkBatchDelete(userId, { expectedUserId: userId, jobId: previous.id })
  }
  if (!artworkIds.length || artworkIds.length > 1000) conflict('一次请选择 1 到 1,000 部作品')
  // Only the ordinary deletion preview visits files; keepers are never passed here.
  const items: ArtworkBatchDeletePayload['items'] = []
  for (const artworkId of artworkIds) {
    const preview = await previewDeleteArtwork(artworkId, userId)
    if (!preview.canDelete) conflict(`作品 #${artworkId}「${preview.artwork.title}」暂不可删除，请检查删除范围`)
    items.push({
      artworkId,
      operationId: preview.operationId ?? randomUUID(),
      preview,
      selectedPaths:
        preview.recovery?.selectedPaths ??
        preview.entries
          .filter((entry) => entry.selection === 'REQUIRED' || entry.selection === 'OPTIONAL')
          .map((entry) => entry.path)
    })
  }
  const payload: ArtworkBatchDeletePayload = { items, origin, confirmed: false, stopAfterCurrent: false, round: 0 }
  const jobId = randomUUID()
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(80432032, hashtext(${key}))::text`
    const exists = await tx.systemJob.findUnique({ where: { idempotencyKey: key } })
    if (exists) {
      const previous = artworkBatchDeletePayloadSchema.parse(exists.payload)
      if (
        JSON.stringify(previous.items.map((item) => item.artworkId)) !== JSON.stringify(artworkIds) ||
        JSON.stringify(previous.origin) !== JSON.stringify(origin)
      ) {
        conflict('同一请求的删除范围已变化')
      }
      return
    }
    await tx.systemJob.create({
      data: {
        id: jobId,
        type: 'ARTWORK_BATCH_DELETE',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: 1,
        status: 'PAUSED',
        stage: 'CONFIRMATION',
        triggerSource: 'MANUAL',
        queuePriority: 20,
        effectivePriority: 20,
        requestedByUserId: userId,
        idempotencyKey: key,
        payload,
        result: { items: [] },
        message: `等待确认删除 ${items.length} 部作品`,
        maxAttempts: 3
      }
    })
  })
  const saved = await db.systemJob.findUniqueOrThrow({ where: { idempotencyKey: key }, select: { id: true } })
  return getArtworkBatchDelete(userId, { expectedUserId: userId, jobId: saved.id })
}

export async function getArtworkBatchDelete(userId: string, input: { expectedUserId: string; jobId: string }) {
  assertDeleteAccount(userId, input.expectedUserId)
  const job = await db.systemJob.findUnique({ where: { id: input.jobId } })
  if (!job || job.type !== 'ARTWORK_BATCH_DELETE') throw new TRPCError({ code: 'NOT_FOUND', message: '未找到删除任务' })
  if (job.requestedByUserId !== userId) throw new TRPCError({ code: 'FORBIDDEN', message: '此删除任务属于其他账户' })
  const payload = artworkBatchDeletePayloadSchema.parse(job.payload)
  const result = artworkBatchDeleteResultSchema.parse(job.result ?? { items: [] })
  const archiveIds = result.items.flatMap((item) => (item.report?.archive?.jobId ? [item.report.archive.jobId] : []))
  const archives = archiveIds.length
    ? await db.systemJob.findMany({
        where: { id: { in: archiveIds } },
        select: { id: true, status: true, message: true }
      })
    : []
  return {
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    progress: job.progress,
    message: job.message,
    createdAt: job.createdAt.toISOString(),
    payload,
    result,
    archives
  }
}

export async function submitArtworkBatchDelete(
  userId: string,
  input: { expectedUserId: string; jobId: string; items: { artworkId: number; selectedPaths: string[] }[] }
) {
  await getArtworkBatchDelete(userId, input)
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "system_jobs" WHERE id=${input.jobId} FOR UPDATE`
    const job = await tx.systemJob.findUniqueOrThrow({ where: { id: input.jobId } })
    const payload = artworkBatchDeletePayloadSchema.parse(job.payload)
    if (
      input.items.length !== payload.items.length ||
      new Set(input.items.map((item) => item.artworkId)).size !== input.items.length
    ) {
      conflict('提交作品与确认范围不一致')
    }
    for (const item of payload.items) {
      const submitted = input.items.find((entry) => entry.artworkId === item.artworkId)
      if (!submitted) return conflict(`确认中缺少作品 #${item.artworkId}`)
      const selected = [...new Set(submitted.selectedPaths)].sort()
      if (job.stage !== 'CONFIRMATION') {
        if (JSON.stringify(selected) !== JSON.stringify([...item.selectedPaths].sort())) {
          conflict('已提交的删除必须按原文件范围重试')
        }
        continue
      }
      const allowed = new Set(
        item.preview.entries
          .filter((entry) => ['REQUIRED', 'OPTIONAL'].includes(entry.selection))
          .map((entry) => entry.path)
      )
      if (
        selected.some((path) => !allowed.has(path)) ||
        item.preview.entries.some((entry) => entry.selection === 'REQUIRED' && !selected.includes(entry.path))
      ) {
        conflict(`作品 #${item.artworkId} 的文件选择无效`)
      }
      if (
        item.preview.recovery &&
        JSON.stringify(selected) !== JSON.stringify([...item.preview.recovery.selectedPaths].sort())
      ) {
        conflict('未完成的删除必须使用原选择')
      }
      item.selectedPaths = selected
    }
    if (job.stage !== 'CONFIRMATION') return
    if (job.status !== 'PAUSED') conflict('删除确认已取消，请重新选择')
    if (payload.origin) {
      const targets = new Set(payload.items.map((item) => item.artworkId))
      const ids = payload.origin.keeperArtworkIds.filter((id) => targets.has(id))
      if (ids.length) conflict(`作品 ${ids.map((id) => `#${id}`).join('、')} 同时被选择保留和删除，请调整选择`)
    }
    payload.confirmed = true
    await tx.systemJob.update({
      where: { id: job.id },
      data: {
        payload,
        status: 'PENDING',
        stage: 'QUEUED',
        availableAt: new Date(),
        message: `等待删除 ${payload.items.length} 部作品`
      }
    })
    await writeJobEvent(tx, {
      jobId: job.id,
      type: 'job.queued',
      message: `已确认删除 ${payload.items.length} 部作品`,
      data: { artworks: payload.items.length }
    })
  })
  return getArtworkBatchDelete(userId, input)
}

export async function controlArtworkBatchDelete(
  userId: string,
  input: { expectedUserId: string; jobId: string },
  action: 'STOP' | 'RETRY'
) {
  await getArtworkBatchDelete(userId, input)
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "system_jobs" WHERE id=${input.jobId} FOR UPDATE`
    const job = await tx.systemJob.findUniqueOrThrow({ where: { id: input.jobId } })
    const payload = artworkBatchDeletePayloadSchema.parse(job.payload)
    if (action === 'STOP') {
      if (['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status)) return
      payload.stopAfterCurrent = true
      const queued = ['PAUSED', 'PENDING', 'RETRY_WAIT'].includes(job.status)
      await tx.systemJob.update({
        where: { id: job.id },
        data: {
          payload,
          message: queued ? '已停止，未开始的作品不会删除' : '将在当前作品结束后停止后续删除',
          ...(queued ? { status: 'CANCELLED', finishedAt: new Date() } : {})
        }
      })
      await writeJobEvent(tx, {
        jobId: job.id,
        type: 'job.cancel_requested',
        message: '停止后续删除；已完成的删除与回收不会撤销'
      })
    } else {
      if (!['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status) || job.stage === 'CONFIRMATION') {
        conflict('当前状态不能重试')
      }
      payload.stopAfterCurrent = false
      payload.round++
      await tx.systemJob.update({
        where: { id: job.id },
        data: {
          payload,
          status: 'PENDING',
          stage: 'QUEUED',
          attempt: 0,
          finishedAt: null,
          cancelRequestedAt: null,
          leaseToken: null,
          workerId: null,
          leaseExpiresAt: null,
          availableAt: new Date(),
          message: '按原确认范围继续未完成的删除'
        }
      })
      await writeJobEvent(tx, { jobId: job.id, type: 'job.retry_scheduled', message: '按原确认范围继续未完成的删除' })
    }
  })
  return getArtworkBatchDelete(userId, input)
}

export async function listArtworkBatchDeletes(
  userId: string,
  input: { expectedUserId: string; runId?: string | undefined; artistId?: number | undefined }
) {
  assertDeleteAccount(userId, input.expectedUserId)
  type Item = {
    artworkId: number
    title: string
    status: 'PENDING' | 'PROCESSING' | 'DELETED' | 'TRASH_SUBMITTED' | 'FAILED'
    message: string
    archiveJobId: string | null
    archiveStatus: import('@pixishelf/job-contracts').JobStatus | null
    archiveLifecycleState: Prisma.ArtworkGetPayload<Record<string, never>>['archiveLifecycleState'] | null
  }
  type Summary = {
    jobId: string
    status: import('@pixishelf/job-contracts').JobStatus
    stage: string | null
    progress: number
    message: string | null
    confirmed: boolean
    stopAfterCurrent: boolean
    total: number
    items: Item[]
  }
  // Project inside PostgreSQL: file previews and reports never cross the polling connection.
  const summaries = await db.$queryRaw<Summary[]>(Prisma.sql`
    WITH recent AS (
      SELECT id,status,stage,progress,message,payload,result FROM system_jobs
      WHERE type='ARTWORK_BATCH_DELETE' AND "requestedByUserId"=${userId}
        AND ${input.runId ? Prisma.sql`payload#>>'{origin,runId}'=${input.runId}` : Prisma.sql`EXISTS (SELECT 1 FROM "ArtworkDedupRun" r WHERE r.id=payload#>>'{origin,runId}' AND r."artistId"=${input.artistId})`}
      ORDER BY "createdAt" DESC LIMIT 20
    ), prepared AS (
      SELECT r.*, (SELECT jsonb_object_agg(e->>'artworkId',e)
        FROM jsonb_array_elements(COALESCE(r.result->'items','[]'::jsonb)) e) outcomes
      FROM recent r
    )
    SELECT id "jobId",status,stage,progress,message,
      COALESCE((payload->>'confirmed')::boolean,false) confirmed,
      COALESCE((payload->>'stopAfterCurrent')::boolean,false) "stopAfterCurrent",
      jsonb_array_length(payload->'items') total,
      (SELECT jsonb_agg(jsonb_build_object(
        'artworkId',(i->>'artworkId')::int,
        'title',i#>>'{preview,artwork,title}',
        'status',COALESCE(p.outcomes->(i->>'artworkId')->>'status','PENDING'),
        'message',COALESCE(p.outcomes->(i->>'artworkId')->>'message','尚未开始'),
        'archiveJobId',p.outcomes->(i->>'artworkId')#>>'{report,archive,jobId}',
        'archiveLifecycleState',p.outcomes->(i->>'artworkId')#>>'{report,archive,lifecycleState}',
        'archiveStatus',(SELECT a.status FROM system_jobs a WHERE a.id=p.outcomes->(i->>'artworkId')#>>'{report,archive,jobId}')
      ) ORDER BY ordinal) FROM jsonb_array_elements(payload->'items') WITH ORDINALITY entries(i,ordinal)) items
    FROM prepared p`)
  return summaries.map((batch) => ({
    ...batch,
    archives: batch.items.flatMap((item) =>
      item.archiveJobId && item.archiveStatus ? [{ id: item.archiveJobId, status: item.archiveStatus }] : []
    )
  }))
}
