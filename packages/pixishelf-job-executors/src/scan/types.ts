import type { Prisma, PrismaClient } from '@pixishelf/db'
import type { ExecutionLogger } from '@pixishelf/job-runtime'

export interface ScanExecutorLimits {
  pageSize: number
  maxDepth: number
  maxDiscoveryEntries: number
  maxEntries: number
  maxMediaPerArtwork: number
  concurrency: number
  maxMetadataBytes: number
  maxArchiveMediaBytes: number
  maxAuditMissingItems: number
}

export interface ScanExecutorConfig {
  scanRoot: string
  localImportDirectory?: string
  discoveryExcludedRootDirectories?: readonly string[]
  limits?: Partial<ScanExecutorLimits>
  retryDelayMs?: number
}

export type ScanDatabase = Pick<
  PrismaClient,
  | 'artwork'
  | 'artworkExternalRef'
  | 'artworkRawMetadata'
  | 'artworkSourceSnapshot'
  | 'artworkTag'
  | 'artist'
  | 'image'
  | 'scanRun'
  | 'scanRunItem'
  | 'scanRunMetadataInput'
  | 'pixivSourceAuditItem'
  | 'pixivMetadataInventory'
  | 'pixivMetadataInventoryState'
  | 'scanRunLocalWorkInput'
  | 'scanRunLocalArtistMappingInput'
  | 'tag'
>

export type ScanTransaction = Prisma.TransactionClient

export interface ScanExecutorDependencies {
  database: ScanDatabase
  config: ScanExecutorConfig
  now?: () => Date
  logger?: ExecutionLogger
}

export interface ScanExecutionResult {
  scanRunId: string
  total: number
  succeeded: number
  skipped: number
  failed: number
  newImages: number
}

export const DEFAULT_SCAN_LIMITS: ScanExecutorLimits = Object.freeze({
  pageSize: 100,
  maxDepth: 12,
  // Discovery counts every visited directory entry, including media files. Keep this
  // separate from maxEntries, which bounds frozen metadata rows and per-work reads.
  maxDiscoveryEntries: 10_000_000,
  maxEntries: 100_000,
  maxMediaPerArtwork: 2_000,
  concurrency: 4,
  maxMetadataBytes: 16 * 1024 * 1024,
  maxArchiveMediaBytes: 4 * 1024 * 1024 * 1024,
  maxAuditMissingItems: 100_000
})

export const DEFAULT_SCAN_DISCOVERY_EXCLUDED_ROOT_DIRECTORIES = Object.freeze([
  'local-imports',
  'sources',
  '.archive-staging',
  '.trash'
])
