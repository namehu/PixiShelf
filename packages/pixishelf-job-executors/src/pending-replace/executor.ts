import path from 'node:path'
import type {
  EnqueuedChildJob,
  ExecutionContext,
  FencedExecutionTransaction,
  JobExecutionOutcome,
  QueueSqlExecutor
} from '@pixishelf/job-runtime'
import {
  parsePendingReplaceManifest,
  parsePendingReplaceMedia,
  parsePendingReplaceTargets,
  parsePendingReplaceWarnings
} from './schemas.js'
import {
  assertExactSnapshotDirectory,
  assertSnapshotFiles,
  installedSnapshots,
  moveCheckpointFile,
  moveDirectoryIdempotent,
  removeExactSnapshotFiles,
  verifyManifestAcrossWorkspaces
} from './file-operations.js'
import {
  BACKUP_DIRECTORY,
  buildArtworkSnapshots,
  buildInstalledMedia,
  COMPLETED_DIRECTORY,
  createManifestFingerprint,
  MANIFEST_FILE,
  parsePendingDirectoryName,
  PENDING_DIRECTORY,
  scanPendingSource,
  WORK_DIRECTORY
} from './snapshot.js'
import {
  assertDistinctPaths,
  caseFoldPath,
  normalizeStoredRelativePath,
  resolveSafeCreatablePath,
  resolveSafeExistingPath,
  toStoredPath
} from './paths.js'
import type {
  DiscoveredPendingReplaceItem,
  PendingReplaceBatchCounters,
  PendingReplaceExecutorDependencies,
  PendingReplaceItemSnapshot,
  PendingReplaceItemStatus,
  PendingReplaceManifestFile,
  PendingReplaceMediaSnapshot,
  PendingReplacePayloadV1,
  PendingReplaceTargetFileSnapshot
} from './types.js'
import { PendingReplaceActionRequiredError, PendingReplacePermanentError } from './types.js'

type PendingContext = ExecutionContext<PendingReplacePayloadV1, EnqueuedChildJob>
type PendingScope<TTransaction extends QueueSqlExecutor> = FencedExecutionTransaction<TTransaction>

export async function executePendingReplace<TTransaction extends QueueSqlExecutor>(
  context: PendingContext,
  dependencies: PendingReplaceExecutorDependencies<TTransaction>
): Promise<JobExecutionOutcome> {
  try {
    const operation = await dependencies.database.loadOperation(context.job.id)
    assertExactOperation(context, operation)
    switch (context.payload.mode) {
      case 'DISCOVER': {
        const payload = context.payload
        return await executeDiscover({ ...context, payload }, dependencies)
      }
      case 'BATCH': {
        const payload = context.payload
        return await executeBatch({ ...context, payload }, dependencies)
      }
      case 'RESTORE': {
        const payload = context.payload
        return await executeRestore({ ...context, payload }, dependencies)
      }
      case 'CLEANUP': {
        const payload = context.payload
        return await executeCleanup({ ...context, payload }, dependencies)
      }
    }
  } catch (error) {
    context.logger.error('Pending replacement execution failed', error, { code: stableErrorCode(error) })
    if (error instanceof PendingReplaceActionRequiredError) {
      return context.finalizeInTransaction<TTransaction>(async (scope) => {
        await checkpointBatchForControl(scope, dependencies, context.job.id, context.payload.batchId, 'PREVIEWED')
        await scope.pause({
          reason: 'ACTION_REQUIRED',
          message: `Pending replacement requires manual recovery (${error.code})`,
          data: { code: error.code, itemId: error.itemId ?? null }
        })
      })
    }
    if (context.signal.aborted) {
      return context.finalizeInTransaction<TTransaction>(async (scope) => {
        if (await finalizeRequestedControl(scope, dependencies, context)) return
        await checkpointBatchForControl(scope, dependencies, context.job.id, context.payload.batchId, 'PREVIEWED')
        await scope.release('Pending replacement worker stopped at a durable checkpoint')
      })
    }
    return context.finalizeInTransaction<TTransaction>(async (scope) => {
      if (await finalizeRequestedControl(scope, dependencies, context)) return
      await checkpointBatchForControl(scope, dependencies, context.job.id, context.payload.batchId, 'FAILED')
      await scope.fail({
        errorCode: errorCodeFor(error),
        error: stableErrorCode(error),
        message: 'Pending replacement failed; details are available in the rotating worker log'
      })
    })
  }
}

