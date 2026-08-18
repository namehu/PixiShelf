import { JOB_DEFINITION_VERSION, migrationPayloadSchema, type MigrationPayload } from '@pixishelf/job-contracts'
import type { ExecutorDefinition, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { executeMigration } from './executor.js'
import type { MigrationExecutorDependencies } from './types.js'

export function createMigrationExecutorRegistrations<TTransaction extends QueueSqlExecutor>(
  dependencies: MigrationExecutorDependencies<TTransaction>
): ExecutorDefinition[] {
  assertMigrationConfig(dependencies)
  const migration: ExecutorDefinition<MigrationPayload> = {
    jobType: 'MIGRATION',
    executionLane: 'BACKGROUND_WRITER',
    definitionVersion: JOB_DEFINITION_VERSION,
    parsePayload: (payload) => migrationPayloadSchema.parse(payload),
    execute: (context) => executeMigration(context, dependencies)
  }
  return [migration as ExecutorDefinition]
}

function assertMigrationConfig<TTransaction extends QueueSqlExecutor>(
  dependencies: MigrationExecutorDependencies<TTransaction>
) {
  if (!dependencies.config.scanRoot.trim()) throw new Error('Migration scanRoot is required')
  if (
    dependencies.config.selectionPageSize !== undefined &&
    (!Number.isInteger(dependencies.config.selectionPageSize) ||
      dependencies.config.selectionPageSize < 1 ||
      dependencies.config.selectionPageSize > 100)
  ) {
    throw new Error('Migration selectionPageSize must be an integer between 1 and 100')
  }
  for (const [name, value, maximum] of [
    ['maxArtworkFiles', dependencies.config.maxArtworkFiles, 5_000],
    ['maxDirectoryEntries', dependencies.config.maxDirectoryEntries, 10_000]
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > maximum)) {
      throw new Error(`Migration ${name} must be an integer between 1 and ${maximum}`)
    }
  }
}
