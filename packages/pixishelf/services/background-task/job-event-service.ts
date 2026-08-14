import { prisma } from '@/lib/prisma'
import {
  bigintStringSchema,
  jobEventLevelSchema,
  jobEventTypeSchema,
  jsonValueSchema,
  type JobEventDto
} from '@pixishelf/job-contracts'
import { Prisma } from '@pixishelf/db'
import { z } from 'zod'
import { redactSensitiveText, sanitizeJsonValue, systemJobEventWireSelect, toJobEventDto } from './job-serialization'

const eventWriteSchema = z.object({
  jobId: z.string().min(1),
  type: jobEventTypeSchema,
  level: jobEventLevelSchema.default('INFO'),
  attempt: z.number().int().nonnegative().default(0),
  workerId: z.string().min(1).max(120).nullable().default(null),
  stage: z.string().min(1).max(80).nullable().default(null),
  progress: z.number().int().min(0).max(100).nullable().default(null),
  message: z.string().max(4_096).nullable().default(null),
  data: jsonValueSchema.nullable().default(null)
})

export type JobEventWriteInput = z.input<typeof eventWriteSchema>

export async function writeJobEvent(client: Prisma.TransactionClient, input: JobEventWriteInput): Promise<JobEventDto> {
  const parsed = eventWriteSchema.parse(input)
  const record = await client.systemJobEvent.create({
    data: {
      ...parsed,
      message: redactSensitiveText(parsed.message),
      data: parsed.data === null ? Prisma.JsonNull : (sanitizeJsonValue(parsed.data) as Prisma.InputJsonValue)
    },
    select: systemJobEventWireSelect
  })
  return toJobEventDto(record)
}

export const incrementalJobEventsInputSchema = z.object({
  jobId: z.string().min(1),
  afterEventId: bigintStringSchema.optional(),
  limit: z.number().int().min(1).max(500).default(100)
})

type JobEventQueryClient = Pick<Prisma.TransactionClient, 'systemJobEvent'>

export async function listIncrementalJobEvents(
  input: z.input<typeof incrementalJobEventsInputSchema>,
  client: JobEventQueryClient = prisma as unknown as JobEventQueryClient
) {
  const parsed = incrementalJobEventsInputSchema.parse(input)
  const records = await client.systemJobEvent.findMany({
    where: {
      jobId: parsed.jobId,
      ...(parsed.afterEventId ? { id: { gt: BigInt(parsed.afterEventId) } } : {})
    },
    orderBy: { id: 'asc' },
    take: parsed.limit,
    select: systemJobEventWireSelect
  })
  const items = records.map(toJobEventDto)
  return {
    items,
    lastEventId: items.at(-1)?.id ?? parsed.afterEventId ?? null
  }
}
