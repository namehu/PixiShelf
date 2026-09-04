import {
  archiveDefaultTagBackfillPayloadSchema,
  emptyJobPayloadSchema,
  jobEventRetentionCleanupPayloadSchema,
  JOB_DEFINITION_VERSION,
  pixivAiDerivedTagSyncPayloadSchema,
  type ArchiveDefaultTagBackfillPayload,
  type JobEventRetentionCleanupPayload,
  type PixivAiDerivedTagSyncPayload
} from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext, ExecutorDefinition, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { cleanupArchiveIntakeHistory } from './archive-intake-retention-cleanup.ts'
import { executeArchiveDefaultTagBackfill } from './archive-default-tag-backfill.ts'
import { cleanupJobEvents } from './job-event-retention-cleanup.ts'
import { syncAllMediaDerivedTags } from './media-derived-tag-sync.ts'
import { syncPixivAiDerivedTags } from './pixiv-ai-derived-tag-sync.ts'
import { refillMetaSource } from './refill-meta-source.ts'
import { cleanupScanRunHistory } from './scan-run-cleanup.ts'
import { cleanupTriggerLogs } from './trigger-log-cleanup.ts'
import type {
  MaintenanceDatabase,
  MaintenanceProgress,
  MaintenanceProgressMutationResult,
  MaintenanceTransaction,
  RunMaintenanceMutation
} from './types.ts'
import { scanWebpAnimations } from './webp-animation-scan.ts'

export interface MaintenanceExecutorDependencies {
  database: MaintenanceDatabase
  scanRoot: string
  animationScanConcurrency?: number
  now?: () => Date
}

type EmptyPayload = Record<string, never>

export function createMaintenanceExecutorRegistrations(
  dependencies: MaintenanceExecutorDependencies
): ExecutorDefinition[] {
  if (!dependencies.scanRoot.trim()) throw new Error('Maintenance scanRoot is required')
  return [
    definition('ARCHIVE_INTAKE_RETENTION_CLEANUP', (context) =>
      cleanupArchiveIntakeHistory({
        ...operationInput(context, dependencies.database),
        ...(dependencies.now ? { now: dependencies.now() } : {})
      })
    ) as ExecutorDefinition,
    definition('TRIGGER_LOG_RETENTION_CLEANUP', (context) =>
      cleanupTriggerLogs({
        ...operationInput(context, dependencies.database),
        ...(dependencies.now ? { now: dependencies.now() } : {})
      })
    ) as ExecutorDefinition,
    definition('SCAN_RUN_RETENTION_CLEANUP', (context) =>
      cleanupScanRunHistory({
        ...operationInput(context, dependencies.database),
        ...(dependencies.now ? { now: dependencies.now() } : {})
      })
    ) as ExecutorDefinition,
    definition('REFILL_META_SOURCE', (context) =>
      refillMetaSource({
        ...operationInput(context, dependencies.database),
        scanRoot: dependencies.scanRoot
      })
    ) as ExecutorDefinition,
    definition('MEDIA_DERIVED_TAG_SYNC', (context) =>
      syncAllMediaDerivedTags(operationInput(context, dependencies.database))
    ) as ExecutorDefinition,
    {
      jobType: 'JOB_EVENT_RETENTION_CLEANUP',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: JOB_DEFINITION_VERSION,
      progressPolicy: 'STANDARD',
      parsePayload: (payload) => jobEventRetentionCleanupPayloadSchema.parse(payload),
      execute: async (context: ExecutionContext<JobEventRetentionCleanupPayload, EnqueuedChildJob>) => ({
        kind: 'completed',
        result: await cleanupJobEvents({
          ...operationInput(context, dependencies.database),
          dryRun: context.payload.dryRun,
          ...(dependencies.now ? { now: dependencies.now() } : {})
        }),
        message: context.payload.dryRun
          ? 'JOB_EVENT_RETENTION_CLEANUP dry run completed'
          : 'JOB_EVENT_RETENTION_CLEANUP completed'
      })
    } as ExecutorDefinition,
    {
      jobType: 'ARCHIVE_DEFAULT_TAG_BACKFILL',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: JOB_DEFINITION_VERSION,
      progressPolicy: 'STANDARD',
      parsePayload: (payload) => archiveDefaultTagBackfillPayloadSchema.parse(payload),
      execute: (context: ExecutionContext<ArchiveDefaultTagBackfillPayload, EnqueuedChildJob>) =>
        executeArchiveDefaultTagBackfill(context, dependencies.now ? { now: dependencies.now } : {})
    } as ExecutorDefinition,
    {
      jobType: 'PIXIV_AI_DERIVED_TAG_SYNC',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: JOB_DEFINITION_VERSION,
      progressPolicy: 'STANDARD',
      parsePayload: (payload) => pixivAiDerivedTagSyncPayloadSchema.parse(payload),
      execute: async (context: ExecutionContext<PixivAiDerivedTagSyncPayload, EnqueuedChildJob>) => ({
        kind: 'completed',
        result: await syncPixivAiDerivedTags({
          ...operationInput(context, dependencies.database),
          payload: context.payload
        }),
        message: 'PIXIV_AI_DERIVED_TAG_SYNC completed'
      })
    } as ExecutorDefinition,
    definition('WEBP_ANIMATION_SCAN', (context) =>
      scanWebpAnimations({
        ...operationInput(context, dependencies.database),
        scanRoot: dependencies.scanRoot,
        concurrency: dependencies.animationScanConcurrency ?? 4,
        // The previous aggregate is a recovery hint only; the executor
        // re-derives pending work from the database before resuming.
        ...(context.job.progressData?.kind === 'animation-scan'
          ? { resumeProgressData: context.job.progressData }
          : {}),
        ...(dependencies.now ? { now: dependencies.now } : {})
      })
    ) as ExecutorDefinition
  ]
}

