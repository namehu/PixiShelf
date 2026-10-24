import { randomUUID } from 'node:crypto'
import type { createDatabaseClient } from '@pixishelf/db'
import { archiveModule } from '../archive-module'
import { actionArchiveTasksMany } from '../archive-task-service'

export function createArchiveTaskFixture(database: ReturnType<typeof createDatabaseClient>, suitePrefix: string, requestedByUserId: string) {
  async function seedTask(
    suffix: string,
    importStatus: 'PENDING' | 'RUNNING' | 'PAUSED' | 'CANCELLING' | 'COMPLETED' | 'FAILED' | 'CANCELLED',
    jobStatus: 'PENDING' | 'RUNNING' | 'PAUSED' | 'CANCELLING' | 'COMPLETED' | 'FAILED' | 'CANCELLED',
    options: {
      jobType?: 'ARCHIVE_IMPORT' | 'ARCHIVE_PUBLISH'
      progress?: number
      queuePriority?: number
      maxAttempts?: number
      decisionCode?: string
      failedItems?: number
      completedItems?: number
      totalItems?: number
      withFailedItem?: boolean
      createdAt?: Date
      submittedUrl?: string
      message?: string
      errorMessage?: string
      warning?: string
      cleanupRequestedAt?: Date
    } = {}
  ) {
    const jobId = `${suitePrefix}-${suffix}-job`
    const importId = `${suitePrefix}-${suffix}-import`
    await database.systemJob.create({
      data: {
        id: jobId,
        type: options.jobType ?? 'ARCHIVE_IMPORT',
        attempt: options.jobType === 'ARCHIVE_PUBLISH' ? 1 : 0,
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: 1,
        status: jobStatus,
        ...(['RUNNING', 'CANCELLING'].includes(jobStatus)
          ? { workerId: `${suitePrefix}-worker`, leaseToken: randomUUID(), leaseExpiresAt: new Date(Date.now() + 60_000) }
          : {}),
        triggerSource: 'MANUAL',
        requestedByUserId,
        payload: { archiveImportId: importId },
        queuePriority: options.queuePriority ?? 10,
        effectivePriority: options.queuePriority ?? 10,
        maxAttempts: options.maxAttempts ?? 3,
        progress: options.progress ?? 0,
        message: options.message,
        createdAt: options.createdAt,
        ...(jobStatus === 'COMPLETED' || jobStatus === 'FAILED' || jobStatus === 'CANCELLED'
          ? { finishedAt: options.createdAt ?? new Date() }
          : {})
      }
    })
    await database.archiveImport.create({
      data: {
        id: importId,
        systemJobId: jobId,
        providerKey: 'archive-task-test-provider',
        externalId: suffix,
        submittedUrl: options.submittedUrl ?? `https://e-hentai.org/g/${suffix}/private-token/`,
        canonicalUrl: `https://e-hentai.org/g/${suffix}/private-token/`,
        locator: { token: 'private-token' },
        status: importStatus,
        requestedQuality: 'ORIGINAL',
        selectedQuality: 'ORIGINAL',
        decisionCode: options.decisionCode,
        normalizedMetadata: { titles: { display: `Task ${suffix}` } },
        rawMetadata: { token: 'private-token' },
        metadataHash: 'a'.repeat(64),
        creatorBucket: 'test-creator',
        stagingPath: `.archive-staging/${importId}`,
        totalItems: options.totalItems ?? (options.withFailedItem ? 1 : 0),
        completedItems: options.completedItems ?? 0,
        failedItems: options.failedItems ?? 0,
        errorMessage: options.errorMessage,
        warning: options.warning,
        cleanupRequestedAt: options.cleanupRequestedAt,
        createdAt: options.createdAt,
        ...(options.withFailedItem
          ? {
              items: {
                create: {
                  pageIndex: 1,
                  sourcePageUrl: `https://e-hentai.org/s/private/${suffix}`,
                  locator: { token: 'private' },
                  expectedFilename: '0001',
                  status: 'FAILED',
                  attempts: 3,
                  errorCode: 'REMOTE_RESPONSE_INVALID'
                }
              }
            }
          : {})
      }
    })
    return { jobId, importId }
  }

  async function seedCatalogCopies(
    archiveImportId: string,
    externalId: string,
    outcome: 'SUBMITTED' | 'FAILED' | 'CANCELLED'
  ) {
    for (const sourceSuffix of ['a', 'b']) {
      await database.archiveUploaderSource.create({
        data: {
          providerKey: 'archive-task-test-provider',
          identityKind: 'NAME',
          identityValue: `${suitePrefix}-${externalId}-${sourceSuffix}`,
          normalizedIdentity: `${suitePrefix}-${externalId}-${sourceSuffix}`,
          displayName: `Catalog source ${sourceSuffix}`,
          catalogItems: {
            create: {
              providerKey: 'archive-task-test-provider',
              externalId,
              canonicalUrl: `https://e-hentai.org/g/${externalId}/private-token/`,
              title: `Catalog ${externalId}`,
              relationships: [],
              classification: 'NEW',
              firstSeenAt: new Date('2026-08-17T00:00:00.000Z'),
              lastSeenAt: new Date('2026-08-17T00:00:00.000Z'),
              lastArchiveImportId: archiveImportId,
              lastOutcome: outcome,
              lastOutcomeAt: new Date('2026-08-17T01:00:00.000Z'),
              ...(outcome === 'FAILED'
                ? { lastErrorCode: 'REMOTE_RESPONSE_INVALID', lastErrorMessage: 'Previous failure' }
                : {})
            }
          }
        }
      })
    }
  }

  function projectControlState(task: { status: string; systemJob: { status: string }; failedItems: number }) {
    return { importStatus: task.status, jobStatus: task.systemJob.status, failedItems: task.failedItems }
  }

  function projectRetryState(task: {
    status: string
    decisionCode: string | null
    errorCode: string | null
    errorMessage: string | null
    failedItems: number
    systemJob: {
      status: string
      triggerSource: string
      queuePriority: number
      effectivePriority: number
      progress: number
      maxAttempts: number
    }
  }) {
    return {
      importStatus: task.status,
      decisionCode: task.decisionCode,
      errorCode: task.errorCode,
      errorMessage: task.errorMessage,
      failedItems: task.failedItems,
      jobStatus: task.systemJob.status,
      triggerSource: task.systemJob.triggerSource,
      priority: task.systemJob.queuePriority,
      effectivePriority: task.systemJob.effectivePriority,
      progress: task.systemJob.progress,
      maxAttempts: task.systemJob.maxAttempts
    }
  }

  function deferred() {
    let resolve!: () => void
    const promise = new Promise<void>((done) => {
      resolve = done
    })
    return { promise, resolve }
  }

  async function waitForBlockedTransactions(count: number) {
    const deadline = Date.now() + 4_000
    while (Date.now() < deadline) {
      const rows = await database.$queryRaw<Array<{ count: number }>>`
        SELECT count(*)::int AS count FROM pg_stat_activity
        WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> pg_backend_pid()`
      if (rows[0]!.count >= count) return
      await new Promise((resolve) => setTimeout(resolve, 10))
    }
    throw new Error(`Expected ${count} concurrent transactions waiting for database locks`)
  }

  async function controlResult(
    entry: 'archive' | 'bulk',
    task: { jobId: string; importId: string },
    action: 'PAUSE' | 'RESUME' | 'CANCEL' | 'RETRY'
  ) {
    try {
      if (entry === 'archive') {
        await archiveModule.requestJobAction(task.jobId, action, requestedByUserId)
        return 'APPLIED'
      }
      const result = await actionArchiveTasksMany(
        { idempotencyKey: randomUUID(), taskIds: [task.importId], action },
        requestedByUserId,
        { database }
      )
      const item = result?.items[0]
      return item?.result === 'APPLIED' ? 'APPLIED' : item?.code
    } catch (error) {
      return error instanceof Error && 'code' in error ? error.code : error
    }
  }
  return { seedTask, seedCatalogCopies, projectControlState, projectRetryState, deferred, waitForBlockedTransactions, controlResult }
}
