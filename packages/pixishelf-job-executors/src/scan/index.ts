export { createScanExecutorRegistrations } from './executors.ts'
export type { ConsistencyAuditResult } from './consistency-audit-executor.ts'
export type { AuditApplyResult } from './audit-apply-executor.ts'
export {
  artistMappingInputDigest,
  createAuditMetadataDigestAccumulator,
  localWorkInputDigest,
  metadataInputDigest
} from './digests.ts'
export { computeLocalWorkContentFingerprint } from './fingerprint.ts'
export { ScanExecutorError } from './errors.ts'
export type { ScanDiscoveryLimits } from './discovery.ts'
export { DEFAULT_SCAN_DISCOVERY_EXCLUDED_ROOT_DIRECTORIES } from './types.ts'
export type { ScanExecutorConfig, ScanExecutorDependencies, ScanExecutionResult } from './types.ts'