async function executeDiscover<TTransaction extends QueueSqlExecutor>(
  context: PendingContext & { payload: Extract<PendingReplacePayloadV1, { mode: 'DISCOVER' }> },
  dependencies: PendingReplaceExecutorDependencies<TTransaction>
) {
  const now = dependencies.now ?? (() => new Date())
  await context.mutateInTransaction<TTransaction>((transaction) =>
    dependencies.database.checkpointBatch(transaction, {
      systemJobId: context.job.id,
      batchId: context.payload.batchId,
      expectedStatuses: ['PREVIEWED', 'DISCOVERING'],
      status: 'DISCOVERING',
      startedAt: now()
    })
  )
  const pendingAbsolute = await resolveSafeCreatablePath(
    dependencies.fileSystem,
    dependencies.config.scanRoot,
    PENDING_DIRECTORY
  )
  await dependencies.fileSystem.mkdir(pendingAbsolute)
  const safePendingRoot = await resolveSafeExistingPath(
    dependencies.fileSystem,
    dependencies.config.scanRoot,
    PENDING_DIRECTORY,
    'directory'
  )
  const limit = dependencies.config.maximumDirectoryEntries ?? 1_234
  const listed = await dependencies.fileSystem.listDirectoryBounded(safePendingRoot, limit)
  if (listed.hasMore)
    throw new PendingReplacePermanentError('LIMIT_EXCEEDED', 'Pending root exceeds the directory limit')
  const directories = listed.entries
    .filter((entry) => !entry.name.startsWith('.') && (entry.isDirectory || entry.isSymbolicLink))
    .sort((left, right) => left.name.localeCompare(right.name, 'en'))
  const parsedIds = directories.flatMap((entry) => {
    const externalId = parsePendingDirectoryName(entry.name)
    return externalId ? [externalId] : []
  })
  const duplicateIds = new Set(parsedIds.filter((id, index) => parsedIds.indexOf(id) !== index))
  const artworks = await dependencies.database.findArtworksByExternalIds([...new Set(parsedIds)])
  const byExternalId = new Map(
    artworks.flatMap((artwork) => {
      const keys = [artwork.storageKey, artwork.externalId].filter((value): value is string => Boolean(value))
      return keys.map((key) => [key, artwork] as const)
    })
  )
  const items: DiscoveredPendingReplaceItem[] = []
  for (let index = 0; index < directories.length; index += 1) {
    throwIfAborted(context.signal)
    const directory = directories[index]!
    const externalId = parsePendingDirectoryName(directory.name)
    const artwork = externalId && !duplicateIds.has(externalId) ? byExternalId.get(externalId) : undefined
    const errors: string[] = []
    let scanned = {
      manifest: [] as PendingReplaceManifestFile[],
      media: [] as PendingReplaceMediaSnapshot[],
      warnings: [] as string[]
    }
    if (directory.isSymbolicLink) errors.push('SYMLINK_NOT_ALLOWED')
    if (!externalId) errors.push('INVALID_DIRECTORY_NAME')
    if (externalId && duplicateIds.has(externalId)) errors.push('DUPLICATE_EXTERNAL_ID')
    if (externalId && !artwork) errors.push('ARTWORK_NOT_FOUND')
    if (errors.length === 0) {
      try {
        scanned = await scanPendingSource(dependencies, directory.name, externalId!)
        if (scanned.media.length === 0) errors.push('NO_SUPPORTED_MEDIA')
      } catch (error) {
        errors.push(stableErrorCode(error))
      }
    }
    let targetDirectory: string | null = null
    let oldMedia: PendingReplaceMediaSnapshot[] = []
    let targetFiles: PendingReplaceTargetFileSnapshot[] = []
    if (artwork) {
      try {
        const target = await buildArtworkSnapshots(dependencies, artwork)
        targetDirectory = target.targetDirectory
        oldMedia = target.oldMedia
        targetFiles = target.targetFiles
      } catch (error) {
        errors.push(stableErrorCode(error))
      }
    }
    const valid = errors.length === 0
    items.push({
      artworkId: artwork?.id ?? null,
      externalId,
      artworkTitle: artwork?.title ?? null,
      artistName: artwork?.artistName ?? null,
      sourceDirectory: toStoredPath(path.posix.join(PENDING_DIRECTORY, directory.name)),
      sourceDirectoryName: directory.name,
      targetDirectory,
      status: valid ? 'READY' : 'INVALID',
      included: valid,
      fingerprint: scanned.manifest.length > 0 ? createManifestFingerprint(scanned.manifest) : null,
      sourceManifest: scanned.manifest,
      oldMediaSnapshot: oldMedia,
      newMediaSnapshot: scanned.media,
      targetFileSnapshot: targetFiles,
      warnings: scanned.warnings,
      error: valid ? null : errors.slice(0, 8).join(',')
    })
    await context.progress({
      progress: Math.floor(((index + 1) / Math.max(directories.length, 1)) * 95),
      stage: 'DISCOVERING',
      message: `Discovered ${index + 1}/${directories.length} pending replacement directories`
    })
  }
  return context.finalizeInTransaction<TTransaction>(async (scope) => {
    if (await finalizeRequestedControl(scope, dependencies, context)) return
    await dependencies.database.createDiscoveredItems(scope.transaction, {
      systemJobId: context.job.id,
      batchId: context.payload.batchId,
      items,
      now: now()
    })
    await scope.complete({
      result: {
        batchId: context.payload.batchId,
        total: items.length,
        ready: items.filter((item) => item.included).length
      },
      message: `Pending replacement discovery completed (${items.length} items)`
    })
  })
}

