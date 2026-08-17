import {
  JOB_DEFINITION_VERSION,
  localDirectoryImportPayloadSchema,
  scanPayloadSchema,
  type LocalDirectoryImportPayload,
  type ScanPayload
} from '@pixishelf/job-contracts'
import type { ExecutorDefinition } from '@pixishelf/job-runtime'
import { executeLocalDirectoryImport } from './local-executor.js'
import { executeScan } from './scan-executor.js'
import { DEFAULT_SCAN_LIMITS, type ScanExecutorDependencies } from './types.js'

export function createScanExecutorRegistrations(dependencies: ScanExecutorDependencies): ExecutorDefinition[] {
  validateDependencies(dependencies)
  return [
    {
      jobType: 'SCAN',
      definitionVersion: JOB_DEFINITION_VERSION,
      parsePayload: (payload) => scanPayloadSchema.parse(payload),
      execute: (context) => executeScan(context, dependencies)
    } as ExecutorDefinition<ScanPayload>,
    {
      jobType: 'LOCAL_DIRECTORY_IMPORT',
      definitionVersion: JOB_DEFINITION_VERSION,
      parsePayload: (payload) => localDirectoryImportPayloadSchema.parse(payload),
      execute: (context) => executeLocalDirectoryImport(context, dependencies)
    } as ExecutorDefinition<LocalDirectoryImportPayload>
  ] as ExecutorDefinition[]
}

function validateDependencies(dependencies: ScanExecutorDependencies) {
  if (!dependencies.config.scanRoot.trim()) throw new Error('Scan executor scanRoot is required')
  const limits = { ...DEFAULT_SCAN_LIMITS, ...dependencies.config.limits }
  for (const [name, value, maximum] of [
    ['pageSize', limits.pageSize, 1_000],
    ['maxDepth', limits.maxDepth, 100],
    ['maxEntries', limits.maxEntries, 100_000],
    ['maxMediaPerArtwork', limits.maxMediaPerArtwork, 10_000],
    ['concurrency', limits.concurrency, 32],
    ['maxMetadataBytes', limits.maxMetadataBytes, 256 * 1024 * 1024],
    ['maxManifestBytes', limits.maxManifestBytes, 64 * 1024 * 1024],
    ['maxArchiveMediaBytes', limits.maxArchiveMediaBytes, Number.MAX_SAFE_INTEGER],
    ['maxFullSweepReferences', limits.maxFullSweepReferences, 10_000_000]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new Error(`Scan executor ${name} must be an integer between 1 and ${maximum}`)
    }
  }
}
