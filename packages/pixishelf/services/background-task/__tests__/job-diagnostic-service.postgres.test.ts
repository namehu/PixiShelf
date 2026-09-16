// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { createDatabaseClient, disconnectDatabase } from '@pixishelf/db'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  backgroundDiagnosticItemsInputSchema,
  backgroundDiagnosticReportsInputSchema,
  listBackgroundDiagnosticItems,
  listBackgroundDiagnosticReports
} from '../job-diagnostic-service'

const databaseUrl = Reflect.get(process.env, 'PIXISHELF_TEST_DATABASE_URL') as string | undefined
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const client = createDatabaseClient(databaseUrl ? { datasourceUrl: databaseUrl } : undefined)
const prefix = `diagnostic-service-${randomUUID()}`
const timestamp = new Date('2026-09-16T00:00:00.000Z')

async function createJob(suffix: string, type = 'SCAN') {
  return client.systemJob.create({
    data: {
      id: `${prefix}-${suffix}`,
      type,
      status: 'FAILED',
      triggerSource: 'MANUAL',
      attempt: 1,
      errorCode: 'PRECONDITION_FAILED',
      error: '部分项目失败',
      createdAt: timestamp,
      finishedAt: timestamp
    }
  })
}

async function createReport(suffix: string, count: number, inheritedCount = 0) {
  const job = await createJob(suffix)
  const id = randomUUID()
  await client.systemJobDiagnosticReport.create({
    data: {
      id,
      jobId: job.id,
      attempt: 1,
      status: 'CLOSED',
      outcome: 'FAILED',
      entryCount: count + 1,
      itemCount: count,
      currentCount: count - inheritedCount,
      inheritedCount,
      taskFailure: true,
      complete: true,
      createdAt: timestamp,
      closedAt: timestamp,
      expiresAt: new Date(timestamp.getTime() + 90 * 86_400_000)
    }
  })
  await client.systemJob.update({ where: { id: job.id }, data: { currentDiagnosticExecutionId: id } })
  await client.systemJobDiagnosticItem.createMany({
    data: Array.from({ length: count }, (_, index) => ({
      reportId: id,
      key: `item:${index}`,
      scope: 'ITEM',
      origin: index < count - inheritedCount ? 'CURRENT' : 'INHERITED',
      targetType: 'ARTWORK',
      targetId: String(index + 1),
      targetLabel: `项目 ${index + 1}`,
      stage: 'MEDIA_STREAM',
      code: 'REMOTE_RESPONSE_INVALID',
      reasonKey: index < 10 ? 'errno:ECONNRESET' : 'http:503',
      message: index < 10 ? '连接被重置' : '远端服务返回 HTTP 503。',
      suggestion: '检查来源服务后重试。',
      evidence: index < 10 ? [{ code: 'ECONNRESET' }] : [{ httpStatus: 503 }],
      remoteHost: 'example.com:443',
      httpStatus: index < 10 ? null : 503,
      itemAttempt: 2,
      createdAt: timestamp
    }))
  })
  await client.systemJobDiagnosticItem.create({
    data: {
      reportId: id,
      key: 'task',
      scope: 'TASK',
      origin: 'CURRENT',
      code: 'PRECONDITION_FAILED',
      reasonKey: 'code:PRECONDITION_FAILED',
      message: '部分项目失败',
      suggestion: '查看逐项失败原因。',
      evidence: [],
      createdAt: timestamp
    }
  })
  return { jobId: job.id, reportId: id }
}

function listItems(input: Parameters<typeof backgroundDiagnosticItemsInputSchema.parse>[0]) {
  return listBackgroundDiagnosticItems(backgroundDiagnosticItemsInputSchema.parse(input), client)
}