async function executeBatch<TTransaction extends QueueSqlExecutor>(
  context: PendingContext & { payload: Extract<PendingReplacePayloadV1, { mode: 'BATCH' }> },
  dependencies: PendingReplaceExecutorDependencies<TTransaction>
) {
  const now = dependencies.now ?? (() => new Date())
  const items = await dependencies.database.loadItems(context.payload.batchId, context.payload.itemIds)
  assertExactItemSelection(items, context.payload.itemIds)
  await context.mutateInTransaction<TTransaction>((transaction) =>
    dependencies.database.checkpointBatch(transaction, {
      systemJobId: context.job.id,
      batchId: context.payload.batchId,
      expectedStatuses: ['PREVIEWED', 'RUNNING', 'PARTIAL_FAILED'],
      status: 'RUNNING',
      startedAt: now(),
      finishedAt: null
    })
  )
  for (let index = 0; index < items.length; index += 1) {
    throwIfAborted(context.signal)
    const item = items[index]!
    if (!item.included || ['EXCLUDED', 'SUCCESS', 'BACKUP_CLEANED'].includes(item.status)) continue
    try {
      await processReplacementItem(context, dependencies, item, context.payload.appendTagIds)
    } catch (error) {
      if (error instanceof PendingReplaceActionRequiredError) throw error
      if (context.signal.aborted) throw error
      context.logger.warn('Pending replacement item failed', { itemId: item.id, code: stableErrorCode(error) })
    }
    await context.progress({
      progress: Math.floor(((index + 1) / items.length) * 95),
      stage: 'REPLACING',
      message: `Processed ${index + 1}/${items.length} replacement items`
    })
  }
  const counters = await dependencies.database.countBatch(context.payload.batchId)
  return context.finalizeInTransaction<TTransaction>(async (scope) => {
    if (await finalizeRequestedControl(scope, dependencies, context)) return
    await dependencies.database.checkpointBatch(scope.transaction, {
      systemJobId: context.job.id,
      batchId: context.payload.batchId,
      expectedStatuses: ['RUNNING', 'PARTIAL_FAILED'],
      status: counters.failedItems > 0 ? 'PARTIAL_FAILED' : 'COMPLETED',
      finishedAt: now(),
      counters
    })
    await scope.complete({
      result: resultFromCounters(context.payload.batchId, counters),
      message: 'Pending replacement batch completed'
    })
  })
}

async function processReplacementItem<TTransaction extends QueueSqlExecutor>(
  context: PendingContext,
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  item: PendingReplaceItemSnapshot,
  appendTagIds: number[]
) {
  const maximumBytes = dependencies.config.maximumSnapshotBytes
  const manifest = parsePendingReplaceManifest(item.sourceManifest, maximumBytes)
  const oldMedia = parsePendingReplaceMedia(item.oldMediaSnapshot, maximumBytes)
  const newMedia = parsePendingReplaceMedia(item.newMediaSnapshot, maximumBytes)
  const targetFiles = parsePendingReplaceTargets(item.targetFileSnapshot, maximumBytes)
  parsePendingReplaceWarnings(item.warnings, maximumBytes)
  assertCompleteItem(item, manifest, newMedia)
  const paths = itemPaths(item)
  assertItemPathsDistinct(paths)
  let published = ['ARCHIVING', 'SUCCESS', 'BACKUP_CLEANED'].includes(item.status)
  try {
    if (!published) {
      if (item.status === 'ROLLING_BACK') {
        await rollbackReplacement(dependencies, manifest, targetFiles, paths)
        await checkpointItem(context, dependencies, item.id, ['ROLLING_BACK'], 'FAILED', {
          error: 'INTERRUPTED_BEFORE_DATABASE_PUBLISH',
          backupDirectory: null,
          finishedAt: new Date()
        })
        return
      }
      if (['READY', 'FAILED', 'STAGING'].includes(item.status)) {
        if (item.status === 'READY' || item.status === 'FAILED') {
          await assertSnapshotFiles(
            dependencies,
            paths.pendingSource,
            manifest.map((file) => ({ name: file.name, size: file.size, sha256: file.sha256 })),
            'SOURCE_CHANGED'
          )
          await assertSnapshotFiles(dependencies, paths.target, targetFiles, 'TARGET_CHANGED')
        }
        await checkpointItem(context, dependencies, item.id, ['READY', 'FAILED', 'STAGING'], 'STAGING', {
          startedAt: new Date(),
          error: null
        })
        await stageSource(dependencies, item, manifest, newMedia, paths, context.signal)
        await checkpointItem(context, dependencies, item.id, ['STAGING'], 'BACKING_UP', {
          backupDirectory: toStoredPath(paths.backup)
        })
      }
      if (['READY', 'FAILED', 'STAGING', 'BACKING_UP'].includes(item.status)) {
        await backupTarget(dependencies, targetFiles, paths, context.signal)
        await checkpointItem(context, dependencies, item.id, ['BACKING_UP'], 'SWAPPING')
      }
      if (['READY', 'FAILED', 'STAGING', 'BACKING_UP', 'SWAPPING'].includes(item.status)) {
        await installReplacement(dependencies, manifest, paths, context.signal)
        await checkpointItem(context, dependencies, item.id, ['SWAPPING'], 'COMMITTING')
      }
      await verifyReplacementPrePublish(dependencies, manifest, targetFiles, newMedia, paths)
      const installedMedia = buildInstalledMedia(item.targetDirectory!, newMedia, manifest)
      await context.mutateInTransaction<TTransaction>((transaction) =>
        dependencies.database.publishReplacement(transaction, {
          item,
          expectedOldMedia: oldMedia,
          newMedia: installedMedia,
          appendTagIds,
          backupDirectory: toStoredPath(paths.backup),
          completedDirectory: toStoredPath(paths.completed),
          now: new Date(),
          backupBytes: targetFiles.reduce((total, file) => total + file.size, 0)
        })
      )
      published = true
    }
    await archiveSource(dependencies, item, manifest, paths)
    await checkpointItem(context, dependencies, item.id, ['ARCHIVING', 'SUCCESS'], 'SUCCESS', {
      backupDirectory: toStoredPath(paths.backup),
      completedDirectory: toStoredPath(paths.completed),
      finishedAt: new Date()
    })
  } catch (error) {
    if (published) {
      if (error instanceof PendingReplaceActionRequiredError) throw error
      context.logger.warn('Replacement committed but source archive remains recoverable', {
        itemId: item.id,
        code: stableErrorCode(error)
      })
      return
    }
    await checkpointItem(context, dependencies, item.id, replaceActiveStatuses(), 'ROLLING_BACK', {
      error: stableErrorCode(error)
    }).catch(() => undefined)
    try {
      await rollbackReplacement(dependencies, manifest, targetFiles, paths)
    } catch (rollbackError) {
      throw new PendingReplaceActionRequiredError(
        'FILESYSTEM_RECOVERY_FAILED',
        'Replacement rollback could not restore both copies',
        item.id
      )
    }
    await checkpointItem(
      context,
      dependencies,
      item.id,
      ['ROLLING_BACK', 'STAGING', 'BACKING_UP', 'SWAPPING', 'COMMITTING'],
      'FAILED',
      {
        error: stableErrorCode(error),
        backupDirectory: null,
        finishedAt: new Date()
      }
    )
  }
}