function definition<TResult>(
  jobType:
    | 'ARCHIVE_INTAKE_RETENTION_CLEANUP'
    | 'TRIGGER_LOG_RETENTION_CLEANUP'
    | 'SCAN_RUN_RETENTION_CLEANUP'
    | 'REFILL_META_SOURCE'
    | 'MEDIA_DERIVED_TAG_SYNC'
    | 'WEBP_ANIMATION_SCAN',
  run: (context: ExecutionContext<EmptyPayload, EnqueuedChildJob>) => Promise<TResult>
): ExecutorDefinition<EmptyPayload, TResult> {
  return {
    jobType,
    executionLane: 'BACKGROUND_WRITER',
    definitionVersion: JOB_DEFINITION_VERSION,
    progressPolicy: jobType === 'WEBP_ANIMATION_SCAN' ? 'REALTIME' : 'STANDARD',
    parsePayload: (payload) => emptyJobPayloadSchema.parse(payload) as EmptyPayload,
    execute: async (context) => ({
      kind: 'completed',
      result: await run(context),
      message: `${jobType} completed`
    })
  }
}

function operationInput<TPayload extends Record<string, unknown>>(
  context: ExecutionContext<TPayload, EnqueuedChildJob>,
  database: MaintenanceDatabase
) {
  const mutate: RunMaintenanceMutation = <T>(operation: (transaction: MaintenanceTransaction) => Promise<T>) =>
    context.mutateInTransaction<MaintenanceTransaction & QueueSqlExecutor, T>((transaction) => operation(transaction))
  const toExecutionProgress = (update: MaintenanceProgress) => ({
    progress: update.percentage,
    stage: update.stage,
    message: update.message,
    ...(update.data ? { data: update.data } : {}),
    ...(update.progressData ? { progressData: update.progressData } : {}),
    ...(update.persistenceMode ? { persistenceMode: update.persistenceMode } : {}),
    ...(update.forcePersistence === undefined ? {} : { forcePersistence: update.forcePersistence }),
    ...(update.level ? { level: update.level } : {})
  })
  return {
    database,
    mutate,
    ...(context.checkpointInTransaction
      ? {
          checkpoint: <T>(
            operation: (transaction: MaintenanceTransaction) => Promise<MaintenanceProgressMutationResult<T>>
          ) =>
            context.checkpointInTransaction!<MaintenanceTransaction & QueueSqlExecutor, T>(async (transaction) => {
              const checkpoint = await operation(transaction)
              return {
                result: checkpoint.result,
                update: {
                  ...toExecutionProgress(checkpoint.update),
                  progressData: checkpoint.update.progressData
                }
              }
            })
        }
      : {}),
    signal: context.signal,
    progress: (update: MaintenanceProgress) => context.progress(toExecutionProgress(update))
  }
}
