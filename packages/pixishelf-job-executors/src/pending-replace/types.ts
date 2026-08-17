import type { PendingReplacePayload } from '@pixishelf/job-contracts'
import type { QueueSqlExecutor } from '@pixishelf/job-runtime'

export type PendingReplacePayloadV1 = PendingReplacePayload
export type PendingReplaceMode = PendingReplacePayload['mode']

export type PendingReplaceBatchStatus =
  | 'PREVIEWED'
  | 'DISCOVERING'
  | 'RUNNING'
  | 'CANCELLING'
  | 'COMPLETED'
  | 'PARTIAL_FAILED'
  | 'FAILED'
  | 'CANCELLED'

export type PendingReplaceItemStatus =
  | 'READY'
  | 'INVALID'
  | 'EXCLUDED'
  | 'STAGING'
  | 'BACKING_UP'
  | 'SWAPPING'
  | 'COMMITTING'
  | 'ARCHIVING'
  | 'SUCCESS'
  | 'ROLLING_BACK'
  | 'RESTORING'
  | 'RESTORE_SWAPPING'
  | 'RESTORE_COMMITTED'
  | 'CLEANING_BACKUP'
  | 'FAILED'
  | 'RESTORED'
  | 'BACKUP_CLEANED'

export interface PendingReplaceManifestFile {
  name: string
  size: number
  mtimeMs: number
  sha256: string
  kind: 'media' | 'chapter' | 'ignored'
  targetName?: string
  relatedMediaName?: string
}

export interface PendingReplaceMediaSnapshot {
  sourceName: string
  targetName: string
  path: string
  size: number
  sha256: string
  databaseSize?: number | null
  width: number
  height: number
  order: number
  mtimeMs: number
  mediaType?: 'IMAGE' | 'VIDEO' | 'ANIMATION' | 'UNKNOWN' | null
  chaptersPath?: string | null
  chaptersMtimeMs?: number
  chaptersSha256?: string
}

export interface PendingReplaceTargetFileSnapshot {
  name: string
  size: number
  mtimeMs: number
  sha256: string
}

export interface PendingReplaceOperationSnapshot {
  systemJobId: string
  batchId: string
  itemId: string | null
  mode: PendingReplaceMode
}

export interface PendingReplaceBatchSnapshot {
  id: string
  status: PendingReplaceBatchStatus
  sourceRoot: string
  startedAt: Date | null
}

export interface PendingReplaceItemSnapshot {
  id: string
  batchId: string
  artworkId: number | null
  externalId: string | null
  artworkTitle: string | null
  artistName: string | null
  sourceDirectory: string
  sourceDirectoryName: string
  targetDirectory: string | null
  status: PendingReplaceItemStatus
  included: boolean
  fingerprint: string | null
  sourceManifest: unknown
  oldMediaSnapshot: unknown
  newMediaSnapshot: unknown
  targetFileSnapshot: unknown
  warnings: unknown
  backupDirectory: string | null
  completedDirectory: string | null
}

export interface PendingReplaceArtworkSnapshot {
  id: number
  externalId: string | null
  storageKey: string | null
  title: string
  storagePath: string | null
  artistName: string | null
  images: Array<{
    path: string
    sortOrder: number
    width: number | null
    height: number | null
    size: number | null
    mediaType: 'IMAGE' | 'VIDEO' | 'ANIMATION' | 'UNKNOWN'
    chaptersPath: string | null
  }>
}

export interface DiscoveredPendingReplaceItem {
  artworkId: number | null
  externalId: string | null
  artworkTitle: string | null
  artistName: string | null
  sourceDirectory: string
  sourceDirectoryName: string
  targetDirectory: string | null
  status: 'READY' | 'INVALID'
  included: boolean
  fingerprint: string | null
  sourceManifest: PendingReplaceManifestFile[]
  oldMediaSnapshot: PendingReplaceMediaSnapshot[]
  newMediaSnapshot: PendingReplaceMediaSnapshot[]
  targetFileSnapshot: PendingReplaceTargetFileSnapshot[]
  warnings: string[]
  error: string | null
}

export interface PendingReplaceBatchCounters {
  totalItems: number
  readyItems: number
  invalidItems: number
  excludedItems: number
  succeededItems: number
  failedItems: number
  restoredItems: number
  backupBytes: number
}

export interface PendingReplaceItemCheckpoint {
  itemId: string
  expectedStatuses: PendingReplaceItemStatus[]
  status: PendingReplaceItemStatus
  error?: string | null
  backupDirectory?: string | null
  completedDirectory?: string | null
  startedAt?: Date | null
  finishedAt?: Date | null
  backupBytesIncrement?: number
}