async function executeRestore<TTransaction extends QueueSqlExecutor>(
  context: PendingContext & { payload: Extract<PendingReplacePayloadV1, { mode: 'RESTORE' }> },
  dependencies: PendingReplaceExecutorDependencies<TTransaction>
) {
  const [item] = await dependencies.database.loadItems(context.payload.batchId, [context.payload.itemId])
  if (!item || item.id !== context.payload.itemId)
    throw new PendingReplacePermanentError('INVALID_OPERATION', 'Restore item is not in the operation batch')
  await processRestoreItem(context, dependencies, item)
  const counters = await dependencies.database.countBatch(context.payload.batchId)
  return context.finalizeInTransaction<TTransaction>(async (scope) => {
    if (await finalizeRequestedControl(scope, dependencies, context)) return
    await dependencies.database.checkpointBatch(scope.transaction, {
      systemJobId: context.job.id,
      batchId: context.payload.batchId,
      expectedStatuses: ['PREVIEWED', 'RUNNING', 'COMPLETED', 'PARTIAL_FAILED', 'FAILED', 'CANCELLED'],
      status: counters.failedItems > 0 ? 'PARTIAL_FAILED' : 'COMPLETED',
      finishedAt: new Date(),
      counters
    })
    await scope.complete({ result: { batchId: context.payload.batchId, itemId: item.id, restored: true } })
  })
}

async function processRestoreItem<TTransaction extends QueueSqlExecutor>(
  context: PendingContext,
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  item: PendingReplaceItemSnapshot
) {
  if (!item.targetDirectory || !item.backupDirectory) {
    throw new PendingReplacePermanentError('INVALID_SNAPSHOT', 'Restore item has no target or backup checkpoint')
  }
  const maximumBytes = dependencies.config.maximumSnapshotBytes
  const manifest = parsePendingReplaceManifest(item.sourceManifest, maximumBytes)
  const oldMedia = parsePendingReplaceMedia(item.oldMediaSnapshot, maximumBytes)
  const newMedia = parsePendingReplaceMedia(item.newMediaSnapshot, maximumBytes)
  const targetFiles = parsePendingReplaceTargets(item.targetFileSnapshot, maximumBytes)
  const paths = persistedRestorePaths(item)
  const installed = installedSnapshots(newMedia)
  let published = ['RESTORE_COMMITTED', 'RESTORED'].includes(item.status)
  try {
    if (!published) {
      if (item.status === 'SUCCESS' || item.status === 'RESTORING') {
        await checkpointItem(context, dependencies, item.id, ['SUCCESS', 'RESTORING'], 'RESTORING', {
          startedAt: new Date(),
          error: null
        })
        await assertSnapshotFiles(dependencies, paths.backup, targetFiles, 'BACKUP_CHANGED')
        await dependencies.fileSystem.mkdir(
          await resolveSafeCreatablePath(dependencies.fileSystem, dependencies.config.scanRoot, paths.pendingSource)
        )
        for (const media of newMedia) {
          throwIfAborted(context.signal)
          await moveCheckpointFile(
            dependencies,
            path.posix.join(paths.target, media.targetName),
            path.posix.join(paths.pendingSource, media.sourceName),
            media,
            'TARGET_CHANGED'
          )
        }
        for (const chapter of manifest.filter((file) => file.kind === 'chapter' && file.targetName)) {
          throwIfAborted(context.signal)
          await moveCheckpointFile(
            dependencies,
            path.posix.join(paths.target, chapter.targetName!),
            path.posix.join(paths.pendingSource, chapter.name),
            chapter,
            'TARGET_CHANGED'
          )
        }
        await checkpointItem(context, dependencies, item.id, ['RESTORING'], 'RESTORE_SWAPPING')
      }
      await assertExactSnapshotDirectory(dependencies, paths.backup, targetFiles, {
        allowAlreadyRemoved: item.status === 'RESTORE_SWAPPING'
      })
      for (const target of targetFiles) {
        throwIfAborted(context.signal)
        await moveCheckpointFile(
          dependencies,
          path.posix.join(paths.backup, target.name),
          path.posix.join(paths.target, target.name),
          target,
          'BACKUP_CHANGED'
        )
      }
      await assertSnapshotFiles(dependencies, paths.target, targetFiles, 'TARGET_CHANGED')
      await context.mutateInTransaction<TTransaction>((transaction) =>
        dependencies.database.publishRestore(transaction, {
          item,
          expectedNewMedia: buildInstalledMedia(item.targetDirectory!, newMedia, manifest),
          oldMedia,
          now: new Date()
        })
      )
      published = true
    }
    await dependencies.fileSystem.removeDirectoryIfEmpty(
      await resolveSafeCreatablePath(dependencies.fileSystem, dependencies.config.scanRoot, paths.backup)
    )
    await checkpointItem(context, dependencies, item.id, ['RESTORE_COMMITTED', 'RESTORED'], 'RESTORED', {
      backupDirectory: null,
      finishedAt: new Date()
    })
  } catch (error) {
    if (published) return
    try {
      for (const target of [...targetFiles].reverse()) {
        await moveCheckpointFile(
          dependencies,
          path.posix.join(paths.target, target.name),
          path.posix.join(paths.backup, target.name),
          target,
          'TARGET_CHANGED'
        )
      }
      for (const media of [...newMedia].reverse()) {
        await moveCheckpointFile(
          dependencies,
          path.posix.join(paths.pendingSource, media.sourceName),
          path.posix.join(paths.target, media.targetName),
          media,
          'SOURCE_CHANGED'
        )
      }
      for (const chapter of [...manifest].reverse().filter((file) => file.kind === 'chapter' && file.targetName)) {
        await moveCheckpointFile(
          dependencies,
          path.posix.join(paths.pendingSource, chapter.name),
          path.posix.join(paths.target, chapter.targetName!),
          chapter,
          'SOURCE_CHANGED'
        )
      }
    } catch {
      throw new PendingReplaceActionRequiredError(
        'FILESYSTEM_RECOVERY_FAILED',
        'Restore rollback could not preserve both versions',
        item.id
      )
    }
    await checkpointItem(context, dependencies, item.id, ['RESTORING', 'RESTORE_SWAPPING'], 'SUCCESS', {
      error: stableErrorCode(error),
      finishedAt: new Date()
    })
    throw error
  }
}

