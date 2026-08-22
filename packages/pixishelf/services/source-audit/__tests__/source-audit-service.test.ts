import { describe, expect, it, vi } from 'vitest'
import {
  getSourceAudit,
  getSourceAuditAvailability,
  listSourceAuditItems,
  startSourceAudit
} from '../source-audit-service'
import { SINGLETON_MANUAL_JOB_LOCK_NAMESPACE } from '@/services/background-task/manual-job-singleton'
import { encodeSourceAuditCursor } from '../cursor'

const now = new Date('2026-08-20T12:00:00.000Z')
const readyCapability = {
  jobType: 'SCAN',
  executionLane: 'BACKGROUND_WRITER',
  definitionVersions: [1, 2]
}

describe('source audit availability', () => {
  it('requires a ready inventory and considers every fresh READY worker before rejecting SCAN v2', async () => {
    const database = availabilityDatabase({
      workers: [
        { capabilities: [{ ...readyCapability, definitionVersions: [1] }] },
        { capabilities: [readyCapability] }
      ]
    })
    const inspectRoot = vi.fn().mockResolvedValue(undefined)

    await expect(
      getSourceAuditAvailability({
        database: database as never,
        environment: enabledEnvironment(),
        now: () => now,
        getScanRoot: vi.fn().mockResolvedValue('/media/pixiv'),
        inspectRoot
      })
    ).resolves.toEqual({ available: true, reason: null, activeAudit: null })
    expect(database.workerInstance.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'READY', heartbeatAt: { gte: new Date('2026-08-20T11:58:30.000Z') } },
        take: 20
      })
    )
    expect(database.setting.findUnique).not.toHaveBeenCalled()
    expect(inspectRoot).not.toHaveBeenCalled()
  })

  it('returns the active audit reference without exposing its payload or paths', async () => {
    const database = availabilityDatabase({ active: activeAuditJob() })

    await expect(getSourceAuditAvailability({ database: database as never, environment: {} })).resolves.toEqual({
      available: false,
      reason: 'AUDIT_ACTIVE',
      activeAudit: { auditRunId: 'audit-run-1', jobId: 'audit-job-1', status: 'RUNNING' }
    })
    expect(database.setting.findUnique).not.toHaveBeenCalled()
  })
})

