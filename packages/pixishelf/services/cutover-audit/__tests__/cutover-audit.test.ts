import { JobStatus, VideoKeyframeSetStatus } from '@prisma/client'
import { describe, expect, it, vi } from 'vitest'
import {
  createPrismaCutoverAuditReader,
  getCutoverAuditExitCode,
  parseCutoverAuditArguments,
  runCutoverAudit,
  serializeCutoverAuditReport,
  type CutoverAuditPrismaClient,
  type CutoverAuditReader,
  type RawCutoverAuditCheck
} from '../cutover-audit'

function createReader(checks: readonly RawCutoverAuditCheck[]): CutoverAuditReader {
  return { readChecks: vi.fn().mockResolvedValue(checks) }
}

function createCheck(overrides: Partial<RawCutoverAuditCheck> = {}): RawCutoverAuditCheck {
  return {
    key: 'system-job-status',
    model: 'SystemJob',
    field: 'status',
    blockingValues: ['RUNNING'],
    count: 0,
    samples: [],
    ...overrides
  }
}

function createReadDelegate() {
  return {
    count: vi.fn().mockResolvedValue(0),
    findMany: vi.fn().mockResolvedValue([])
  }
}

function createPrismaMock() {
  const transaction = {
    systemJob: createReadDelegate(),
    archiveImport: createReadDelegate(),
    archiveImportItem: createReadDelegate(),
    scanRun: createReadDelegate(),
    pendingReplaceBatch: createReadDelegate(),
    pendingReplaceItem: createReadDelegate(),
    mediaVideoMetadata: createReadDelegate(),
    mediaChapterPreview: createReadDelegate(),
    mediaVideoKeyframe: createReadDelegate(),
    mediaVideoKeyframeSet: createReadDelegate(),
    artwork: createReadDelegate()
  }
  const client = {
    $transaction: vi.fn(async (callback: (transactionClient: typeof transaction) => Promise<unknown>) =>
      callback(transaction)
    )
  }

  return { client, transaction }
}

describe('runCutoverAudit', () => {
  it('passes a fully green audit and uses the default sample limit', async () => {
    const checks = Array.from({ length: 12 }, (_, index) =>
      createCheck({ key: `check-${index}`, model: `Model${index}` })
    )
    const reader = createReader(checks)

    const report = await runCutoverAudit(reader, { now: () => new Date('2026-08-14T00:00:00.000Z') })

    expect(reader.readChecks).toHaveBeenCalledWith(20)
    expect(report).toMatchObject({
      schemaVersion: 1,
      generatedAt: '2026-08-14T00:00:00.000Z',
      passed: true,
      totalBlockers: 0
    })
    expect(report.checks).toHaveLength(12)
    expect(getCutoverAuditExitCode(report)).toBe(0)
  })

  it('sums blockers across checks and returns the deployment-blocking exit code', async () => {
    const report = await runCutoverAudit(
      createReader([
        createCheck({ count: 2, samples: [{ id: 'job-1' }] }),
        createCheck({ key: 'scan-run-status', model: 'ScanRun', count: 3, samples: [{ id: 'scan-1' }] })
      ])
    )

    expect(report.passed).toBe(false)
    expect(report.totalBlockers).toBe(5)
    expect(getCutoverAuditExitCode(report)).toBe(2)
  })

  it('enforces the sample limit and normalizes Date and BigInt values before JSON serialization', async () => {
    const circular: { self?: unknown } = {}
    circular.self = circular
    const reader = createReader([
      createCheck({
        count: 3,
        samples: [
          {
            id: 'one',
            bytes: BigInt('9007199254740993'),
            updatedAt: new Date('2026-08-14T01:02:03.000Z'),
            invalidAt: new Date(Number.NaN),
            circular
          },
          { id: 'two' },
          { id: 'three' }
        ]
      })
    ])

    const report = await runCutoverAudit(reader, { sampleLimit: 2 })
    const parsed = JSON.parse(serializeCutoverAuditReport(report))

    expect(reader.readChecks).toHaveBeenCalledWith(2)
    expect(report.checks[0]?.samples).toHaveLength(2)
    expect(parsed.checks[0].samples[0]).toEqual({
      id: 'one',
      bytes: '9007199254740993',
      updatedAt: '2026-08-14T01:02:03.000Z',
      invalidAt: 'Invalid Date',
      circular: { self: '[Circular]' }
    })
  })
})

describe('cutover audit arguments', () => {
  it('supports the default and an explicit sample limit', () => {
    expect(parseCutoverAuditArguments([])).toEqual({ sampleLimit: 20 })
    expect(parseCutoverAuditArguments(['--sample-limit', '100'])).toEqual({ sampleLimit: 100 })
  })

  it.each([
    ['--unknown'],
    ['--sample-limit'],
    ['--sample-limit', '0'],
    ['--sample-limit', '101'],
    ['--sample-limit', '1.5'],
    ['--sample-limit', 'not-a-number'],
    ['--sample-limit', '10', '--sample-limit', '20']
  ])('rejects invalid arguments: %j', (...args) => {
    expect(() => parseCutoverAuditArguments(args)).toThrow()
  })
})