async function executeCleanup<TTransaction extends QueueSqlExecutor>(
  context: PendingContext & { payload: Extract<PendingReplacePayloadV1, { mode: 'CLEANUP' }> },
  dependencies: PendingReplaceExecutorDependencies<TTransaction>
) {
  const items = await dependencies.database.loadItems(context.payload.batchId)
  const candidates = items.filter((item) => item.status === 'SUCCESS' || item.status === 'CLEANING_BACKUP')
  for (let index = 0; index < candidates.length; index += 1) {
    throwIfAborted(context.signal)
    const item = candidates[index]!
    if (!item.backupDirectory || !item.targetDirectory) continue
    const paths = persistedRestorePaths(item)
    const maximumBytes = dependencies.config.maximumSnapshotBytes
    const manifest = parsePendingReplaceManifest(item.sourceManifest, maximumBytes)
    const targetFiles = parsePendingReplaceTargets(item.targetFileSnapshot, maximumBytes)
    const newMedia = parsePendingReplaceMedia(item.newMediaSnapshot, maximumBytes)
    await assertSnapshotFiles(dependencies, paths.target, installedSnapshots(newMedia), 'TARGET_CHANGED')
    if (item.status === 'SUCCESS') {
      await assertSnapshotFiles(dependencies, paths.backup, targetFiles, 'BACKUP_CHANGED')
    }
    await context.mutateInTransaction<TTransaction>(async (transaction) => {
      await dependencies.database.assertMediaSnapshot(transaction, {
        item,
        expectedMedia: buildInstalledMedia(item.targetDirectory!, newMedia, manifest)
      })
      await dependencies.database.checkpointItem(transaction, {
        itemId: item.id,
        expectedStatuses: ['SUCCESS', 'CLEANING_BACKUP'],
        status: 'CLEANING_BACKUP'
      })
    })
    await removeExactSnapshotFiles(dependencies, paths.backup, targetFiles, {
      allowAlreadyRemoved: item.status === 'CLEANING_BACKUP'
    })
    await checkpointItem(context, dependencies, item.id, ['CLEANING_BACKUP'], 'BACKUP_CLEANED', {
      backupDirectory: null,
      finishedAt: new Date()
    })
    await context.progress({
      progress: Math.floor(((index + 1) / Math.max(candidates.length, 1)) * 95),
      stage: 'CLEANING_BACKUPS',
      message: `Cleaned ${index + 1}/${candidates.length} verified backups`
    })
  }
  return context.finalizeInTransaction<TTransaction>(async (scope) => {
    if (await finalizeRequestedControl(scope, dependencies, context)) return
    await dependencies.database.checkpointBatch(scope.transaction, {
      systemJobId: context.job.id,
      batchId: context.payload.batchId,
      expectedStatuses: ['PREVIEWED', 'RUNNING', 'COMPLETED', 'PARTIAL_FAILED', 'FAILED', 'CANCELLED'],
      status: 'COMPLETED',
      finishedAt: new Date()
    })
    await scope.complete({ result: { batchId: context.payload.batchId, cleaned: candidates.length } })
  })
}

