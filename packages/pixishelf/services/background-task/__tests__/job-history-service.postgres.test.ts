import { randomUUID } from 'node:crypto'
import { createDatabaseClient, disconnectDatabase } from '@pixishelf/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  backgroundHistoryInputSchema,
  getBackgroundHistorySnapshots,
  listBackgroundHistory
} from '../job-history-service'

const databaseUrl = Reflect.get(process.env, 'PIXISHELF_TEST_DATABASE_URL') as string | undefined
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const client = createDatabaseClient(databaseUrl ? { datasourceUrl: databaseUrl } : undefined)
const prefix = `history-${randomUUID()}`
const timestamp = new Date('2026-09-01T00:00:00.000Z')

describePostgres('execution history PostgreSQL queries', () => {
  beforeAll(async () => {
    await client.$connect()
    await client.systemJob.createMany({
      data: Array.from({ length: 105 }, (_, index) => ({
        id: `${prefix}-${String(index).padStart(3, '0')}`,
        type: 'SCAN',
        status: 'COMPLETED' as const,
        triggerSource: 'MANUAL' as const,
        createdAt: timestamp,
        payload: { mode: 'CONSISTENCY_AUDIT' },
        message: `${prefix} 消息`,
        error: `${prefix} 错误`,
        errorCode: 'HISTORY_TEST'
      }))
    })
    await client.systemJob.create({
      data: {
        id: `${prefix}-child`,
        type: 'PIXIV_TAG_ENRICHMENT',
        parentJobId: `${prefix}-000`,
        status: 'FAILED',
        triggerSource: 'SYSTEM',
        createdAt: timestamp
      }
    })
  })
  afterAll(async () => {
    await client.systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
    await disconnectDatabase(client)
  })

  it('traverses more than two pages with identical timestamps and a removed cursor record', async () => {
    const first = await listBackgroundHistory(backgroundHistoryInputSchema.parse({ search: prefix }), client)
    expect(first.items).toHaveLength(50)
    await client.systemJob.delete({ where: { id: first.items.at(-1)!.id } })
    const second = await listBackgroundHistory(
      backgroundHistoryInputSchema.parse({ search: prefix, cursor: first.nextCursor }),
      client
    )
    const third = await listBackgroundHistory(
      backgroundHistoryInputSchema.parse({ search: prefix, cursor: second.nextCursor }),
      client
    )
    expect(second.items).toHaveLength(50)
    expect(third.items).toHaveLength(5)
    expect(third.nextCursor).toBeNull()
    expect(new Set([...first.items, ...second.items, ...third.items].map((item) => item.id)).size).toBe(105)
  })

  it('applies date boundaries, Unicode search, type aliases and child inclusion in PostgreSQL', async () => {
    const exact = { createdFrom: timestamp.toISOString(), createdTo: '2026-09-01T00:00:00.001Z' }
    const aliases = await listBackgroundHistory(
      backgroundHistoryInputSchema.parse({ ...exact, search: 'Pixiv 来源核对', types: ['SCAN'], limit: 100 }),
      client
    )
    expect(aliases.items.some((item) => item.id.startsWith(prefix))).toBe(true)
    for (const search of [`${prefix} 消息`, `${prefix} 错误`]) {
      const page = await listBackgroundHistory(backgroundHistoryInputSchema.parse({ ...exact, search }), client)
      expect(page.items).toHaveLength(50)
    }
    const excluded = await listBackgroundHistory(
      backgroundHistoryInputSchema.parse({ search: `${prefix}-child` }),
      client
    )
    expect(excluded.items).toHaveLength(0)
    const included = await listBackgroundHistory(
      backgroundHistoryInputSchema.parse({
        search: prefix,
        statuses: ['FAILED'],
        triggerSources: ['SYSTEM'],
        includeBatchChildren: true
      }),
      client
    )
    expect(included.items.map((item) => item.id)).toEqual([`${prefix}-child`])
    const before = await listBackgroundHistory(
      backgroundHistoryInputSchema.parse({ search: prefix, createdTo: timestamp.toISOString() }),
      client
    )
    expect(before.items).toHaveLength(0)
    const snapshots = await getBackgroundHistorySnapshots({ ids: [`${prefix}-child`, `${prefix}-missing`] }, client)
    expect(snapshots.items.map((item) => item.id)).toEqual([`${prefix}-child`])
  })
})
