import { describe, expect, it, vi } from 'vitest'
import { getSourceAuditApplyOperation, startSourceAuditApply } from '../source-audit-apply-service'
import { SINGLETON_MANUAL_JOB_LOCK_NAMESPACE } from '@/services/background-task/manual-job-singleton'

const now = new Date('2026-08-20T12:00:00.000Z')
const request = {
  auditRunId: 'audit-run-1',
  itemIds: ['audit-item-new', 'audit-item-changed'],
  idempotencyKey: 'dfcd4234-58b5-4f01-971b-5e0efa060986'
}
const v3Capability = {
  jobType: 'SCAN',
  executionLane: 'BACKGROUND_WRITER',
  definitionVersions: [1, 2, 3]
}

describe('source audit apply producer', () => {
  it('freezes eligible evidence and creates SCAN@v3, run, items and event atomically under the SCAN lock', async () => {
    const transaction = transactionHarness()
    const database = outerDatabase(transaction)

    await expect(startSourceAuditApply(request, 'admin-1', options(database))).resolves.toEqual({
      outcome: 'ACCEPTED',
      operationId: 'apply-run-1',
      jobId: 'apply-job-1',
      status: 'PENDING',
      reused: false
    })

    const lockSql = transaction.$queryRaw.mock.calls[0]?.[0] as { values?: unknown[] }
    expect(lockSql.values).toEqual([SINGLETON_MANUAL_JOB_LOCK_NAMESPACE, 'SCAN'])
    expect(transaction.systemJob.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: 'SCAN',
        definitionVersion: 3,
        requestedByUserId: 'admin-1',
        idempotencyKey: `source-audit-apply:${request.idempotencyKey}`,
        payload: expect.objectContaining({
          mode: 'AUDIT_APPLY',
          auditRunId: 'audit-run-1',
          inputCount: 2,
          inputDigest: expect.stringMatching(/^[a-f0-9]{64}$/)
        })
      })
    })
    expect(transaction.scanRun.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        operationKind: 'AUDIT_APPLY',
        sourceAuditRunId: 'audit-run-1',
        status: 'PENDING',
        inputCount: 2,
        auditNewInputs: 1,
        auditChangedInputs: 1
      })
    })
    expect(transaction.scanRunMetadataInput.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          ordinal: 0,
          sourceAuditItemId: 'audit-item-new',
          contentHash: 'a'.repeat(64),
          observedExternalId: '101',
          expectedProcessedContentHash: null
        }),
        expect.objectContaining({
          ordinal: 1,
          sourceAuditItemId: 'audit-item-changed',
          contentHash: 'b'.repeat(64),
          expectedExternalRefId: 'ref-202',
          expectedArtworkId: 202,
          expectedProcessedContentHash: 'c'.repeat(64)
        })
      ]
    })
    expect(transaction.scanRunItem.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({ sourceAuditItemId: 'audit-item-new', status: 'PENDING', action: 'CREATE' }),
        expect.objectContaining({ sourceAuditItemId: 'audit-item-changed', status: 'PENDING', action: 'UPDATE' })
      ]
    })
    expect(transaction.systemJobEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ jobId: 'apply-job-1', type: 'job.queued' })
    })
  })

  it('rejects a fresh v2-only Worker and creates no apply job', async () => {
    const transaction = transactionHarness()
    transaction.workerInstance.findMany.mockResolvedValue([
      { capabilities: [{ ...v3Capability, definitionVersions: [1, 2] }] }
    ])
    const database = outerDatabase(transaction)

    await expect(startSourceAuditApply(request, 'admin-1', options(database))).resolves.toEqual({
      outcome: 'BLOCKED',
      reason: 'WORKER_NOT_READY',
      activeOperationId: null
    })
    expect(transaction.systemJob.create).not.toHaveBeenCalled()
  })

  it('replays an active v3 request before preconditions and rejects changed semantics for the same key', async () => {
    const existing = { ...existingApplyJob(), status: 'RUNNING' }
    const database = outerDatabase(transactionHarness())
    database.systemJob.findUnique.mockResolvedValue(existing)
    const unavailableOptions = {
      ...options(database),
      environment: { CENTRAL_DISPATCHER_CUTOVER_ENABLED: 'false', WORKER_DISPATCH_ENABLED: 'false' },
      getScanRoot: vi.fn().mockResolvedValue(null),
      inspectRoot: vi.fn().mockRejectedValue(new Error('unavailable'))
    }

    await expect(startSourceAuditApply(request, 'admin-1', unavailableOptions)).resolves.toMatchObject({
      outcome: 'ACCEPTED',
      operationId: 'apply-run-existing',
      reused: true
    })
    await expect(
      startSourceAuditApply({ ...request, itemIds: ['audit-item-new'] }, 'admin-1', unavailableOptions)
    ).resolves.toEqual({ outcome: 'BLOCKED', reason: 'IDEMPOTENCY_CONFLICT', activeOperationId: null })
    expect(database.$transaction).not.toHaveBeenCalled()
    expect(unavailableOptions.getScanRoot).not.toHaveBeenCalled()
  })

  it('replays a terminal request even when the current source root is unavailable', async () => {
    const database = outerDatabase(transactionHarness())
    database.systemJob.findUnique.mockResolvedValue(existingApplyJob())
    const replayOptions = {
      ...options(database),
      getScanRoot: vi.fn().mockResolvedValue('/missing/source'),
      inspectRoot: vi.fn().mockRejectedValue(new Error('source unavailable'))
    }

    await expect(startSourceAuditApply(request, 'admin-1', replayOptions)).resolves.toMatchObject({
      outcome: 'ACCEPTED',
      operationId: 'apply-run-existing',
      status: 'COMPLETED',
      reused: true
    })
    expect(replayOptions.getScanRoot).not.toHaveBeenCalled()
    expect(database.$transaction).not.toHaveBeenCalled()
  })

  it('returns an active apply reference for a different key without pretending durable reuse', async () => {
    const transaction = transactionHarness()
    const database = outerDatabase(transaction)
    transaction.systemJob.findFirst.mockResolvedValue({
      id: 'apply-job-active',
      status: 'RUNNING',
      scanRun: { id: 'apply-run-active', operationKind: 'AUDIT_APPLY', sourceAuditRunId: 'audit-run-1' }
    })

    await expect(startSourceAuditApply(request, 'admin-1', options(database))).resolves.toEqual({
      outcome: 'BLOCKED',
      reason: 'APPLY_ACTIVE',
      activeOperationId: 'apply-run-active'
    })
    expect(database.$transaction).toHaveBeenCalledOnce()
  })

  it('does not expose an active operation id owned by a different source audit', async () => {
    const transaction = transactionHarness()
    const database = outerDatabase(transaction)
    transaction.systemJob.findFirst.mockResolvedValue({
      id: 'apply-job-other-audit',
      status: 'RUNNING',
      scanRun: { id: 'apply-run-other-audit', operationKind: 'AUDIT_APPLY', sourceAuditRunId: 'audit-run-other' }
    })

    await expect(startSourceAuditApply(request, 'admin-1', options(database))).resolves.toEqual({
      outcome: 'BLOCKED',
      reason: 'SCAN_BUSY',
      activeOperationId: null
    })
    expect(database.$transaction).toHaveBeenCalledOnce()
  })

  it.each([
    ['APPLIED', null, false],
    ['SKIPPED', 'STALE_SOURCE_INPUT', false],
    ['CONFLICT', 'SOURCE_IDENTITY_CHANGED', false],
    ['FAILED', 'MEDIA_VALIDATION_FAILED', false]
  ] as const)(
    'rejects an item with a stronger historical %s outcome',
    async (applyOutcome, applyReasonCode, applyRetryable) => {
      const transaction = transactionHarness()
      transaction.scanRunItem.findMany.mockResolvedValue([
        applyHistory({ applyOutcome, applyReasonCode, applyRetryable })
      ])
      const database = outerDatabase(transaction)

      await expect(startSourceAuditApply(request, 'admin-1', options(database))).resolves.toEqual({
        outcome: 'BLOCKED',
        reason: 'ITEMS_NOT_ELIGIBLE',
        activeOperationId: null
      })
      expect(transaction.systemJob.create).not.toHaveBeenCalled()
    }
  )

  it('allows a new attempt when every historical attempt for the selected item is retryable FAILED', async () => {
    const transaction = transactionHarness()
    transaction.scanRunItem.findMany.mockResolvedValue([
      applyHistory({ applyOutcome: 'FAILED', applyReasonCode: 'OPERATION_FAILED', applyRetryable: true })
    ])
    const database = outerDatabase(transaction)

    await expect(startSourceAuditApply(request, 'admin-1', options(database))).resolves.toMatchObject({
      outcome: 'ACCEPTED',
      reused: false
    })
    expect(transaction.systemJob.create).toHaveBeenCalledOnce()
  })

  it.each([
    ['active', { applyOutcome: null, jobStatus: 'RUNNING', auditDifferenceKind: 'NEW' }],
    ['incomplete', { applyOutcome: null, jobStatus: 'COMPLETED', auditDifferenceKind: 'NEW' }],
    ['mismatched', { applyOutcome: 'FAILED', jobStatus: 'COMPLETED', auditDifferenceKind: 'CHANGED' }]
  ] as const)('rejects %s historical evidence', async (_label, historyCase) => {
    const transaction = transactionHarness()
    transaction.scanRunItem.findMany.mockResolvedValue([
      {
        sourceAuditItemId: 'audit-item-new',
        auditDifferenceKind: historyCase.auditDifferenceKind,
        applyOutcome: historyCase.applyOutcome,
        applyReasonCode: historyCase.applyOutcome === 'FAILED' ? 'OPERATION_FAILED' : null,
        applyRetryable: historyCase.applyOutcome === 'FAILED',
        finishedAt: historyCase.applyOutcome === 'FAILED' ? now : null,
        scanRun: { id: 'apply-run-old', systemJob: { status: historyCase.jobStatus } }
      }
    ])

    await expect(startSourceAuditApply(request, 'admin-1', options(outerDatabase(transaction)))).resolves.toEqual({
      outcome: 'BLOCKED',
      reason: 'ITEMS_NOT_ELIGIBLE',
      activeOperationId: null
    })
    expect(transaction.systemJob.create).not.toHaveBeenCalled()
  })
})