async function stageSource<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  item: PendingReplaceItemSnapshot,
  manifest: PendingReplaceManifestFile[],
  newMedia: PendingReplaceMediaSnapshot[],
  paths: ItemPaths,
  signal: AbortSignal
) {
  await moveDirectoryIdempotent(dependencies, paths.pendingSource, paths.workSource)
  await dependencies.fileSystem.mkdir(
    await resolveSafeCreatablePath(dependencies.fileSystem, dependencies.config.scanRoot, paths.normalized)
  )
  const manifestByName = new Map(manifest.map((entry) => [entry.name, entry]))
  for (const media of newMedia) {
    throwIfAborted(signal)
    const file = manifestByName.get(media.sourceName)
    if (!file || file.kind !== 'media' || file.sha256 !== media.sha256) {
      throw new PendingReplacePermanentError('INVALID_SNAPSHOT', 'Media snapshot does not match its manifest')
    }
    await moveCheckpointFile(
      dependencies,
      path.posix.join(paths.workSource, media.sourceName),
      path.posix.join(paths.normalized, media.targetName),
      media,
      'SOURCE_CHANGED'
    )
  }
  for (const chapter of manifest.filter((entry) => entry.kind === 'chapter')) {
    throwIfAborted(signal)
    if (!chapter.targetName)
      throw new PendingReplacePermanentError('INVALID_SNAPSHOT', 'Chapter target name is missing')
    await moveCheckpointFile(
      dependencies,
      path.posix.join(paths.workSource, chapter.name),
      path.posix.join(paths.normalized, chapter.targetName),
      chapter,
      'SOURCE_CHANGED'
    )
  }
  await verifyManifestAcrossWorkspaces(dependencies, paths.workSource, paths.normalized, manifest)
  if (createManifestFingerprint(manifest) !== item.fingerprint) {
    throw new PendingReplacePermanentError('SOURCE_CHANGED', 'Persisted manifest fingerprint does not match')
  }
}

async function backupTarget<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  targetFiles: PendingReplaceTargetFileSnapshot[],
  paths: ItemPaths,
  signal: AbortSignal
) {
  await dependencies.fileSystem.mkdir(
    await resolveSafeCreatablePath(dependencies.fileSystem, dependencies.config.scanRoot, paths.target)
  )
  await dependencies.fileSystem.mkdir(
    await resolveSafeCreatablePath(dependencies.fileSystem, dependencies.config.scanRoot, paths.backup)
  )
  for (const file of targetFiles) {
    throwIfAborted(signal)
    await moveCheckpointFile(
      dependencies,
      path.posix.join(paths.target, file.name),
      path.posix.join(paths.backup, file.name),
      file,
      'TARGET_CHANGED'
    )
  }
}

async function installReplacement<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  manifest: PendingReplaceManifestFile[],
  paths: ItemPaths,
  signal: AbortSignal
) {
  for (const file of manifest.filter((entry) => entry.kind !== 'ignored')) {
    throwIfAborted(signal)
    if (!file.targetName) throw new PendingReplacePermanentError('INVALID_SNAPSHOT', 'Install target name is missing')
    await moveCheckpointFile(
      dependencies,
      path.posix.join(paths.normalized, file.targetName),
      path.posix.join(paths.target, file.targetName),
      file,
      'TARGET_CHANGED'
    )
  }
}

async function verifyReplacementPrePublish<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  manifest: PendingReplaceManifestFile[],
  targetFiles: PendingReplaceTargetFileSnapshot[],
  newMedia: PendingReplaceMediaSnapshot[],
  paths: ItemPaths
) {
  await assertSnapshotFiles(dependencies, paths.target, installedSnapshots(newMedia), 'TARGET_CHANGED')
  await assertSnapshotFiles(dependencies, paths.backup, targetFiles, 'BACKUP_CHANGED')
  for (const chapter of manifest.filter((entry) => entry.kind === 'chapter' && entry.targetName)) {
    await assertSnapshotFiles(
      dependencies,
      paths.target,
      [{ name: chapter.targetName!, size: chapter.size, sha256: chapter.sha256 }],
      'TARGET_CHANGED'
    )
  }
  await assertSnapshotFiles(
    dependencies,
    paths.workSource,
    manifest
      .filter((entry) => entry.kind === 'ignored')
      .map((entry) => ({ name: entry.name, size: entry.size, sha256: entry.sha256 })),
    'SOURCE_CHANGED'
  )
}

async function archiveSource<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  item: PendingReplaceItemSnapshot,
  manifest: PendingReplaceManifestFile[],
  paths: ItemPaths
) {
  const completed = await resolveSafeCreatablePath(
    dependencies.fileSystem,
    dependencies.config.scanRoot,
    paths.completed
  )
  await dependencies.fileSystem.mkdir(completed)
  const manifestPath = path.posix.join(paths.completed, MANIFEST_FILE)
  const manifestAbsolute = await resolveSafeCreatablePath(
    dependencies.fileSystem,
    dependencies.config.scanRoot,
    manifestPath
  )
  try {
    await dependencies.fileSystem.writeFileExclusive(
      manifestAbsolute,
      JSON.stringify({ version: 1, itemId: item.id, fingerprint: item.fingerprint, files: manifest })
    )
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    const persisted = await dependencies.fileSystem.readFileBounded(manifestAbsolute, 2 * 1024 * 1024)
    const parsed = JSON.parse(persisted) as { itemId?: unknown; fingerprint?: unknown }
    if (parsed.itemId !== item.id || parsed.fingerprint !== item.fingerprint) {
      throw new PendingReplaceActionRequiredError(
        'FILESYSTEM_RECOVERY_FAILED',
        'Archive manifest belongs to another attempt',
        item.id
      )
    }
  }
  // Only ignored source files remain in work/source. Move them one by one so an existing archive
  // can be checked and resumed without recursively deleting either copy.
  for (const file of manifest.filter((entry) => entry.kind === 'ignored')) {
    await moveCheckpointFile(
      dependencies,
      path.posix.join(paths.workSource, file.name),
      path.posix.join(paths.completed, file.name),
      file,
      'SOURCE_CHANGED'
    )
  }
}

