import type { Prisma, PrismaClient } from '@pixishelf/db'
import type { ExecutionLogger } from '@pixishelf/job-runtime'

export interface ScanExecutorLimits {
  pageSize: number
  maxDepth: number
  maxEntries: number
  maxMediaPerArtwork: number
  concurrency: number
  maxMetadataBytes: number
  maxArchiveMediaBytes: number
  maxFullSweepReferences: number
}

export interface ScanExecutorConfig {
  scanRoot: string
  localImportDirectory?: string
  limits?: Partial<ScanExecutorLimits>
  retryDelayMs?: number
}

export type ScanDatabase = Pick<
  PrismaClient,
  | 'artwork'
  | 'artworkExternalRef'
  | 'artworkRawMetadata'
  | 'artworkTag'
  | 'artist'
  | 'image'
  | 'scanRun'
  | 'scanRunItem'
  | 'scanRunMetadataInput'
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
  sweptReferences?: number
}

export const DEFAULT_SCAN_LIMITS: ScanExecutorLimits = Object.freeze({
  pageSize: 100,
  maxDepth: 12,
  maxEntries: 100_000,
  maxMediaPerArtwork: 2_000,
  concurrency: 4,
  maxMetadataBytes: 16 * 1024 * 1024,
  maxArchiveMediaBytes: 4 * 1024 * 1024 * 1024,
  maxFullSweepReferences: 100_000
})
