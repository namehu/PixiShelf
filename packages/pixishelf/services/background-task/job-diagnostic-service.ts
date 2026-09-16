import { Prisma } from '@pixishelf/db'
import {
  extractJobDiagnostic,
  jobDiagnosticSchema,
  sanitizeDiagnosticText,
  type JobDiagnostic
} from '@pixishelf/job-contracts'
import { TRPCError } from '@trpc/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'

const idSchema = z.string().min(1).max(128)
const cursorSchema = z
  .string()
  .regex(/^\d{1,19}$/)
  .refine((value) => BigInt(value) <= 9223372036854775807n)
const reportCursorSchema = z
  .string()
  .max(512)
  .transform((value, context) => {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid cursor')
      return z
        .object({ id: z.uuid(), createdAt: z.iso.datetime() })
        .parse(JSON.parse(Buffer.from(value, 'base64url').toString()))
    } catch {
      context.addIssue({ code: 'custom', message: '诊断报告游标无效，请刷新后重试。' })
      return z.NEVER
    }
  })
export const backgroundDiagnosticReportsInputSchema = z.object({
  jobId: idSchema,
  cursor: reportCursorSchema.optional(),
  childCursor: idSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50)
})
export const backgroundDiagnosticItemsInputSchema = z.object({
  jobId: idSchema,
  reportId: z.union([z.uuid(), z.literal('legacy')]),
  reason: z.string().min(1).max(160).optional(),
  cursor: cursorSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50)
})

type DiagnosticClient = Pick<
  Prisma.TransactionClient,
  'systemJob' | 'systemJobDiagnosticReport' | 'systemJobDiagnosticItem' | 'archiveImport' | 'archiveImportItem'
>
type ReportRow = Prisma.SystemJobDiagnosticReportGetPayload<{}>
type ItemRow = Prisma.SystemJobDiagnosticItemGetPayload<{}>
const jobSelect = {
  id: true,
  type: true,
  status: true,
  attempt: true,
  errorCode: true,
  error: true,
  stage: true,
  result: true,
  payload: true,
  createdAt: true,
  finishedAt: true,
  updatedAt: true
} satisfies Prisma.SystemJobSelect
type DiagnosticJob = Prisma.SystemJobGetPayload<{ select: typeof jobSelect }>

export interface DiagnosticReportView {
  id: string
  attempt: number
  source: 'SNAPSHOT' | 'LEGACY_CHECKPOINT' | 'LEGACY_SAMPLES' | 'SUMMARY_ONLY'
  outcome: string | null
  itemCount: number
  totalKnown: boolean
  recordedCount: number
  currentCount: number
  inheritedCount: number
  complete: boolean
  createdAt: string
  closedAt: string | null
  expiresAt: string | null
  expired: boolean
}
export interface DiagnosticItemView extends JobDiagnostic {
  id: string
  origin: string
  targetLabel: string | null
  stage: string | null
  itemAttempt: number | null
  createdAt: string
  href: string | null
}

async function requireJob(jobId: string, client: DiagnosticClient) {
  const job = await client.systemJob.findUnique({
    where: { id: jobId, definitionVersion: { gte: 1 } },
    select: jobSelect
  })
  if (!job) throw new TRPCError({ code: 'NOT_FOUND', message: '任务不存在。' })
  return job
}

function reportView(row: ReportRow): DiagnosticReportView {
  return {
    id: row.id,
    attempt: row.attempt,
    source: 'SNAPSHOT',
    outcome: row.outcome,
    itemCount: row.itemCount,
    totalKnown: true,
    recordedCount: row.itemCount,
    currentCount: row.currentCount,
    inheritedCount: row.inheritedCount,
    complete: row.complete,
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    // Stop serving evidence at the retention deadline, including between cleanup batches.
    expired: row.expiredAt !== null || (row.closedAt !== null && row.expiresAt.getTime() <= Date.now())
  }
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}
function text(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}
function legacySamples(job: DiagnosticJob) {
  const result = object(job.result)
  const samples = result.failedSamples ?? result.failures
  return (Array.isArray(samples) ? samples : []).slice(0, 1000).map(object)
}
function legacyFailedCount(job: DiagnosticJob): number | null {
  const result = object(job.result)
  const validCount = (value: unknown): value is number =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
  if (job.type === 'VIDEO_MEDIA_PROBE') {
    const probe = object(result.probe).failed
    const poster = object(result.poster).failed
    if (validCount(probe) && validCount(poster)) return probe + poster
  }
  if (job.type === 'VIDEO_CHAPTER_PREVIEW_GENERATION' && validCount(result.failed) && validCount(result.audioFailed)) {
    return result.failed + result.audioFailed
  }
  const count = result.failed ?? result.failedCount ?? result.inaccessible
  return validCount(count) ? count : null
}