describe('source audit apply read DTO', () => {
  it('maps stale separately, keeps partial terminal results and hides stored raw summaries', async () => {
    const database = {
      scanRun: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'apply-run-1',
          systemJobId: 'apply-job-1',
          sourceAuditRunId: 'audit-run-1',
          status: 'COMPLETED',
          checkpointStage: 'COMPLETED',
          auditNewInputs: 1,
          auditChangedInputs: 1,
          inputCount: 2,
          createdAt: now,
          startedAt: now,
          finishedAt: now,
          systemJob: { status: 'COMPLETED', startedAt: now, finishedAt: now },
          metadataInputs: [
            { sourceAuditItemId: 'item-1', relativePath: '101-meta.json', auditDifferenceKind: 'NEW' },
            { sourceAuditItemId: 'item-2', relativePath: '202-meta.json', auditDifferenceKind: 'CHANGED' }
          ],
          items: [
            {
              id: 'run-item-1',
              sourceAuditItemId: 'item-1',
              auditDifferenceKind: 'NEW',
              externalId: '101',
              title: 'New work',
              artistName: 'Artist',
              metadataRelativePath: '101-meta.json',
              status: 'SUCCESS',
              applyOutcome: 'APPLIED',
              resultArtworkId: 101,
              applyReasonCode: null,
              applyRetryable: false,
              startedAt: now,
              finishedAt: now
            },
            {
              id: 'run-item-2',
              sourceAuditItemId: 'item-2',
              auditDifferenceKind: 'CHANGED',
              externalId: '202',
              title: 'Changed work',
              artistName: 'Artist',
              metadataRelativePath: '202-meta.json',
              status: 'SKIPPED',
              applyOutcome: 'SKIPPED',
              resultArtworkId: 202,
              applyReasonCode: 'STALE_SOURCE_INPUT',
              applyReasonSummary: '/secret/raw/error',
              applyRetryable: false,
              startedAt: now,
              finishedAt: now
            }
          ]
        })
      },
      artwork: {
        findMany: vi.fn().mockResolvedValue([
          { id: 101, title: 'New work' },
          { id: 202, title: 'Changed work' }
        ])
      }
    }

    const result = await getSourceAuditApplyOperation({ operationId: 'apply-run-1' }, { database: database as never })
    expect(result).toMatchObject({
      terminal: true,
      resultComplete: true,
      progress: 100,
      counts: { applied: 1, stale: 1, conflict: 0, failed: 0 },
      items: [{ state: 'APPLIED' }, { state: 'STALE', code: 'STALE_SOURCE_INPUT' }]
    })
    expect(JSON.stringify(result)).not.toContain('/secret')
    expect(JSON.stringify(result)).not.toContain('ContentHash')
  })
})

