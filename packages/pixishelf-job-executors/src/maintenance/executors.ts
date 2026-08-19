import { emptyJobPayloadSchema, JOB_DEFINITION_VERSION } from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext, ExecutorDefinition, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { cleanupArchiveIntakeHistory } from './archive-intake-retention-cleanup.ts'
import { syncAllMediaDerivedTags } from './media-derived-tag-sync.ts'
import { refillMetaSource } from './refill-meta-source.ts'
import { cleanupScanRunHistory } from './scan-run-cleanup.ts'
import { cleanupTriggerLogs } from './trigger-log-cleanup.ts'
import type { MaintenanceDatabase, MaintenanceTransaction, RunMaintenanceMutation } from './types.ts'
import { scanWebpAnimations } from './webp-animation-scan.ts'

export interface MaintenanceExecutorDependencies {
  database: MaintenanceDatabase
  scanRoot: string
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
    definition('WEBP_ANIMATION_SCAN', (context) =>
      scanWebpAnimations({
        ...operationInput(context, dependencies.database),
        scanRoot: dependencies.scanRoot
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
    parsePayload: (payload) => emptyJobPayloadSchema.parse(payload) as EmptyPayload,
    execute: async (context) => ({
      kind: 'completed',
      result: await run(context),
      message: `${jobType} completed`
    })
  }
}

function operationInput(context: ExecutionContext<EmptyPayload, EnqueuedChildJob>, database: MaintenanceDatabase) {
  const mutate: RunMaintenanceMutation = <T>(operation: (transaction: MaintenanceTransaction) => Promise<T>) =>
    context.mutateInTransaction<MaintenanceTransaction & QueueSqlExecutor, T>((transaction) => operation(transaction))
  return {
    database,
    mutate,
    signal: context.signal,
    progress: (update: { percentage: number; stage: string; message: string; data?: Record<string, unknown> }) =>
      context.progress({
        progress: update.percentage,
        stage: update.stage,
        message: update.message,
        ...(update.data ? { data: update.data } : {})
      })
  }
}
