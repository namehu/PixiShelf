import { isArchiveJobType, JOB_STATUS_VALUES, JOB_TYPE_VALUES, type JobType } from '@pixishelf/job-contracts'
import { Prisma } from '@pixishelf/db'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { backgroundJobLabel, backgroundJobTypeLabels, backgroundScanModeLabels } from '@/lib/background-job-labels'
import { redactArchiveText } from '@/services/archive/archive-redaction'
import { redactSensitiveText } from './job-redaction'
import { dashboardVisibleWhere, currentArchiveExecutionWhere, unacknowledgedFailureWhere } from './job-failure-policy'
import { diagnosticSummarySelect, hasPartialFailure } from './job-diagnostic-summary'
import { logicalArchiveSelect, logicalJobIdentity, readLogicalJobPage } from './logical-job-page'

const cursorValueSchema = z.object({ createdAt: z.string().datetime(), id: z.string().min(1).max(128) })
const historyCursorSchema = z
  .string()
  .min(1)
  .max(512)
  .transform((value, context) => {
    try {
      if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding')
      return cursorValueSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')))
    } catch {
      context.addIssue({ code: 'custom', message: '执行记录游标无效，请重新查询。' })
      return z.NEVER
    }
  })

export const backgroundFailuresInputSchema = z.object({
  cursor: historyCursorSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50)
})

export const backgroundHistoryInputSchema = z
  .object({
    cursor: historyCursorSchema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
    statuses: z.array(z.enum(JOB_STATUS_VALUES)).max(JOB_STATUS_VALUES.length).optional(),
    types: z.array(z.enum(JOB_TYPE_VALUES)).max(JOB_TYPE_VALUES.length).optional(),
    triggerSources: z
      .array(z.enum(['MANUAL', 'SCHEDULE', 'SYSTEM', 'RETRY', 'LEGACY']))
      .max(5)
      .optional(),
    createdFrom: z.string().datetime().optional(),
    createdTo: z.string().datetime().optional(),
    search: z.string().trim().max(500).optional(),
    artworkId: z.number().int().positive().optional(),
    includeBatchChildren: z.boolean().default(false)
  })
  .refine(
    (value) => !value.createdFrom || !value.createdTo || Date.parse(value.createdFrom) < Date.parse(value.createdTo),
    {
      message: '开始日期必须早于结束日期。',
      path: ['createdTo']
    }
  )

export const backgroundHistorySnapshotsInputSchema = z.object({
  ids: z.array(z.string().min(1).max(128)).min(1).max(100)
})

const historySelect = {
  ...diagnosticSummarySelect,
  ...logicalArchiveSelect,
  id: true,
  type: true,
  status: true,
  triggerSource: true,
  parentJobId: true,
  payload: true,
  progress: true,
  stage: true,
  message: true,
  errorCode: true,
  error: true,
  effectivePriority: true,
  createdAt: true,
  updatedAt: true
} satisfies Prisma.SystemJobSelect

type HistoryRecord = Prisma.SystemJobGetPayload<{ select: typeof historySelect }>
type HistoryClient = Pick<Prisma.TransactionClient, 'systemJob' | '$queryRaw'>

function toHistoryItem(record: HistoryRecord) {
  const redact = record.type.startsWith('ARCHIVE_') ? redactArchiveText : redactSensitiveText
  return {
    id: record.id,
    ...(isArchiveJobType(record.type) &&
    record.payload &&
    typeof record.payload === 'object' &&
    !Array.isArray(record.payload) &&
    typeof record.payload.archiveImportId === 'string'
      ? { archiveImportId: record.payload.archiveImportId }
      : {}),
    type: record.type as JobType,
    label: backgroundJobLabel(record.type as JobType, record.payload),
    status: record.status,
    hasPartialFailure: hasPartialFailure(record),
    triggerSource: record.triggerSource,
    parentJobId: record.parentJobId,
    progress: record.progress,
    stage: redact(record.stage),
    message: redact(record.message)?.slice(0, 500) ?? null,
    errorCode: redact(record.errorCode),
    error: redact(record.error)?.slice(0, 500) ?? null,
    effectivePriority: record.effectivePriority,
    createdAt: logicalJobIdentity(record).createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  }
}

export type BackgroundHistoryItem = Omit<ReturnType<typeof toHistoryItem>, 'hasPartialFailure'> & {
  hasPartialFailure?: boolean
}

function historySearchWhere(search: string): Prisma.SystemJobWhereInput {
  const needle = search.toLocaleLowerCase()
  const matchingTypes = JOB_TYPE_VALUES.filter(
    (type) => type.toLowerCase().includes(needle) || backgroundJobTypeLabels[type]?.toLocaleLowerCase().includes(needle)
  )
  const aliases = Object.entries(backgroundScanModeLabels)
    .filter(([, label]) => label.toLocaleLowerCase().includes(needle))
    .map(([mode]): Prisma.SystemJobWhereInput => ({ type: 'SCAN', payload: { path: ['mode'], equals: mode } }))
  const contains = { contains: search, mode: 'insensitive' as const }
  return {
    OR: [
      { id: contains },
      { archiveImport: { is: { id: contains } } },
      { message: contains },
      { errorCode: contains },
      { error: contains },
      ...(matchingTypes.length ? [{ type: { in: matchingTypes } }] : []),
      ...aliases
    ]
  }
}

