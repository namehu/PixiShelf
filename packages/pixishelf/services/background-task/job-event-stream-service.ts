import 'server-only'

import type { Prisma } from '@pixishelf/db'
import { jobEventStreamBatchSchema, type JobEventStreamBatch } from '@pixishelf/job-contracts'
import { prisma } from '@/lib/prisma'
import {
  systemJobEventWireSelect,
  systemJobLiveSummarySelect,
  toJobEventDto,
  toJobLiveSummary
} from './job-serialization'

export const JOB_EVENT_STREAM_BATCH_LIMIT = 200

type JobEventStreamClient = Pick<Prisma.TransactionClient, 'systemJobEvent'>

export interface JobEventStreamSource {
  watermark(): Promise<string>
  readAfter(cursor: string, limit: number): Promise<JobEventStreamBatch>
}

export class PostgresJobEventStreamSource implements JobEventStreamSource {
  constructor(private readonly client: JobEventStreamClient = prisma as unknown as JobEventStreamClient) {}

  async watermark(): Promise<string> {
    const latest = await this.client.systemJobEvent.findFirst({
      where: { job: { definitionVersion: { gte: 1 } } },
      orderBy: { id: 'desc' },
      select: { id: true }
    })
    return latest?.id.toString(10) ?? '0'
  }

  async readAfter(cursor: string, limit: number): Promise<JobEventStreamBatch> {
    const boundedLimit = Math.max(1, Math.min(JOB_EVENT_STREAM_BATCH_LIMIT, Math.trunc(limit)))
    const records = await this.client.systemJobEvent.findMany({
      where: {
        id: { gt: BigInt(cursor) },
        job: { definitionVersion: { gte: 1 } }
      },
      orderBy: { id: 'asc' },
      take: boundedLimit,
      select: {
        ...systemJobEventWireSelect,
        job: { select: systemJobLiveSummarySelect }
      }
    })
    const items = records.map((record) => ({
      event: toJobEventDto(record),
      job: toJobLiveSummary(record.job)
    }))
    return jobEventStreamBatchSchema.parse({
      version: 1,
      cursor: items.at(-1)?.event.id ?? cursor,
      items
    })
  }
}