describe('createPrismaCutoverAuditReader', () => {
  it('runs the fixed read contract in one RepeatableRead transaction snapshot', async () => {
    const { client, transaction } = createPrismaMock()
    const reader = createPrismaCutoverAuditReader(client as unknown as CutoverAuditPrismaClient)

    const checks = await reader.readChecks(7)

    const contracts = [
      {
        key: 'system-job-status',
        delegate: 'systemJob',
        blockingValues: ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'CANCELLING'],
        where: { status: { in: ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'CANCELLING'] } }
      },
      {
        key: 'archive-import-status',
        delegate: 'archiveImport',
        blockingValues: ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'],
        where: { status: { in: ['PENDING', 'RUNNING', 'PAUSED', 'CANCELLING'] } }
      },
      {
        key: 'archive-import-item-status',
        delegate: 'archiveImportItem',
        blockingValues: ['DOWNLOADING'],
        where: { status: 'DOWNLOADING' }
      },
      {
        key: 'scan-run-status',
        delegate: 'scanRun',
        blockingValues: ['RUNNING'],
        where: { status: 'RUNNING' }
      },
      {
        key: 'pending-replace-batch-status',
        delegate: 'pendingReplaceBatch',
        blockingValues: ['RUNNING', 'CANCELLING'],
        where: { status: { in: ['RUNNING', 'CANCELLING'] } }
      },
      {
        key: 'pending-replace-item-status',
        delegate: 'pendingReplaceItem',
        blockingValues: [
          'STAGING',
          'BACKING_UP',
          'SWAPPING',
          'COMMITTING',
          'ROLLING_BACK',
          'RESTORING',
          'RESTORE_SWAPPING'
        ],
        where: {
          status: {
            in: ['STAGING', 'BACKING_UP', 'SWAPPING', 'COMMITTING', 'ROLLING_BACK', 'RESTORING', 'RESTORE_SWAPPING']
          }
        }
      },
      {
        key: 'media-video-probe-status',
        delegate: 'mediaVideoMetadata',
        blockingValues: ['PROBING'],
        where: { probeStatus: 'PROBING' }
      },
      {
        key: 'media-video-poster-status',
        delegate: 'mediaVideoMetadata',
        blockingValues: ['GENERATING'],
        where: { posterStatus: 'GENERATING' }
      },
      {
        key: 'media-chapter-preview-status',
        delegate: 'mediaChapterPreview',
        blockingValues: ['GENERATING'],
        where: { status: 'GENERATING' }
      },
      {
        key: 'media-video-keyframe-status',
        delegate: 'mediaVideoKeyframe',
        blockingValues: ['GENERATING'],
        where: { status: 'GENERATING' }
      },
      {
        key: 'media-video-keyframe-set-staging',
        delegate: 'mediaVideoKeyframeSet',
        blockingValues: ['STAGING_WITHOUT_TERMINAL_SYSTEM_JOB'],
        where: {
          status: 'STAGING',
          OR: [
            { systemJobId: null },
            {
              systemJob: {
                is: { status: { notIn: ['COMPLETED', 'FAILED', 'CANCELLED'] } }
              }
            }
          ]
        }
      },
      {
        key: 'artwork-archive-lifecycle-state',
        delegate: 'artwork',
        blockingValues: ['TRASHING', 'RESTORING'],
        where: { archiveLifecycleState: { in: ['TRASHING', 'RESTORING'] } }
      }
    ] as const

    expect(checks).toHaveLength(12)
    expect(client.$transaction).toHaveBeenCalledTimes(1)
    expect(client.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead'
    })
    expect(checks.map(({ key, blockingValues }) => ({ key, blockingValues }))).toEqual(
      contracts.map(({ key, blockingValues }) => ({ key, blockingValues }))
    )
    for (const contract of contracts) {
      const delegate = transaction[contract.delegate]
      expect(delegate.count).toHaveBeenCalledWith({ where: contract.where })
      expect(delegate.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: contract.where }))
    }
    for (const delegate of Object.values(transaction)) {
      expect(delegate.count).toHaveBeenCalled()
      expect(delegate.findMany).toHaveBeenCalled()
      for (const call of delegate.findMany.mock.calls) {
        expect(call[0]).toEqual(expect.objectContaining({ orderBy: expect.any(Object), take: 7 }))
      }
    }
  })

  it('allows STAGING sets with terminal jobs and blocks missing or non-terminal jobs in the database filter', async () => {
    const { client, transaction } = createPrismaMock()
    transaction.mediaVideoKeyframeSet.count.mockResolvedValue(2)
    transaction.mediaVideoKeyframeSet.findMany.mockResolvedValue([
      { id: 'set-without-job', systemJobId: null, status: VideoKeyframeSetStatus.STAGING },
      {
        id: 'set-with-running-job',
        systemJobId: 'job-running',
        status: VideoKeyframeSetStatus.STAGING,
        systemJob: { status: JobStatus.RUNNING }
      }
    ])
    const reader = createPrismaCutoverAuditReader(client as unknown as CutoverAuditPrismaClient)

    const checks = await reader.readChecks(20)
    const stagingCheck = checks.find((check) => check.key === 'media-video-keyframe-set-staging')
    const expectedWhere = {
      status: VideoKeyframeSetStatus.STAGING,
      OR: [
        { systemJobId: null },
        {
          systemJob: {
            is: {
              status: { notIn: [JobStatus.COMPLETED, JobStatus.FAILED, JobStatus.CANCELLED] }
            }
          }
        }
      ]
    }

    expect(transaction.mediaVideoKeyframeSet.count).toHaveBeenCalledWith({ where: expectedWhere })
    expect(transaction.mediaVideoKeyframeSet.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expectedWhere })
    )
    expect(stagingCheck).toMatchObject({ count: 2 })
    expect(stagingCheck?.samples).toHaveLength(2)
  })
})