async function rollbackReplacement<TTransaction extends QueueSqlExecutor>(
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  manifest: PendingReplaceManifestFile[],
  targetFiles: PendingReplaceTargetFileSnapshot[],
  paths: ItemPaths
) {
  for (const file of [...manifest].reverse().filter((entry) => entry.kind !== 'ignored' && entry.targetName)) {
    await moveCheckpointFile(
      dependencies,
      path.posix.join(paths.target, file.targetName!),
      path.posix.join(paths.normalized, file.targetName!),
      file,
      'TARGET_CHANGED'
    ).catch(async (error) => {
      // A pre-swap failure legitimately has the file in normalized already.
      await assertSnapshotFiles(
        dependencies,
        paths.normalized,
        [{ name: file.targetName!, size: file.size, sha256: file.sha256 }],
        'SOURCE_CHANGED'
      )
      if (error instanceof PendingReplaceActionRequiredError) throw error
    })
  }
  for (const file of [...targetFiles].reverse()) {
    await moveCheckpointFile(
      dependencies,
      path.posix.join(paths.backup, file.name),
      path.posix.join(paths.target, file.name),
      file,
      'BACKUP_CHANGED'
    ).catch(async (error) => {
      await assertSnapshotFiles(dependencies, paths.target, [file], 'TARGET_CHANGED')
      if (error instanceof PendingReplaceActionRequiredError) throw error
    })
  }
  for (const file of [...manifest].reverse().filter((entry) => entry.kind !== 'ignored' && entry.targetName)) {
    await moveCheckpointFile(
      dependencies,
      path.posix.join(paths.normalized, file.targetName!),
      path.posix.join(paths.workSource, file.name),
      file,
      'SOURCE_CHANGED'
    )
  }
  await moveDirectoryIdempotent(dependencies, paths.workSource, paths.pendingSource)
}

async function checkpointItem<TTransaction extends QueueSqlExecutor>(
  context: PendingContext,
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  itemId: string,
  expectedStatuses: PendingReplaceItemStatus[],
  status: PendingReplaceItemStatus,
  extra: Omit<
    Parameters<PendingReplaceExecutorDependencies<TTransaction>['database']['checkpointItem']>[1],
    'itemId' | 'expectedStatuses' | 'status'
  > = {}
) {
  return context.mutateInTransaction<TTransaction>((transaction) =>
    dependencies.database.checkpointItem(transaction, { itemId, expectedStatuses, status, ...extra })
  )
}

async function finalizeRequestedControl<TTransaction extends QueueSqlExecutor>(
  scope: PendingScope<TTransaction>,
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  context: PendingContext
) {
  if (scope.executionStatus === 'CANCELLING') {
    await checkpointBatchForControl(scope, dependencies, context.job.id, context.payload.batchId, 'CANCELLED')
    await scope.cancel('Pending replacement cancelled at a durable checkpoint')
    return true
  }
  if (scope.executionStatus === 'PAUSING') {
    await checkpointBatchForControl(scope, dependencies, context.job.id, context.payload.batchId, 'PREVIEWED')
    await scope.pause({ reason: 'USER_REQUESTED', message: 'Pending replacement paused at a durable checkpoint' })
    return true
  }
  return false
}

async function checkpointBatchForControl<TTransaction extends QueueSqlExecutor>(
  scope: PendingScope<TTransaction>,
  dependencies: PendingReplaceExecutorDependencies<TTransaction>,
  systemJobId: string,
  batchId: string,
  status: 'PREVIEWED' | 'FAILED' | 'CANCELLED'
) {
  await dependencies.database.checkpointBatch(scope.transaction, {
    systemJobId,
    batchId,
    expectedStatuses: [
      'PREVIEWED',
      'DISCOVERING',
      'RUNNING',
      'CANCELLING',
      'COMPLETED',
      'PARTIAL_FAILED',
      'FAILED',
      'CANCELLED'
    ],
    status,
    ...(status === 'FAILED' || status === 'CANCELLED' ? { finishedAt: new Date() } : { finishedAt: null })
  })
}

function assertExactOperation(
  context: PendingContext,
  operation: Awaited<ReturnType<PendingReplaceExecutorDependencies['database']['loadOperation']>>
) {
  if (
    !operation ||
    operation.systemJobId !== context.job.id ||
    operation.batchId !== context.payload.batchId ||
    operation.mode !== context.payload.mode
  ) {
    throw new PendingReplacePermanentError(
      'INVALID_OPERATION',
      'Persisted operation does not exactly match the queue payload'
    )
  }
  if (context.payload.mode === 'RESTORE' && operation.itemId !== context.payload.itemId) {
    throw new PendingReplacePermanentError(
      'INVALID_OPERATION',
      'Restore operation item does not match the queue payload'
    )
  }
  if (context.payload.mode !== 'RESTORE' && operation.itemId !== null) {
    throw new PendingReplacePermanentError('INVALID_OPERATION', 'Batch operation unexpectedly targets one item')
  }
}