function outerDatabase(transaction: ReturnType<typeof transactionHarness>) {
  return {
    systemJob: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null)
    },
    setting: { findUnique: vi.fn().mockResolvedValue({ value: '/media/pixiv' }) },
    $transaction: vi.fn(async (operation: (tx: typeof transaction) => unknown) => operation(transaction))
  }
}

function transactionHarness() {
  const audit = completedAudit()
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ lock: '' }]),
    systemJob: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: 'apply-job-1', status: 'PENDING' })
    },
    scanRun: {
      findFirst: vi.fn().mockResolvedValue(audit),
      create: vi.fn().mockResolvedValue({ id: 'apply-run-1' })
    },
    scanRunMetadataInput: { createMany: vi.fn().mockResolvedValue({ count: 2 }) },
    scanRunItem: {
      findMany: vi.fn().mockResolvedValue([]),
      createMany: vi.fn().mockResolvedValue({ count: 2 })
    },
    systemJobEvent: { create: vi.fn().mockResolvedValue({ id: 1n }) },
    pixivMetadataInventoryState: {
      findUnique: vi.fn().mockResolvedValue({ status: 'READY', baselineGeneration: 7 })
    },
    workerInstance: { findMany: vi.fn().mockResolvedValue([{ capabilities: [v3Capability] }]) }
  }
}