export async function listBackgroundHistory(
  parsed: z.output<typeof backgroundHistoryInputSchema>,
  client: HistoryClient = prisma as unknown as HistoryClient
) {
  if (parsed.artworkId) return listArtworkOptimizationHistory(parsed, client)
  const conditions: Prisma.SystemJobWhereInput[] = [{ definitionVersion: { gte: 1 } }, currentArchiveExecutionWhere]
  if (!parsed.includeBatchChildren) {
    conditions.push(dashboardVisibleWhere)
  }
  if (parsed.statuses?.length) conditions.push({ status: { in: parsed.statuses } })
  if (parsed.types?.length) conditions.push({ type: { in: parsed.types } })
  if (parsed.triggerSources?.length) conditions.push({ triggerSource: { in: parsed.triggerSources } })
  if (parsed.search) conditions.push(historySearchWhere(parsed.search))
  return listHistoryPage(parsed, conditions, client, parsed)
}

async function listArtworkOptimizationHistory(
  parsed: z.output<typeof backgroundHistoryInputSchema>,
  client: HistoryClient
) {
  const clauses = [
    Prisma.sql`j.type = 'VIDEO_STREAMING_OPTIMIZATION'`,
    Prisma.sql`j."definitionVersion" >= 1`,
    Prisma.sql`EXISTS (SELECT 1 FROM "Image" i WHERE i."artworkId" = ${parsed.artworkId!}
      AND j.payload #> '{imageId}' = to_jsonb(i.id))`
  ]
  if (parsed.statuses?.length) clauses.push(Prisma.sql`j.status::text IN (${Prisma.join(parsed.statuses)})`)
  if (parsed.types?.length) clauses.push(Prisma.sql`j.type IN (${Prisma.join(parsed.types)})`)
  if (parsed.triggerSources?.length) {
    clauses.push(Prisma.sql`j."triggerSource"::text IN (${Prisma.join(parsed.triggerSources)})`)
  }
  if (parsed.createdFrom) clauses.push(Prisma.sql`j."createdAt" >= ${new Date(parsed.createdFrom)}`)
  if (parsed.createdTo) clauses.push(Prisma.sql`j."createdAt" < ${new Date(parsed.createdTo)}`)
  if (parsed.cursor) {
    clauses.push(Prisma.sql`(j."createdAt", j.id) < (${new Date(parsed.cursor.createdAt)}, ${parsed.cursor.id})`)
  }
  if (parsed.search) {
    const needle = `%${parsed.search}%`
    const type = 'VIDEO_STREAMING_OPTIMIZATION'
    const normalized = parsed.search.toLocaleLowerCase()
    const typeMatches =
      type.toLowerCase().includes(normalized) || backgroundJobTypeLabels[type].toLocaleLowerCase().includes(normalized)
    clauses.push(Prisma.sql`(${typeMatches} OR j.id ILIKE ${needle} OR j.message ILIKE ${needle}
      OR j."errorCode" ILIKE ${needle} OR j.error ILIKE ${needle})`)
  }
  const ids = await client.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT j.id FROM system_jobs j WHERE ${Prisma.join(clauses, ' AND ')}
    ORDER BY j."createdAt" DESC, j.id DESC LIMIT ${parsed.limit + 1}`)
  const records = await client.systemJob.findMany({
    where: { id: { in: ids.slice(0, parsed.limit).map((row) => row.id) } },
    select: historySelect,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }]
  })
  const items = records.map(toHistoryItem)
  const last = items.at(-1)
  return {
    items,
    nextCursor:
      ids.length > parsed.limit && last
        ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64url')
        : null
  }
}

export async function listBackgroundFailures(
  parsed: z.output<typeof backgroundFailuresInputSchema>,
  client: HistoryClient = prisma as unknown as HistoryClient
) {
  return listHistoryPage(parsed, [unacknowledgedFailureWhere], client)
}

async function listHistoryPage(
  parsed: z.output<typeof backgroundFailuresInputSchema>,
  conditions: Prisma.SystemJobWhereInput[],
  client: HistoryClient,
  dates: { createdFrom?: string; createdTo?: string } = {}
) {
  const records = await readLogicalJobPage((args) => client.systemJob.findMany({ ...args, select: historySelect }), {
    where: { AND: conditions },
    take: parsed.limit + 1,
    cursor: parsed.cursor,
    ...dates
  })
  const items = records.slice(0, parsed.limit).map(toHistoryItem)
  const last = items.at(-1)
  return {
    items,
    nextCursor:
      records.length > parsed.limit && last
        ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.archiveImportId ?? last.id })).toString(
            'base64url'
          )
        : null
  }
}

export async function getBackgroundHistorySnapshots(
  input: z.input<typeof backgroundHistorySnapshotsInputSchema>,
  client: HistoryClient = prisma as unknown as HistoryClient
) {
  const { ids } = backgroundHistorySnapshotsInputSchema.parse(input)
  const records = await client.systemJob.findMany({
    where: {
      definitionVersion: { gte: 1 },
      AND: [
        currentArchiveExecutionWhere,
        {
          OR: [
            { id: { in: [...new Set(ids)] } },
            { archiveImport: { is: { executions: { some: { jobId: { in: ids } } } } } }
          ]
        }
      ]
    },
    select: historySelect
  })
  return { items: records.map(toHistoryItem) }
}