describe('startSourceAudit', () => {
  it('creates SCAN@v2, its pending ScanRun and queued event in one locked transaction', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ lock: '' }]),
      systemJob: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'audit-job-new', status: 'PENDING' })
      },
      scanRun: {
        create: vi.fn().mockResolvedValue({ id: 'audit-run-new' })
      },
      systemJobEvent: { create: vi.fn().mockResolvedValue({ id: 1n }) },
      pixivMetadataInventoryState: { findUnique: vi.fn().mockResolvedValue({ status: 'READY' }) },
      workerInstance: { findMany: vi.fn().mockResolvedValue([{ capabilities: [readyCapability] }]) }
    }
    const database = availabilityDatabase()
    database.systemJob.findUnique = vi.fn().mockResolvedValue(null)
    database.$transaction = vi.fn(async (operation: (tx: typeof transaction) => unknown) => operation(transaction))

    await expect(
      startSourceAudit({ requestId: 'dfcd4234-58b5-4f01-971b-5e0efa060986' }, 'admin-1', {
        database: database as never,
        environment: enabledEnvironment(),
        now: () => now,
        getScanRoot: vi.fn().mockResolvedValue('/media/pixiv'),
        inspectRoot: vi.fn().mockResolvedValue(undefined)
      })
    ).resolves.toEqual({ jobId: 'audit-job-new', auditRunId: 'audit-run-new', status: 'PENDING', reused: false })

    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1)
    const lockSql = transaction.$queryRaw.mock.calls[0]?.[0] as { values?: unknown[] }
    expect(lockSql.values).toEqual([SINGLETON_MANUAL_JOB_LOCK_NAMESPACE, 'SCAN'])
    expect(transaction.systemJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'SCAN',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: 2,
        triggerSource: 'MANUAL',
        requestedByUserId: 'admin-1',
        idempotencyKey: 'source-audit:dfcd4234-58b5-4f01-971b-5e0efa060986',
        payload: { mode: 'CONSISTENCY_AUDIT', verification: 'FAST' }
      })
    })
    expect(transaction.scanRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        systemJobId: 'audit-job-new',
        operationKind: 'CONSISTENCY_AUDIT',
        status: 'PENDING'
      })
    })
    expect(transaction.systemJobEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ jobId: 'audit-job-new', type: 'job.queued' })
    })
  })

  it('replays a completed request by idempotency key before requiring a live worker', async () => {
    const database = availabilityDatabase()
    database.systemJob.findUnique = vi.fn().mockResolvedValue({
      ...activeAuditJob(),
      status: 'COMPLETED',
      requestedByUserId: 'admin-1'
    })

    await expect(
      startSourceAudit({ requestId: 'dfcd4234-58b5-4f01-971b-5e0efa060986' }, 'admin-1', {
        database: database as never,
        environment: {}
      })
    ).resolves.toEqual({ jobId: 'audit-job-1', auditRunId: 'audit-run-1', status: 'COMPLETED', reused: true })
    expect(database.systemJob.findFirst).not.toHaveBeenCalled()
  })

  it('does not report durable reuse for a different request id while an audit is active', async () => {
    const database = availabilityDatabase({ active: activeAuditJob() })
    database.systemJob.findUnique = vi.fn().mockResolvedValue(null)

    await expect(
      startSourceAudit({ requestId: 'e3449d35-9c03-49e0-83fa-9f83bdd448c9' }, 'admin-1', {
        database: database as never,
        environment: enabledEnvironment()
      })
    ).rejects.toMatchObject({ code: 'CONFLICT', message: 'A source audit is already active' })
    expect(database.$transaction).not.toHaveBeenCalled()
  })

  it('bounds the start-only scan-root probe and never opens a transaction after timeout', async () => {
    const database = availabilityDatabase()
    database.systemJob.findUnique = vi.fn().mockResolvedValue(null)

    await expect(
      startSourceAudit({ requestId: 'dfcd4234-58b5-4f01-971b-5e0efa060986' }, 'admin-1', {
        database: database as never,
        environment: enabledEnvironment(),
        getScanRoot: vi.fn().mockResolvedValue('/media/pixiv'),
        inspectRoot: vi.fn(() => new Promise<void>(() => undefined)),
        rootProbeTimeoutMs: 1
      })
    ).rejects.toMatchObject({ code: 'BLOCKED', message: 'Scan root is not safely accessible' })
    expect(database.$transaction).not.toHaveBeenCalled()
  })

  it('rechecks inventory and worker readiness after taking the shared SCAN lock', async () => {
    const transaction = {
      $queryRaw: vi.fn().mockResolvedValue([{ lock: '' }]),
      systemJob: {
        findUnique: vi.fn().mockResolvedValue(null),
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn()
      },
      pixivMetadataInventoryState: { findUnique: vi.fn().mockResolvedValue({ status: 'INITIALIZING' }) },
      workerInstance: { findMany: vi.fn().mockResolvedValue([{ capabilities: [readyCapability] }]) }
    }
    const database = availabilityDatabase()
    database.systemJob.findUnique = vi.fn().mockResolvedValue(null)
    database.$transaction = vi.fn(async (operation: (tx: typeof transaction) => unknown) => operation(transaction))

    await expect(
      startSourceAudit({ requestId: 'dfcd4234-58b5-4f01-971b-5e0efa060986' }, 'admin-1', {
        database: database as never,
        environment: enabledEnvironment(),
        now: () => now,
        getScanRoot: vi.fn().mockResolvedValue('/media/pixiv'),
        inspectRoot: vi.fn().mockResolvedValue(undefined)
      })
    ).rejects.toMatchObject({ code: 'BLOCKED', message: 'Pixiv metadata inventory is not ready' })
    expect(transaction.$queryRaw).toHaveBeenCalledTimes(1)
    expect(transaction.systemJob.create).not.toHaveBeenCalled()
  })
})