function completedAudit() {
  const items = [
    auditItem({
      id: 'audit-item-new',
      ordinal: 3,
      differenceKind: 'NEW',
      externalId: '101',
      observedContentHash: 'a'.repeat(64),
      processedContentHash: null,
      inventoryId: 'inventory-101',
      externalRefId: null,
      artworkId: null
    }),
    auditItem({
      id: 'audit-item-changed',
      ordinal: 9,
      differenceKind: 'CHANGED',
      externalId: '202',
      observedContentHash: 'b'.repeat(64),
      processedContentHash: 'c'.repeat(64),
      inventoryId: 'inventory-202',
      externalRefId: 'ref-202',
      artworkId: 202
    })
  ]
  return {
    id: 'audit-run-1',
    status: 'COMPLETED',
    inputFrozenAt: now,
    inventoryBaselineGeneration: 7,
    systemJob: { status: 'COMPLETED' },
    sourceAuditItems: items,
    metadataInputs: items.map((item) => ({
      sourceAuditItemId: item.id,
      auditDifferenceKind: item.differenceKind,
      relativePath: item.relativePath,
      contentHash: item.observedContentHash,
      expectedExternalId: item.expectedExternalId,
      expectedInventoryId: item.inventoryId,
      expectedExternalRefId: item.externalRefId,
      expectedArtworkId: item.artworkId,
      sizeBytes: item.sizeBytes,
      mtimeMs: item.mtimeMs,
      ctimeMs: item.ctimeMs,
      deviceId: item.deviceId,
      inode: item.inode
    }))
  }
}

function auditItem(input: {
  id: string
  ordinal: number
  differenceKind: 'NEW' | 'CHANGED'
  externalId: string
  observedContentHash: string
  processedContentHash: string | null
  inventoryId: string
  externalRefId: string | null
  artworkId: number | null
}) {
  return {
    id: input.id,
    ordinal: input.ordinal,
    differenceKind: input.differenceKind,
    relativePath: `${input.externalId}-meta.json`,
    expectedExternalId: input.externalId,
    observedExternalId: input.externalId,
    title: `Artwork ${input.externalId}`,
    artistName: 'Artist',
    inventoryId: input.inventoryId,
    externalRefId: input.externalRefId,
    artworkId: input.artworkId,
    observedContentHash: input.observedContentHash,
    processedContentHash: input.processedContentHash,
    sizeBytes: 100n,
    mtimeMs: 200n,
    ctimeMs: null,
    deviceId: null,
    inode: null,
    issueCode: null
  }
}

function existingApplyJob() {
  return {
    id: 'apply-job-existing',
    type: 'SCAN',
    definitionVersion: 3,
    status: 'COMPLETED',
    requestedByUserId: 'admin-1',
    payload: { mode: 'AUDIT_APPLY', auditRunId: 'audit-run-1', inputCount: 2, inputDigest: 'd'.repeat(64) },
    scanRun: {
      id: 'apply-run-existing',
      operationKind: 'AUDIT_APPLY',
      sourceAuditRunId: 'audit-run-1',
      inputDigest: 'd'.repeat(64),
      inputCount: 2,
      inputFrozenAt: now,
      metadataInputs: [{ sourceAuditItemId: 'audit-item-new' }, { sourceAuditItemId: 'audit-item-changed' }]
    }
  }
}

function applyHistory(input: {
  applyOutcome: 'APPLIED' | 'SKIPPED' | 'CONFLICT' | 'FAILED'
  applyReasonCode: string | null
  applyRetryable: boolean
}) {
  return {
    sourceAuditItemId: 'audit-item-new',
    auditDifferenceKind: 'NEW',
    ...input,
    finishedAt: now,
    scanRun: { id: 'apply-run-old', systemJob: { status: 'COMPLETED' } }
  }
}

function options(database: unknown) {
  return {
    database: database as never,
    environment: { CENTRAL_DISPATCHER_CUTOVER_ENABLED: 'true', WORKER_DISPATCH_ENABLED: 'true' },
    now: () => now,
    getScanRoot: vi.fn().mockResolvedValue('/media/pixiv'),
    inspectRoot: vi.fn().mockResolvedValue(undefined)
  }
}
