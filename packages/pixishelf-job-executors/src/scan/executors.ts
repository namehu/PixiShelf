import {
  JOB_DEFINITION_VERSION,
  SCAN_AUDIT_APPLY_DEFINITION_VERSION,
  SCAN_DEFINITION_VERSION,
  localDirectoryImportPayloadSchema,
  scanPayloadSchema,
  scanV2PayloadSchema,
  scanV3PayloadSchema,
  type LocalDirectoryImportPayload,
  type ScanPayload,
  type ScanV2Payload,
  type ScanV3Payload
} from '@pixishelf/job-contracts'
import type { ExecutorDefinition } from '@pixishelf/job-runtime'
import { executeLocalDirectoryImport } from './local-executor.ts'
import { executeConsistencyAudit } from './consistency-audit-executor.ts'
import { executeScan } from './scan-executor.ts'
import { executeAuditApply } from './audit-apply-executor.ts'
import {
  DEFAULT_SCAN_DISCOVERY_EXCLUDED_ROOT_DIRECTORIES,
  DEFAULT_SCAN_LIMITS,
  type ScanExecutorDependencies
} from './types.ts'

export function createScanExecutorRegistrations(dependencies: ScanExecutorDependencies): ExecutorDefinition[] {
  validateDependencies(dependencies)
  return [
    {
      jobType: 'SCAN',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: JOB_DEFINITION_VERSION,
      parsePayload: (payload) => scanPayloadSchema.parse(payload),
      execute: (context) => executeScan(context, dependencies)
    } as ExecutorDefinition<ScanPayload>,
    {
      jobType: 'SCAN',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: SCAN_DEFINITION_VERSION,
      parsePayload: (payload) => scanV2PayloadSchema.parse(payload),
      execute: (context) =>
        context.payload.mode === 'CONSISTENCY_AUDIT'
          ? executeConsistencyAudit(context, dependencies)
          : Promise.resolve({
              kind: 'failed' as const,
              errorCode: 'PRECONDITION_FAILED' as const,
              error: 'Audit apply is not available in this release',
              message: 'Audit apply is not available'
            })
    } as ExecutorDefinition<ScanV2Payload>,
    {
      jobType: 'SCAN',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: SCAN_AUDIT_APPLY_DEFINITION_VERSION,
      parsePayload: (payload) => scanV3PayloadSchema.parse(payload),
      execute: (context) => executeAuditApply(context, dependencies)
    } as ExecutorDefinition<ScanV3Payload>,
    {
      jobType: 'LOCAL_DIRECTORY_IMPORT',
      executionLane: 'BACKGROUND_WRITER',
      definitionVersion: JOB_DEFINITION_VERSION,
      parsePayload: (payload) => localDirectoryImportPayloadSchema.parse(payload),
      execute: (context) => executeLocalDirectoryImport(context, dependencies)
    } as ExecutorDefinition<LocalDirectoryImportPayload>
  ] as ExecutorDefinition[]
}

function validateDependencies(dependencies: ScanExecutorDependencies) {
  if (!dependencies.config.scanRoot.trim()) throw new Error('Scan executor scanRoot is required')
  const excludedRootDirectories =
    dependencies.config.discoveryExcludedRootDirectories ?? DEFAULT_SCAN_DISCOVERY_EXCLUDED_ROOT_DIRECTORIES
  if (
    excludedRootDirectories.length > 100 ||
    excludedRootDirectories.some(
      (item) =>
        !item ||
        item !== item.trim() ||
        item.length > 255 ||
        item === '.' ||
        item === '..' ||
        item.includes('/') ||
        item.includes('\\') ||
        item.includes('\0')
    )
  ) {
    throw new Error('Scan executor discoveryExcludedRootDirectories contains an invalid directory name')
  }
  const limits = { ...DEFAULT_SCAN_LIMITS, ...dependencies.config.limits }
  for (const [name, value, maximum] of [
    ['pageSize', limits.pageSize, 1_000],
    ['maxDepth', limits.maxDepth, 100],
    ['maxDiscoveryEntries', limits.maxDiscoveryEntries, 100_000_000],
    ['maxEntries', limits.maxEntries, 100_000],
    ['maxMediaPerArtwork', limits.maxMediaPerArtwork, 10_000],
    ['concurrency', limits.concurrency, 32],
    ['maxMetadataBytes', limits.maxMetadataBytes, 256 * 1024 * 1024],
    ['maxArchiveMediaBytes', limits.maxArchiveMediaBytes, Number.MAX_SAFE_INTEGER],
    ['maxFullSweepReferences', limits.maxFullSweepReferences, 10_000_000]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
      throw new Error(`Scan executor ${name} must be an integer between 1 and ${maximum}`)
    }
  }
}