describePostgres('background diagnostic service PostgreSQL acceptance', () => {
  beforeAll(async () => {
    await client.$connect()
  })

  afterAll(async () => {
    try {
      // Only this suite's unique job prefix is removed; report/item and archive fixture cascades are bounded.
      await client.systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
    } finally {
      await disconnectDatabase(client)
    }
  })

  it('returns thirteen persisted failures, separate task evidence, and exact reason groups', async () => {
    const fixture = await createReport('thirteen', 13, 3)
    const reports = await listBackgroundDiagnosticReports(
      backgroundDiagnosticReportsInputSchema.parse({ jobId: fixture.jobId }),
      client
    )
    expect(reports.items).toHaveLength(1)
    expect(reports.items[0]).toMatchObject({
      id: fixture.reportId,
      itemCount: 13,
      currentCount: 10,
      inheritedCount: 3,
      source: 'SNAPSHOT',
      complete: true,
      expired: false
    })
    const result = await listItems(fixture)
    expect(result.items).toHaveLength(13)
    expect(result.taskError).toMatchObject({ code: 'PRECONDITION_FAILED', message: '部分项目失败' })
    expect(result.groups.sort((a, b) => a.reasonKey.localeCompare(b.reasonKey))).toEqual([
      { reasonKey: 'errno:ECONNRESET', count: 10 },
      { reasonKey: 'http:503', count: 3 }
    ])
    expect(result.items[0]).toMatchObject({ href: '/artworks/1', evidence: [{ code: 'ECONNRESET' }] })
    expect(result.nextCursor).toBeNull()
    const filtered = await listItems({ ...fixture, reason: 'http:503' })
    expect(filtered.items).toHaveLength(3)
    expect(filtered.items.every((item) => item.httpStatus === 503 && item.origin === 'INHERITED')).toBe(true)
    expect(filtered.summary.itemCount).toBe(13)
  })

  it('traverses fifty-one persisted items without duplicates using a value cursor', async () => {
    const fixture = await createReport('pagination', 51)
    const first = await listItems({ ...fixture, limit: 50 })
    expect(first.items).toHaveLength(50)
    expect(first.nextCursor).toBe(first.items.at(-1)!.id)
    const second = await listItems({ ...fixture, limit: 50, cursor: first.nextCursor })
    expect(second.items).toHaveLength(1)
    expect(second.nextCursor).toBeNull()
    expect(new Set([...first.items, ...second.items].map((item) => item.id)).size).toBe(51)
    expect(second.items[0]?.targetLabel).toBe('项目 51')
  })

  it('rejects a real report belonging to a different job', async () => {
    const fixture = await createReport('owned', 1)
    const other = await createJob('other')
    await expect(listItems({ jobId: other.id, reportId: fixture.reportId })).rejects.toMatchObject({
      code: 'NOT_FOUND'
    })
  })

  it('keeps expired counts without reading evidence and rejects legacy bypass', async () => {
    const fixture = await createReport('expired', 13)
    await client.systemJobDiagnosticReport.update({ where: { id: fixture.reportId }, data: { expiredAt: timestamp } })
    // Leave evidence present deliberately: header expiry must prevent reads, independent of deletion timing.
    let evidenceQueries = 0
    const observed = client.$extends({
      query: {
        systemJobDiagnosticItem: {
          $allOperations({ args, query }) {
            evidenceQueries += 1
            return query(args)
          }
        }
      }
    })
    // This query-only observer leaves the delegate inputs and return types unchanged.
    const observedClient = observed as unknown as typeof client
    const result = await listBackgroundDiagnosticItems(
      backgroundDiagnosticItemsInputSchema.parse(fixture),
      observedClient
    )
    expect(result.summary).toMatchObject({ expired: true, itemCount: 13, currentCount: 13 })
    expect(result.items).toEqual([])
    expect(result.groups).toEqual([])
    expect(result.taskError).toBeNull()
    expect(evidenceQueries).toBe(0)
    await expect(
      listBackgroundDiagnosticItems(
        backgroundDiagnosticItemsInputSchema.parse({ jobId: fixture.jobId, reportId: 'legacy' }),
        observedClient
      )
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(evidenceQueries).toBe(0)
  })

  it('reads legacy failures only while the archive remains bound to that job', async () => {
    const oldJob = await createJob('legacy-old', 'ARCHIVE_IMPORT')
    const newJob = await createJob('legacy-new', 'ARCHIVE_IMPORT')
    const archive = await client.archiveImport.create({
      data: {
        systemJobId: oldJob.id,
        providerKey: 'pixiv',
        externalId: `${prefix}-legacy`,
        submittedUrl: 'https://example.com/fixture',
        canonicalUrl: 'https://example.com/fixture',
        locator: {},
        normalizedMetadata: {},
        rawMetadata: {},
        metadataHash: prefix,
        creatorBucket: prefix,
        stagingPath: `diagnostic-test/${prefix}`,
        status: 'FAILED',
        totalItems: 1,
        failedItems: 1,
        items: {
          create: {
            pageIndex: 0,
            sourcePageUrl: 'https://example.com/fixture',
            locator: {},
            expectedFilename: '001.jpg',
            status: 'FAILED',
            errorCode: null,
            errorMessage: '旧失败'
          }
        }
      }
    })
    const current = await listItems({ jobId: oldJob.id, reportId: 'legacy', reason: 'code:UNKNOWN_ERROR' })
    expect(current.summary.source).toBe('LEGACY_CHECKPOINT')
    expect(current.items).toHaveLength(1)
    expect(current.items[0]?.targetLabel).toContain('001.jpg')
    await client.archiveImport.update({ where: { id: archive.id }, data: { systemJobId: newJob.id } })
    const historical = await listItems({ jobId: oldJob.id, reportId: 'legacy' })
    expect(historical.summary.source).toBe('SUMMARY_ONLY')
    expect(historical.items).toEqual([])
    const rebound = await listItems({ jobId: newJob.id, reportId: 'legacy' })
    expect(rebound.summary.source).toBe('LEGACY_CHECKPOINT')
    expect(rebound.items).toHaveLength(1)
  })
})
