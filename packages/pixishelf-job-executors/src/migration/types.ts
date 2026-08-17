import type {
  MigrationFilter as ContractMigrationFilter,
  MigrationPayload,
  MigrationSelection as ContractMigrationSelection
} from '@pixishelf/job-contracts'
import type { QueueSqlExecutor } from '@pixishelf/job-runtime'

export type MigrationSelection = ContractMigrationSelection
export type MigrationQueryFilters = ContractMigrationFilter
export type MigrationPayloadV1 = MigrationPayload

export type MigrationItemStatus =
  | 'PENDING'
  | 'RUNNING'
  | 'PAUSED'
  | 'RETRY_WAIT'
  | 'COMPLETED'
  | 'SKIPPED'
  | 'FAILED'
  | 'ACTION_REQUIRED'
  | 'CANCELLED'

export type MigrationItemPhase =
  | 'DISCOVERING'
  | 'STAGING_FILES'
  | 'VERIFYING_FILES'
  | 'PUBLISHING_DATABASE'
  | 'CLEANING_SOURCE'
  | 'FINALIZING'

export type MigrationFileStatus =
  | 'PENDING'
  | 'STAGING'
  | 'STAGED'
  | 'PUBLISHED'
  | 'SOURCE_CLEANUP_PENDING'
  | 'COMPLETED'
  | 'ACTION_REQUIRED'
  | 'FAILED'

export interface MigrationSelectionRow {
  id: number
  deletedAt: Date | null
}

export interface MigrationImageSnapshot {
  id: number
  path: string
  chaptersPath: string | null
}

export interface MigrationArtworkSnapshot {
  id: number
  deletedAt: Date | null
  externalId: string | null
  artistUserId: string | null
  metaSource: string | null
  storagePath: string | null
  images: MigrationImageSnapshot[]
}

export interface MigrationFilePlan {
  id: string
  ordinal: number
  imageId: number | null
  sourceStoredPath: string
  sourceRelativePath: string
  targetStoredPath: string
  targetRelativePath: string
  stagedRelativePath: string
  status: MigrationFileStatus
  attempt: number
  sourceSize: number | null
  sourceMtimeMs: number | null
  sourceSha256: string | null
  stagedSha256: string | null
}

export interface MigrationArtworkPlan {
  id: string
  systemJobId: string
  artworkId: number
  selectionOrdinal: number | null
  status: MigrationItemStatus
  phase: MigrationItemPhase
  attempt: number
  sourceDirectory: string | null
  targetDirectory: string | null
  files: MigrationFilePlan[]
}

export interface CreateMigrationPlanInput {
  systemJobId: string
  artworkId: number
  selectionOrdinal: number | null
  attempt: number
  sourceDirectory: string | null
  targetDirectory: string
  files: Array<{
    ordinal: number
    imageId: number | null
    sourceStoredPath: string
    sourceRelativePath: string
    targetStoredPath: string
    targetRelativePath: string
    stagedRelativePath: string
  }>
}

export interface MigrationItemCheckpoint {
  itemId: string
  status: MigrationItemStatus
  phase: MigrationItemPhase
  attempt: number
  errorCode?: string | null
  errorSummary?: string | null
}

export interface MigrationFileCheckpoint {
  fileId: string
  status: MigrationFileStatus
  attempt: number
  sourceSize?: number | null
  sourceMtimeMs?: number | null
  sourceSha256?: string | null
  stagedSha256?: string | null
  errorCode?: string | null
  errorSummary?: string | null
}

export interface MigrationPublishFile {
  fileId: string
  imageId: number | null
  sourceStoredPath: string
  targetStoredPath: string
  sourceSha256: string | null
}

export interface MigrationResultSample {
  artworkId: number
  externalId: string | null
  code: string
  message: string
}

export interface MigrationSummary {
  total: number
  processed: number
  completed: number
  skipped: number
  failed: number
  actionRequired: number
  cancelled: number
  failedSamples: MigrationResultSample[]
}

export interface MigrationSelectionPageInput {
  selection: MigrationSelection
  afterArtworkId: number
  take: number
}

/**
 * The selection adapter is the single source of truth shared with precheck. It must apply the
 * canonical query filters, `deletedAt IS NULL`, the frozen QUERY upper bound, and strict `id >`
 * keyset pagination. The executor additionally validates those invariants before doing any work.
 */
export interface MigrationSelectionPort {
  count(selection: MigrationSelection): Promise<number>
  precheck(selection: MigrationSelection): Promise<MigrationSelectionPrecheck>
  selectPage(input: MigrationSelectionPageInput): Promise<MigrationSelectionRow[]>
}