describe('source audit reads', () => {
  it('returns only safe summary fields and derives an empty-source action from structured event data', async () => {
    const database = {
      scanRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'audit-run-1',
          systemJobId: 'audit-job-1',
          status: 'PAUSED',
          startedAt: now,
          finishedAt: now,
          auditNewInputs: 2,
          auditChangedInputs: 3,
          missingInputs: 4,
          auditInvalidInputs: 5,
          auditIdentityConflictInputs: 6,
          inventoryUnchanged: 7,
          walkedEntries: 100,
          metadataCandidates: 27,
          contentHashed: 8,
          contentChanged: 9,
          discoveryDurationMs: 10,
          hashDurationMs: 11,
          errorMessage: '/secret/source/path',
          systemJob: {
            id: 'audit-job-1',
            status: 'PAUSED',
            errorCode: null,
            startedAt: now,
            finishedAt: now,
            error: 'Prisma /secret/path',
            events: [
              { data: { reason: 'ACTION_REQUIRED', data: { decisionCode: 'EMPTY_CONSISTENCY_AUDIT', raw: '/secret' } } }
            ]
          }
        })
      }
    }

    const result = await getSourceAudit({ auditRunId: 'audit-run-1' }, { database: database as never })
    expect(result).toMatchObject({
      id: 'audit-run-1',
      status: 'PAUSED',
      actionRequiredReason: 'EMPTY_SOURCE',
      counts: { new: 2, changed: 3, missing: 4, invalid: 5, identityConflict: 6, unchanged: 7 }
    })
    expect(JSON.stringify(result)).not.toContain('/secret')
  })

  it('ignores an old action-required pause after the audit resumes and completes', async () => {
    const database = {
      scanRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'audit-run-1',
          systemJobId: 'audit-job-1',
          status: 'COMPLETED',
          startedAt: now,
          finishedAt: now,
          auditNewInputs: 0,
          auditChangedInputs: 0,
          missingInputs: 0,
          auditInvalidInputs: 0,
          auditIdentityConflictInputs: 0,
          inventoryUnchanged: 1,
          walkedEntries: 1,
          metadataCandidates: 1,
          contentHashed: 0,
          contentChanged: 0,
          discoveryDurationMs: 1,
          hashDurationMs: 0,
          systemJob: {
            id: 'audit-job-1',
            status: 'COMPLETED',
            errorCode: 'PRECONDITION_FAILED',
            startedAt: now,
            finishedAt: now,
            events: [{ data: { reason: 'ACTION_REQUIRED', data: { decisionCode: 'EMPTY_CONSISTENCY_AUDIT' } } }]
          }
        })
      }
    }

    await expect(getSourceAudit({ auditRunId: 'audit-run-1' }, { database: database as never })).resolves.toMatchObject(
      {
        completed: true,
        actionRequiredReason: null
      }
    )
  })

  it('pages the five visible classifications and replaces unknown issue text with a fixed summary', async () => {
    const database = {
      scanRun: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'audit-run-1', status: 'COMPLETED', systemJob: { status: 'COMPLETED' } })
      },
      pixivSourceAuditItem: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'item-1',
            ordinal: 1,
            differenceKind: 'INVALID',
            relativePath: '123-meta.json',
            expectedExternalId: '123',
            observedExternalId: null,
            title: null,
            artistName: null,
            artworkId: 42,
            issueCode: '/secret/raw-code'
          }
        ])
      },
      scanRunItem: { findMany: vi.fn().mockResolvedValue([]) },
      artwork: { findMany: vi.fn().mockResolvedValue([{ id: 42, title: 'Existing artwork' }]) }
    }

    const page = await listSourceAuditItems({ auditRunId: 'audit-run-1', limit: 10 }, { database: database as never })
    expect(page.items).toEqual([
      {
        id: 'item-1',
        classification: 'INVALID',
        externalId: '123',
        title: 'Existing artwork',
        artistName: null,
        metadataRelativePath: '123-meta.json',
        artwork: { id: 42, title: 'Existing artwork' },
        expectedExternalId: '123',
        observedExternalId: null,
        reasonCode: 'SOURCE_DIFFERENCE',
        reasonSummary: '该来源差异需要人工检查。',
        eligibleAction: null,
        apply: { state: 'NOT_APPLICABLE', action: null },
        latestApplyResult: null
      }
    ])
    expect(database.pixivSourceAuditItem.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ differenceKind: { in: expect.not.arrayContaining(['UNCHANGED']) } })
      })
    )
    expect(JSON.stringify(page)).not.toContain('/secret')
  })

  it('derives list eligibility from the complete apply history, not only the latest attempt', async () => {
    const sourceItem = (id: string, ordinal: number) => ({
      id,
      ordinal,
      differenceKind: 'NEW',
      relativePath: `${ordinal}-meta.json`,
      expectedExternalId: String(ordinal),
      observedExternalId: String(ordinal),
      title: `Artwork ${ordinal}`,
      artistName: 'Artist',
      artworkId: null,
      issueCode: null
    })
    const history = (
      sourceAuditItemId: string,
      operationId: string,
      applyOutcome: string,
      applyReasonCode: string | null,
      applyRetryable: boolean
    ) => ({
      sourceAuditItemId,
      auditDifferenceKind: 'NEW',
      applyOutcome,
      resultArtworkId: null,
      applyReasonCode,
      applyRetryable,
      finishedAt: now,
      scanRun: { id: operationId, systemJob: { status: 'COMPLETED' } }
    })
    const database = {
      scanRun: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'audit-run-1', status: 'COMPLETED', systemJob: { status: 'COMPLETED' } })
      },
      pixivSourceAuditItem: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            sourceItem('item-already-applied', 1),
            sourceItem('item-retryable', 2),
            sourceItem('item-stale', 3)
          ])
      },
      scanRunItem: {
        findMany: vi
          .fn()
          .mockResolvedValue([
            history('item-already-applied', 'apply-latest', 'FAILED', 'OPERATION_FAILED', true),
            history('item-already-applied', 'apply-success', 'APPLIED', null, false),
            history('item-retryable', 'apply-retryable', 'FAILED', 'OPERATION_FAILED', true),
            history('item-stale', 'apply-stale', 'SKIPPED', 'STALE_SOURCE_INPUT', false)
          ])
      },
      artwork: { findMany: vi.fn().mockResolvedValue([]) }
    }

    const page = await listSourceAuditItems({ auditRunId: 'audit-run-1', limit: 10 }, { database: database as never })

    expect(page.items.map((item) => [item.id, item.apply.state])).toEqual([
      ['item-already-applied', 'ALREADY_APPLIED'],
      ['item-retryable', 'ELIGIBLE'],
      ['item-stale', 'REQUIRES_NEW_AUDIT']
    ])
    expect(page.items[0]?.latestApplyResult).toMatchObject({ operationId: 'apply-latest', result: 'FAILED' })
  })

  it('does not expose partial findings before both the run and its job are complete', async () => {
    const database = {
      scanRun: {
        findFirst: vi.fn().mockResolvedValue({ id: 'audit-run-1', status: 'RUNNING', systemJob: { status: 'RUNNING' } })
      },
      pixivSourceAuditItem: { findMany: vi.fn() },
      artwork: { findMany: vi.fn() }
    }

    await expect(
      listSourceAuditItems({ auditRunId: 'audit-run-1' }, { database: database as never })
    ).rejects.toMatchObject({ code: 'BLOCKED' })
    expect(database.pixivSourceAuditItem.findMany).not.toHaveBeenCalled()
  })

  it.each([
    ['COMPLETED', 'RUNNING'],
    ['RUNNING', 'COMPLETED']
  ] as const)('blocks results when run=%s and job=%s do not both reach completion', async (runStatus, jobStatus) => {
    const database = {
      scanRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'audit-run-1',
          status: runStatus,
          systemJob: { status: jobStatus }
        })
      },
      pixivSourceAuditItem: { findMany: vi.fn() },
      artwork: { findMany: vi.fn() }
    }

    await expect(
      listSourceAuditItems({ auditRunId: 'audit-run-1' }, { database: database as never })
    ).rejects.toMatchObject({ code: 'BLOCKED' })
  })

  it('rejects a cursor reused across runs or classification filters', async () => {
    const database = {
      scanRun: {
        findFirst: vi
          .fn()
          .mockResolvedValue({ id: 'audit-run-b', status: 'COMPLETED', systemJob: { status: 'COMPLETED' } })
      },
      pixivSourceAuditItem: { findMany: vi.fn() },
      artwork: { findMany: vi.fn() }
    }
    const runACursor = encodeSourceAuditCursor({
      version: 1,
      auditRunId: 'audit-run-a',
      classification: null,
      ordinal: 10,
      id: 'item-10'
    })
    const changedCursor = encodeSourceAuditCursor({
      version: 1,
      auditRunId: 'audit-run-b',
      classification: 'CHANGED',
      ordinal: 10,
      id: 'item-10'
    })

    await expect(
      listSourceAuditItems({ auditRunId: 'audit-run-b', cursor: runACursor }, { database: database as never })
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' })
    await expect(
      listSourceAuditItems({ auditRunId: 'audit-run-b', cursor: changedCursor }, { database: database as never })
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' })
    await expect(
      listSourceAuditItems(
        { auditRunId: 'audit-run-b', classification: 'NEW', cursor: changedCursor },
        { database: database as never }
      )
    ).rejects.toMatchObject({ code: 'INVALID_CURSOR' })
    expect(database.pixivSourceAuditItem.findMany).not.toHaveBeenCalled()
  })
})

function enabledEnvironment() {
  return {
    CENTRAL_DISPATCHER_CUTOVER_ENABLED: 'true',
    WORKER_DISPATCH_ENABLED: 'true'
  }
}

function activeAuditJob() {
  return {
    id: 'audit-job-1',
    type: 'SCAN',
    definitionVersion: 2,
    status: 'RUNNING',
    payload: { mode: 'CONSISTENCY_AUDIT', verification: 'FAST' },
    scanRun: { id: 'audit-run-1', operationKind: 'CONSISTENCY_AUDIT' }
  }
}

function availabilityDatabase(
  input: {
    active?: ReturnType<typeof activeAuditJob> | null
    workers?: Array<{ capabilities: unknown }>
  } = {}
) {
  return {
    systemJob: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(input.active ?? null)
    },
    setting: { findUnique: vi.fn().mockResolvedValue({ value: '/media/pixiv' }) },
    pixivMetadataInventoryState: { findUnique: vi.fn().mockResolvedValue({ status: 'READY' }) },
    workerInstance: { findMany: vi.fn().mockResolvedValue(input.workers ?? [{ capabilities: [readyCapability] }]) },
    $transaction: vi.fn()
  }
}