async function legacyReport(job: DiagnosticJob, client: DiagnosticClient): Promise<DiagnosticReportView | null> {
  // Only the still-linked current checkpoint is available. It is never presented as an immutable past attempt.
  const archive =
    job.type === 'ARCHIVE_IMPORT'
      ? await client.archiveImport.findUnique({
          where: { systemJobId: job.id },
          select: { id: true, failedItems: true }
        })
      : null
  const samples = legacySamples(job)
  const total = archive?.failedItems ?? legacyFailedCount(job)
  const itemCount = total ?? samples.length
  if (!job.error && !job.errorCode && !itemCount && !samples.length) return null
  return {
    id: 'legacy',
    attempt: job.attempt,
    source: archive?.failedItems ? 'LEGACY_CHECKPOINT' : samples.length ? 'LEGACY_SAMPLES' : 'SUMMARY_ONLY',
    outcome: job.status,
    itemCount,
    totalKnown: total !== null,
    recordedCount: archive?.failedItems ?? samples.length,
    currentCount: 0,
    inheritedCount: 0,
    complete: false,
    createdAt: job.createdAt.toISOString(),
    closedAt: job.finishedAt?.toISOString() ?? null,
    expiresAt: null,
    expired: false
  }
}

export async function listBackgroundDiagnosticReports(
  input: z.output<typeof backgroundDiagnosticReportsInputSchema>,
  client: DiagnosticClient = prisma as unknown as DiagnosticClient
) {
  const job = await requireJob(input.jobId, client)
  const records = await client.systemJobDiagnosticReport.findMany({
    where: {
      jobId: job.id,
      ...(input.cursor
        ? {
            OR: [
              { createdAt: { lt: new Date(input.cursor.createdAt) } },
              { createdAt: new Date(input.cursor.createdAt), id: { lt: input.cursor.id } }
            ]
          }
        : {})
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: input.limit + 1
  })
  const rows = records.slice(0, input.limit)
  const last = rows.at(-1)
  const fallback = !records.length && !input.cursor ? await legacyReport(job, client) : null
  const childWhere = { parentJobId: job.id, definitionVersion: { gte: 1 }, status: 'FAILED' as const }
  const [failedChildren, childRows] = await Promise.all([
    client.systemJob.count({ where: childWhere }),
    client.systemJob.findMany({
      where: { ...childWhere, ...(input.childCursor ? { id: { gt: input.childCursor } } : {}) },
      orderBy: { id: 'asc' },
      take: 51,
      select: { id: true, type: true }
    })
  ])
  return {
    items: fallback ? [fallback] : rows.map(reportView),
    nextCursor:
      records.length > input.limit && last
        ? Buffer.from(JSON.stringify({ id: last.id, createdAt: last.createdAt.toISOString() })).toString('base64url')
        : null,
    businessHref: businessHref(job),
    // Child failures retain their own reports; the parent does not duplicate their evidence.
    failedChildren,
    childItems: childRows.slice(0, 50),
    nextChildCursor: childRows.length > 50 ? childRows[49]!.id : null
  }
}

function businessHref(job: DiagnosticJob): string | null {
  const payload = object(job.payload)
  if (job.type === 'ARCHIVE_IMPORT' && typeof payload.archiveImportId === 'string') {
    return `/admin/archive?taskId=${encodeURIComponent(payload.archiveImportId)}`
  }
  if (job.type === 'SCAN' || job.type === 'LOCAL_DIRECTORY_IMPORT') return '/admin/scan-history'
  return null
}
function itemHref(targetType: string | null, targetId: string | null): string | null {
  if (!targetId || !/^\d+$/.test(targetId)) return null
  if (targetType?.toUpperCase() === 'ARTWORK') return `/artworks/${targetId}`
  if (targetType?.toUpperCase() === 'ARTIST') return `/artists/${targetId}`
  if (targetType?.toUpperCase() === 'TAG') return `/tags/${targetId}`
  return null
}
function itemView(row: ItemRow): DiagnosticItemView {
  const diagnostic = jobDiagnosticSchema.safeParse({
    version: 1,
    code: row.code,
    reasonKey: row.reasonKey,
    message: row.message,
    suggestion: row.suggestion,
    evidence: row.evidence,
    remoteHost: row.remoteHost,
    httpStatus: row.httpStatus
  })
  const safe = diagnostic.success ? diagnostic.data : extractJobDiagnostic(undefined, { code: row.code })
  return {
    ...safe,
    message: sanitizeDiagnosticText(safe.message),
    suggestion: sanitizeDiagnosticText(safe.suggestion, 500),
    id: row.id.toString(),
    origin: row.origin,
    targetLabel: row.targetLabel ? sanitizeDiagnosticText(row.targetLabel) : null,
    stage: row.stage ? sanitizeDiagnosticText(row.stage, 80) : null,
    itemAttempt: row.itemAttempt,
    createdAt: row.createdAt.toISOString(),
    href: itemHref(row.targetType, row.targetId)
  }
}

export async function listBackgroundDiagnosticItems(
  input: z.output<typeof backgroundDiagnosticItemsInputSchema>,
  client: DiagnosticClient = prisma as unknown as DiagnosticClient
) {
  const job = await requireJob(input.jobId, client)
  if (input.reportId === 'legacy') return legacyItems(input, job, client)
  const report = await client.systemJobDiagnosticReport.findFirst({ where: { id: input.reportId, jobId: job.id } })
  if (!report) throw new TRPCError({ code: 'NOT_FOUND', message: '诊断报告不存在或不属于该任务。' })
  const summary = reportView(report)
  if (summary.expired) return { summary, groups: [], items: [], nextCursor: null, taskError: null }
  const [records, groups, task] = await Promise.all([
    client.systemJobDiagnosticItem.findMany({
      where: {
        reportId: report.id,
        scope: 'ITEM',
        ...(input.reason ? { reasonKey: input.reason } : {}),
        ...(input.cursor ? { id: { gt: BigInt(input.cursor) } } : {})
      },
      orderBy: { id: 'asc' },
      take: input.limit + 1
    }),
    client.systemJobDiagnosticItem.groupBy({
      by: ['reasonKey'],
      where: { reportId: report.id, scope: 'ITEM' },
      _count: { _all: true }
    }),
    client.systemJobDiagnosticItem.findFirst({ where: { reportId: report.id, scope: 'TASK' }, orderBy: { id: 'desc' } })
  ])
  const rows = records.slice(0, input.limit)
  return {
    summary,
    groups: groups.map((group) => ({ reasonKey: group.reasonKey, count: group._count._all })),
    items: rows.map(itemView),
    nextCursor: records.length > input.limit ? rows.at(-1)!.id.toString() : null,
    taskError: task ? itemView(task) : null
  }
}

async function legacyItems(
  input: z.output<typeof backgroundDiagnosticItemsInputSchema>,
  job: DiagnosticJob,
  client: DiagnosticClient
) {
  // A client cannot use the legacy endpoint to bypass a captured/expired snapshot.
  if (await client.systemJobDiagnosticReport.findFirst({ where: { jobId: job.id }, select: { id: true } })) {
    throw new TRPCError({ code: 'CONFLICT', message: '任务已有执行报告，请刷新后查看。' })
  }
  const summary = await legacyReport(job, client)
  if (!summary) throw new TRPCError({ code: 'NOT_FOUND', message: '该任务没有已记录的失败诊断。' })
  const taskError: DiagnosticItemView | null =
    job.error || job.errorCode
      ? {
          ...extractJobDiagnostic(undefined, { code: job.errorCode ?? undefined, message: job.error ?? undefined }),
          id: 'task',
          origin: 'CURRENT',
          targetLabel: null,
          stage: job.stage,
          itemAttempt: null,
          createdAt: job.finishedAt?.toISOString() ?? job.updatedAt.toISOString(),
          href: null
        }
      : null
  if (summary.source === 'LEGACY_CHECKPOINT') {
    const archive = await client.archiveImport.findUnique({ where: { systemJobId: job.id }, select: { id: true } })
    if (!archive) throw new TRPCError({ code: 'CONFLICT', message: '归档记录已变化，请刷新。' })
    const [records, counts] = await Promise.all([
      client.archiveImportItem.findMany({
        where: {
          archiveImportId: archive.id,
          archiveImport: { systemJobId: job.id },
          status: 'FAILED',
          ...(input.reason === 'code:UNKNOWN_ERROR'
            ? { OR: [{ errorCode: null }, { errorCode: 'UNKNOWN_ERROR' }] }
            : input.reason
              ? { errorCode: input.reason.replace(/^code:/, '') }
              : {}),
          ...(input.cursor ? { pageIndex: { gt: Number(input.cursor) } } : {})
        },
        orderBy: { pageIndex: 'asc' },
        take: input.limit + 1
      }),
      client.archiveImportItem.groupBy({
        by: ['errorCode'],
        where: { archiveImportId: archive.id, archiveImport: { systemJobId: job.id }, status: 'FAILED' },
        _count: { _all: true }
      })
    ])
    const rows = records.slice(0, input.limit)
    const items: DiagnosticItemView[] = rows.map((row) => ({
      ...extractJobDiagnostic(undefined, {
        code: row.errorCode ?? undefined,
        message: row.errorMessage ?? undefined,
        remoteHost: row.remoteHost
      }),
      id: row.id,
      origin: 'LEGACY',
      targetLabel: sanitizeDiagnosticText(`第 ${row.pageIndex + 1} 张 · ${row.expectedFilename}`),
      stage: row.errorStage,
      itemAttempt: row.attempts,
      createdAt: (row.finishedAt ?? row.updatedAt).toISOString(),
      href: `/admin/archive?taskId=${encodeURIComponent(archive.id)}`
    }))
    return {
      summary,
      groups: counts.map((group) => ({
        reasonKey: `code:${group.errorCode ?? 'UNKNOWN_ERROR'}`,
        count: group._count._all
      })),
      items,
      nextCursor: records.length > input.limit ? String(rows.at(-1)!.pageIndex) : null,
      taskError
    }
  }
  const samples: DiagnosticItemView[] = legacySamples(job).map((sample, index) => ({
    ...extractJobDiagnostic(undefined, {
      code: text(sample.errorCode) ?? text(sample.code),
      message: text(sample.error) ?? text(sample.errorSummary) ?? text(sample.message)
    }),
    id: String(index + 1),
    origin: 'LEGACY',
    targetLabel: sanitizeDiagnosticText(
      String(
        sample.path ?? sample.targetPath ?? sample.artworkId ?? sample.externalId ?? sample.id ?? `项目 ${index + 1}`
      )
    ),
    stage: null,
    itemAttempt: null,
    createdAt: job.finishedAt?.toISOString() ?? job.updatedAt.toISOString(),
    href: sample.artworkId != null ? itemHref('ARTWORK', String(sample.artworkId)) : null
  }))
  const grouped = new Map<string, number>()
  for (const sample of samples) grouped.set(sample.reasonKey, (grouped.get(sample.reasonKey) ?? 0) + 1)
  const filtered = samples.filter(
    (sample) =>
      (!input.reason || sample.reasonKey === input.reason) &&
      (!input.cursor || BigInt(sample.id) > BigInt(input.cursor))
  )
  const items = filtered.slice(0, input.limit)
  return {
    summary,
    groups: [...grouped].map(([reasonKey, count]) => ({ reasonKey, count })),
    items,
    nextCursor: filtered.length > input.limit ? items.at(-1)!.id : null,
    taskError
  }
}