export interface MigrationSelectionPrecheck {
  total: number
  eligible: number
  missingArtist: number
  missingExternalId: number
  missingImages: number
}

/**
 * Persistence is deliberately expressed as a narrow port. Every mutating method receives the
 * transaction supplied by ExecutionContext, so item/file checkpoints cannot outlive the fence.
 */
export interface MigrationDatabasePort<TTransaction extends QueueSqlExecutor = QueueSqlExecutor> {
  selection: MigrationSelectionPort
  loadArtwork(artworkId: number, imageLimit: number): Promise<MigrationArtworkSnapshot | null>
  loadPlan(systemJobId: string, artworkId: number, fileLimit: number): Promise<MigrationArtworkPlan | null>
  recordUnplannableItem(
    transaction: TTransaction,
    input: {
      systemJobId: string
      artworkId: number
      selectionOrdinal: number | null
      attempt: number
      status: 'SKIPPED' | 'FAILED' | 'ACTION_REQUIRED'
      errorCode: string
      errorSummary: string
    }
  ): Promise<MigrationArtworkPlan>
  createOrLoadPlan(transaction: TTransaction, input: CreateMigrationPlanInput): Promise<MigrationArtworkPlan>
  checkpointItem(transaction: TTransaction, input: MigrationItemCheckpoint): Promise<void>
  checkpointFile(transaction: TTransaction, input: MigrationFileCheckpoint): Promise<void>
  closeItemAndFiles(
    transaction: TTransaction,
    input: MigrationItemCheckpoint & { status: 'FAILED' | 'CANCELLED' }
  ): Promise<void>
  publishArtwork(
    transaction: TTransaction,
    input: {
      itemId: string
      artworkId: number
      targetDirectory: string
      plannedImageIds: number[]
      attempt: number
      files: MigrationPublishFile[]
      terminalStatus?: 'SKIPPED'
    }
  ): Promise<void>
  summarize(systemJobId: string, sampleLimit: number): Promise<MigrationSummary>
}

export interface MigrationFileStat {
  size: number
  mtimeMs: number
  isFile: boolean
  isDirectory: boolean
  isSymbolicLink: boolean
  /** Stable for the lifetime of a filesystem object (Node uses device + inode). */
  identity: string
}

export interface MigrationFileSystemPort {
  lstat(filePath: string): Promise<MigrationFileStat>
  realpath(filePath: string): Promise<string>
  listDirectoryBounded(directoryPath: string, limit: number): Promise<{ names: string[]; hasMore: boolean }>
  mkdir(directoryPath: string): Promise<void>
  copyFileExclusive(sourcePath: string, targetPath: string): Promise<void>
  hashFile(filePath: string): Promise<string>
  syncFile(filePath: string): Promise<void>
  syncDirectory(directoryPath: string): Promise<void>
  unlink(filePath: string): Promise<void>
}

export interface MigrationRuntimeConfig {
  scanRoot: string
  stagingDirectoryName?: string
  selectionPageSize?: number
  failedSampleLimit?: number
  maxArtworkFiles?: number
  maxDirectoryEntries?: number
}

export interface MigrationExecutorDependencies<TTransaction extends QueueSqlExecutor = QueueSqlExecutor> {
  database: MigrationDatabasePort<TTransaction>
  fileSystem: MigrationFileSystemPort
  config: MigrationRuntimeConfig
  now?: () => Date
}

export class MigrationPermanentError extends Error {
  constructor(
    readonly code:
      | 'INVALID_ARTWORK'
      | 'INVALID_PATH_SEGMENT'
      | 'PATH_OUTSIDE_ALLOWED_ROOT'
      | 'SOURCE_NOT_FOUND'
      | 'SOURCE_CHANGED',
    message: string
  ) {
    super(message)
    this.name = 'MigrationPermanentError'
  }
}

export class MigrationActionRequiredError extends Error {
  constructor(
    readonly code:
      | 'TARGET_CONFLICT'
      | 'STAGING_CONFLICT'
      | 'SOURCE_CHANGED_AFTER_PUBLISH'
      | 'DATABASE_PATH_CONFLICT'
      | 'FILESYSTEM_RECOVERY_FAILED'
      | 'CANDIDATE_LIMIT_EXCEEDED',
    message: string,
    readonly fileId?: string
  ) {
    super(message)
    this.name = 'MigrationActionRequiredError'
  }
}
