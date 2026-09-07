import { JOB_STATUS_VALUES, JOB_TYPE_VALUES, type JobType } from '@pixishelf/job-contracts'
import { Prisma } from '@pixishelf/db'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { backgroundJobLabel, backgroundJobTypeLabels, backgroundScanModeLabels } from '@/lib/background-job-labels'
import { redactArchiveText } from '@/services/archive/archive-redaction'
import { redactSensitiveText } from './job-redaction'

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
type HistoryClient = Pick<Prisma.TransactionClient, 'systemJob'>

function toHistoryItem(record: HistoryRecord) {
  const redact = record.type.startsWith('ARCHIVE_') ? redactArchiveText : redactSensitiveText
  return {
    id: record.id,
    type: record.type as JobType,
    label: backgroundJobLabel(record.type as JobType, record.payload),
    status: record.status,
    triggerSource: record.triggerSource,
    parentJobId: record.parentJobId,
    progress: record.progress,
    stage: redact(record.stage),
    message: redact(record.message)?.slice(0, 500) ?? null,
    errorCode: redact(record.errorCode),
    error: redact(record.error)?.slice(0, 500) ?? null,
    effectivePriority: record.effectivePriority,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString()
  }
}

export type BackgroundHistoryItem = ReturnType<typeof toHistoryItem>

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
  const conditions: Prisma.SystemJobWhereInput[] = [{ definitionVersion: { gte: 1 } }]
  if (!parsed.includeBatchChildren) {
    conditions.push({
      NOT: {
        OR: [
          { type: 'PIXIV_TAG_ENRICHMENT', parentJobId: { not: null } },
          { type: 'PIXIV_ARTIST_ENRICHMENT', parentJobId: { not: null } },
          { type: 'PIXIV_ARTWORK_ENRICHMENT', parentJobId: { not: null } },
          { type: 'PIXIV_SERIES_RECONCILIATION', parentJobId: { not: null } }
        ]
      }
    })
  }
  if (parsed.statuses?.length) conditions.push({ status: { in: parsed.statuses } })
  if (parsed.types?.length) conditions.push({ type: { in: parsed.types } })
  if (parsed.triggerSources?.length) conditions.push({ triggerSource: { in: parsed.triggerSources } })
  if (parsed.createdFrom || parsed.createdTo) {
    conditions.push({
      createdAt: {
        ...(parsed.createdFrom ? { gte: new Date(parsed.createdFrom) } : {}),
        ...(parsed.createdTo ? { lt: new Date(parsed.createdTo) } : {})
      }
    })
  }
  if (parsed.search) conditions.push(historySearchWhere(parsed.search))
  if (parsed.cursor) {
    conditions.push({
      OR: [
        { createdAt: { lt: new Date(parsed.cursor.createdAt) } },
        { createdAt: new Date(parsed.cursor.createdAt), id: { lt: parsed.cursor.id } }
      ]
    })
  }
  const records = await client.systemJob.findMany({
    where: { AND: conditions },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: parsed.limit + 1,
    select: historySelect
  })
  const items = records.slice(0, parsed.limit).map(toHistoryItem)
  const last = items.at(-1)
  return {
    items,
    nextCursor:
      records.length > parsed.limit && last
        ? Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64url')
        : null
  }
}

export async function getBackgroundHistorySnapshots(
  input: z.input<typeof backgroundHistorySnapshotsInputSchema>,
  client: HistoryClient = prisma as unknown as HistoryClient
) {
  const { ids } = backgroundHistorySnapshotsInputSchema.parse(input)
  const records = await client.systemJob.findMany({
    where: { definitionVersion: { gte: 1 }, id: { in: [...new Set(ids)] } },
    select: historySelect
  })
  return { items: records.map(toHistoryItem) }
}