export interface PendingReplaceDatabasePort<TTransaction extends QueueSqlExecutor = QueueSqlExecutor> {
  loadOperation(systemJobId: string): Promise<PendingReplaceOperationSnapshot | null>
  loadBatch(batchId: string): Promise<PendingReplaceBatchSnapshot | null>
  loadItems(batchId: string, itemIds?: readonly string[]): Promise<PendingReplaceItemSnapshot[]>
  findArtworksByExternalIds(externalIds: readonly string[]): Promise<PendingReplaceArtworkSnapshot[]>
  createDiscoveredItems(
    transaction: TTransaction,
    input: { systemJobId: string; batchId: string; items: DiscoveredPendingReplaceItem[]; now: Date }
  ): Promise<void>
  checkpointBatch(
    transaction: TTransaction,
    input: {
      systemJobId: string
      batchId: string
      expectedStatuses: PendingReplaceBatchStatus[]
      status: PendingReplaceBatchStatus
      startedAt?: Date | null
      finishedAt?: Date | null
      counters?: PendingReplaceBatchCounters
    }
  ): Promise<void>
  checkpointItem(transaction: TTransaction, input: PendingReplaceItemCheckpoint): Promise<void>
  publishReplacement(
    transaction: TTransaction,
    input: {
      item: PendingReplaceItemSnapshot
      expectedOldMedia: PendingReplaceMediaSnapshot[]
      newMedia: PendingReplaceMediaSnapshot[]
      appendTagIds: number[]
      backupDirectory: string
      completedDirectory: string
      now: Date
      backupBytes: number
    }
  ): Promise<void>
  publishRestore(
    transaction: TTransaction,
    input: {
      item: PendingReplaceItemSnapshot
      expectedNewMedia: PendingReplaceMediaSnapshot[]
      oldMedia: PendingReplaceMediaSnapshot[]
      now: Date
    }
  ): Promise<void>
  assertMediaSnapshot(
    transaction: TTransaction,
    input: { item: PendingReplaceItemSnapshot; expectedMedia: PendingReplaceMediaSnapshot[] }
  ): Promise<void>
  countBatch(batchId: string): Promise<PendingReplaceBatchCounters>
}

export interface PendingReplaceFileStat {
  size: number
  mtimeMs: number
  isFile: boolean
  isDirectory: boolean
  isSymbolicLink: boolean
  identity: string
}

export interface PendingReplaceDirectoryEntry {
  name: string
  isFile: boolean
  isDirectory: boolean
  isSymbolicLink: boolean
}

export interface PendingReplaceFileSystemPort {
  lstat(filePath: string): Promise<PendingReplaceFileStat>
  realpath(filePath: string): Promise<string>
  listDirectoryBounded(
    directoryPath: string,
    limit: number
  ): Promise<{ entries: PendingReplaceDirectoryEntry[]; hasMore: boolean }>
  mkdir(directoryPath: string): Promise<void>
  rename(sourcePath: string, targetPath: string): Promise<void>
  hashFile(filePath: string): Promise<string>
  writeFileExclusive(filePath: string, contents: string): Promise<void>
  readFileBounded(filePath: string, maximumBytes: number): Promise<string>
  unlink(filePath: string): Promise<void>
  removeDirectoryIfEmpty(directoryPath: string): Promise<void>
}

export interface PendingReplaceRuntimeConfig {
  scanRoot: string
  maximumDirectoryEntries?: number
  maximumSnapshotBytes?: number
}

export interface PendingReplaceExecutorDependencies<TTransaction extends QueueSqlExecutor = QueueSqlExecutor> {
  database: PendingReplaceDatabasePort<TTransaction>
  fileSystem: PendingReplaceFileSystemPort
  config: PendingReplaceRuntimeConfig
  now?: () => Date
}

export class PendingReplacePermanentError extends Error {
  constructor(
    readonly code:
      | 'INVALID_OPERATION'
      | 'INVALID_SNAPSHOT'
      | 'PATH_OUTSIDE_SCAN_ROOT'
      | 'SYMLINK_NOT_ALLOWED'
      | 'LIMIT_EXCEEDED'
      | 'SOURCE_CHANGED'
      | 'TARGET_CHANGED'
      | 'DATABASE_CHANGED',
    message: string
  ) {
    super(message)
    this.name = 'PendingReplacePermanentError'
  }
}

export class PendingReplaceActionRequiredError extends Error {
  constructor(
    readonly code: 'FILESYSTEM_RECOVERY_FAILED' | 'BACKUP_CHANGED' | 'PUBLISH_OUTCOME_UNKNOWN',
    message: string,
    readonly itemId?: string
  ) {
    super(message)
    this.name = 'PendingReplaceActionRequiredError'
  }
}
