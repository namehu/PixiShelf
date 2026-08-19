import {
  JOB_DEFINITION_VERSION,
  pendingReplacePayloadSchema,
  type PendingReplacePayload
} from '@pixishelf/job-contracts'
import type { ExecutorDefinition, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { executePendingReplace } from './executor.ts'
import type { PendingReplaceExecutorDependencies } from './types.ts'

export function createPendingReplaceExecutorRegistrations<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>
): ExecutorDefinition[] {
  assertConfig(dependencies)
  const registration: ExecutorDefinition<PendingReplacePayload> = {
    jobType: 'PENDING_REPLACE',
    executionLane: 'BACKGROUND_WRITER',
    definitionVersion: JOB_DEFINITION_VERSION,
    parsePayload: (payload) => pendingReplacePayloadSchema.parse(payload),
    execute: (context) => executePendingReplace(context, dependencies)
  }
  return [registration as ExecutorDefinition]
}

function assertConfig<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>
) {
  if (!dependencies.config.scanRoot.trim()) throw new Error('Pending replacement scanRoot is required')
  if (dependencies.config.maximumDirectoryEntries !== undefined) {
    const value = dependencies.config.maximumDirectoryEntries
    if (!Number.isInteger(value) || value < 1 || value > 1_234) {
      throw new Error('Pending replacement maximumDirectoryEntries must be 1..1234')
    }
  }
  if (dependencies.config.maximumSnapshotBytes !== undefined) {
    const value = dependencies.config.maximumSnapshotBytes
    if (!Number.isInteger(value) || value < 1 || value > 2 * 1024 * 1024) {
      throw new Error('Pending replacement maximumSnapshotBytes must be 1..2097152')
    }
  }
}