function assertExactItemSelection(items: PendingReplaceItemSnapshot[], itemIds: string[]) {
  const actual = items.map((item) => item.id).sort()
  const expected = [...itemIds].sort()
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    throw new PendingReplacePermanentError('INVALID_OPERATION', 'Frozen item selection no longer matches the operation')
  }
  if (items.some((item) => !item.included || item.status === 'INVALID' || item.status === 'EXCLUDED')) {
    throw new PendingReplacePermanentError('INVALID_OPERATION', 'Frozen item eligibility changed after enqueue')
  }
}

function assertCompleteItem(
  item: PendingReplaceItemSnapshot,
  manifest: PendingReplaceManifestFile[],
  newMedia: PendingReplaceMediaSnapshot[]
) {
  if (
    !item.artworkId ||
    !item.externalId ||
    !item.targetDirectory ||
    !item.fingerprint ||
    manifest.length === 0 ||
    newMedia.length === 0
  ) {
    throw new PendingReplacePermanentError('INVALID_SNAPSHOT', 'Pending replacement item is incomplete')
  }
}

interface ItemPaths {
  pendingSource: string
  work: string
  workSource: string
  normalized: string
  backup: string
  target: string
  completed: string
}

function itemPaths(item: PendingReplaceItemSnapshot): ItemPaths {
  if (!item.targetDirectory) throw new PendingReplacePermanentError('INVALID_SNAPSHOT', 'Target directory is missing')
  const pendingSource = normalizeStoredRelativePath(item.sourceDirectory)
  const work = path.posix.join(WORK_DIRECTORY, item.batchId, item.id)
  return {
    pendingSource,
    work,
    workSource: path.posix.join(work, 'source'),
    normalized: path.posix.join(work, 'normalized'),
    backup: path.posix.join(BACKUP_DIRECTORY, item.batchId, item.id),
    target: normalizeStoredRelativePath(item.targetDirectory),
    completed: path.posix.join(COMPLETED_DIRECTORY, item.batchId, item.id)
  }
}

function persistedRestorePaths(item: PendingReplaceItemSnapshot): ItemPaths {
  if (!item.backupDirectory) {
    throw new PendingReplacePermanentError('INVALID_SNAPSHOT', 'Backup directory is missing')
  }
  const paths = itemPaths(item)
  const expectedPendingSource = producerDirectory(PENDING_DIRECTORY, item.sourceDirectoryName)
  if (caseFoldPath(paths.pendingSource) !== caseFoldPath(expectedPendingSource)) {
    throw new PendingReplacePermanentError('INVALID_SNAPSHOT', 'Pending source directory does not match its identity')
  }

  paths.backup = normalizeStoredRelativePath(item.backupDirectory)
  const expectedBackups = [producerDirectory(BACKUP_DIRECTORY, item.batchId, item.id)]
  if (item.externalId && isPathSegment(item.externalId)) {
    expectedBackups.push(producerDirectory(BACKUP_DIRECTORY, item.batchId, item.externalId))
  }
  if (!expectedBackups.some((expected) => caseFoldPath(paths.backup) === caseFoldPath(expected))) {
    throw new PendingReplacePermanentError('INVALID_SNAPSHOT', 'Backup directory does not match its identity')
  }
  assertItemPathsDistinct(paths)
  return paths
}

function producerDirectory(root: string, ...segments: string[]): string {
  if (segments.some((segment) => !isPathSegment(segment))) {
    throw new PendingReplacePermanentError('INVALID_SNAPSHOT', 'Persisted directory identity is invalid')
  }
  return path.posix.join(root, ...segments)
}

function isPathSegment(value: string): boolean {
  return value.length > 0 && value !== '.' && value !== '..' && !/[\\/]/.test(value)
}

function assertItemPathsDistinct(paths: ItemPaths) {
  const values = [
    paths.pendingSource,
    paths.work,
    paths.workSource,
    paths.normalized,
    paths.backup,
    paths.target,
    paths.completed
  ]
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      assertDistinctPaths(values[left]!, values[right]!, 'Pending replacement checkpoints must use distinct paths')
    }
  }
}

function replaceActiveStatuses(): PendingReplaceItemStatus[] {
  return ['READY', 'FAILED', 'STAGING', 'BACKING_UP', 'SWAPPING', 'COMMITTING', 'ROLLING_BACK']
}

function resultFromCounters(batchId: string, counters: PendingReplaceBatchCounters) {
  return { batchId, ...counters }
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('Worker interrupted')
}

function stableErrorCode(error: unknown): string {
  if (error instanceof PendingReplacePermanentError || error instanceof PendingReplaceActionRequiredError)
    return error.code
  const code = (error as NodeJS.ErrnoException)?.code
  if (typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code)) return code
  return 'INTERNAL_ERROR'
}

function errorCodeFor(
  error: unknown
): 'PATH_OUTSIDE_ALLOWED_ROOT' | 'PRECONDITION_FAILED' | 'FILESYSTEM_PERMISSION_DENIED' | 'INTERNAL_ERROR' {
  if (error instanceof PendingReplacePermanentError) {
    if (error.code === 'PATH_OUTSIDE_SCAN_ROOT' || error.code === 'SYMLINK_NOT_ALLOWED')
      return 'PATH_OUTSIDE_ALLOWED_ROOT'
    return 'PRECONDITION_FAILED'
  }
  if (['EACCES', 'EPERM'].includes((error as NodeJS.ErrnoException)?.code ?? '')) return 'FILESYSTEM_PERMISSION_DENIED'
  return 'INTERNAL_ERROR'
}
