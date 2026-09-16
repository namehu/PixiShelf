import { extractJobDiagnostic } from '@pixishelf/job-contracts'
import path from 'node:path'
import type {
  EnqueuedChildJob,
  ExecutionContext,
  FencedExecutionTransaction,
  JobExecutionOutcome,
  QueueSqlExecutor
} from '@pixishelf/job-runtime'
import {
  buildCanonicalTargetDirectory,
  buildCanonicalTargetPath,
  buildStagedRelativePath,
  caseFoldPath,
  isExternalIdOwnedFilename,
  isPathInExactDirectory,
  normalizeStoredRelativePath,
  resolveSafeExistingDirectory,
  resolveSafeExistingFile,
  toDatabaseStoredPath
} from './paths.ts'
import {
  cleanupPublishedSource,
  publishMigrationFile,
  removeAttemptStaging,
  stageMigrationFile,
  verifyPreparedMigrationFile,
  type MigrationFingerprint
} from './transfer.ts'
import type {
  CreateMigrationPlanInput,
  MigrationArtworkPlan,
  MigrationArtworkSnapshot,
  MigrationExecutorDependencies,
  MigrationFilePlan,
  MigrationItemPhase,
  MigrationPayloadV1,
  MigrationSelectionRow
} from './types.ts'
import { MigrationActionRequiredError, MigrationPermanentError } from './types.ts'
import { migrationPublicErrorCode, migrationPublicSummary } from './diagnostics.ts'

const DEFAULT_SELECTION_PAGE_SIZE = 100
const MAX_SELECTION_PAGE_SIZE = 100
const DEFAULT_FAILED_SAMPLE_LIMIT = 20
const MAX_FAILED_SAMPLE_LIMIT = 50
const DEFAULT_MAX_ARTWORK_FILES = 1_000
const MAX_MAX_ARTWORK_FILES = 5_000
const DEFAULT_MAX_DIRECTORY_ENTRIES = 2_000
const MAX_MAX_DIRECTORY_ENTRIES = 10_000

type MigrationContext = ExecutionContext<MigrationPayloadV1, EnqueuedChildJob>
type MigrationScope<TTransaction extends QueueSqlExecutor> = FencedExecutionTransaction<TTransaction>

export async function executeMigration<TTransaction extends QueueSqlExecutor>(
  context: MigrationContext,
  dependencies: MigrationExecutorDependencies<TTransaction>
): Promise<JobExecutionOutcome> {
  const pageSize = boundedInteger(
    dependencies.config.selectionPageSize ?? DEFAULT_SELECTION_PAGE_SIZE,
    1,
    MAX_SELECTION_PAGE_SIZE,
    'selectionPageSize'
  )
  const sampleLimit = boundedInteger(
    dependencies.config.failedSampleLimit ?? DEFAULT_FAILED_SAMPLE_LIMIT,
    1,
    MAX_FAILED_SAMPLE_LIMIT,
    'failedSampleLimit'
  )
  let activePlan: MigrationArtworkPlan | null = null
  try {
    const total = await dependencies.database.selection.count(context.payload.selection)
    let afterArtworkId = 0
    let visited = 0
    while (true) {
      throwIfAborted(context.signal)
      const page = await dependencies.database.selection.selectPage({
        selection: context.payload.selection,
        afterArtworkId,
        take: pageSize
      })
      assertKeysetPage(page, afterArtworkId, pageSize, context.payload.selection)
      if (page.length === 0) break
      for (const selected of page) {
        throwIfAborted(context.signal)
        let prepared: MigrationArtworkPlan | null
        try {
          prepared = await prepareArtworkPlan(context, dependencies, selected.id, visited + 1)
        } catch (error) {
          if (error instanceof PlannedMigrationActionRequiredError) activePlan = error.plan
          throw error
        }
        if (prepared) {
          activePlan = prepared
          try {
            await processArtworkPlan(context, dependencies, prepared)
          } catch (error) {
            if (!(error instanceof MigrationPermanentError)) throw error
            const failure = publicFailure(error.code)
            await closePlan(context, dependencies, prepared, {
              status: 'FAILED',
              errorCode: failure.errorCode,
              errorSummary: failure.message,
              error
            })
          }
          activePlan = null
        }
        visited += 1
        await context.progress({
          progress: Math.min(99, Math.floor((visited / Math.max(total, 1)) * 99)),
          stage: 'MIGRATING_ARTWORKS',
          message: `已处理 ${visited}/${total} 个迁移候选`,
          data: { artworkId: selected.id, pageSize, artworkConcurrency: 1 }
        })
      }
      afterArtworkId = page.at(-1)!.id
    }

    const persistedSummary = await dependencies.database.summarize(context.job.id, sampleLimit)
    const summary = {
      ...persistedSummary,
      failedSamples: persistedSummary.failedSamples.slice(0, sampleLimit).map((sample) => {
        const errorCode = migrationPublicErrorCode(sample.code)
        return { ...sample, code: errorCode, message: migrationPublicSummary(errorCode) }
      })
    }
    return context.finalizeInTransaction<TTransaction>(async (scope) => {
      if (
        await finalizeRequestedControl(scope, dependencies, activePlan, context.job.attempt, context.signal.aborted)
      ) {
        return
      }
      await scope.complete({ result: summary, message: `迁移完成：成功 ${summary.completed}，失败 ${summary.failed}` })
    })
  } catch (error) {
    context.logger.error('migration.execution_failed', error, {
      jobId: context.job.id,
      artworkId: activePlan?.artworkId ?? null,
      errorCode: migrationPublicErrorCode(errorCodeOf(error))
    })
    if (error instanceof MigrationActionRequiredError) {
      return finalizeActionRequired(context, dependencies, activePlan, error)
    }
    if (context.signal.aborted) {
      return context.finalizeInTransaction<TTransaction>(async (scope) => {
        if (!(await finalizeRequestedControl(scope, dependencies, activePlan, context.job.attempt, true))) {
          await scope.release('迁移 Worker 已停止，已保留文件与数据库检查点')
        }
      })
    }
    if (error instanceof MigrationPermanentError && activePlan) {
      const failure = publicFailure(error.code)
      await closePlan(context, dependencies, activePlan, {
        status: 'FAILED',
        errorCode: failure.errorCode,
        errorSummary: failure.message,
        error
      })
      activePlan = null
      // A deterministic item failure is persisted for FAILED_FROM_JOB. The current job can
      // continue only when it happens inside processArtworkPlan; reaching here means selection
      // or orchestration itself violated an invariant and the whole execution must fail.
    }
    return finalizeRetryOrFail(context, dependencies, activePlan, error)
  }
}

async function prepareArtworkPlan<TTransaction extends QueueSqlExecutor>(
  context: MigrationContext,
  dependencies: MigrationExecutorDependencies<TTransaction>,
  artworkId: number,
  selectionOrdinal: number
): Promise<MigrationArtworkPlan | null> {
  const maxArtworkFiles = boundedInteger(
    dependencies.config.maxArtworkFiles ?? DEFAULT_MAX_ARTWORK_FILES,
    1,
    MAX_MAX_ARTWORK_FILES,
    'maxArtworkFiles'
  )
  const existing = await dependencies.database.loadPlan(context.job.id, artworkId, maxArtworkFiles + 1)
  if (existing) {
    if (existing.files.length > maxArtworkFiles) {
      throw new PlannedMigrationActionRequiredError(
        new MigrationActionRequiredError(
          'CANDIDATE_LIMIT_EXCEEDED',
          'Persisted artwork plan exceeds the configured migration candidate limit'
        ),
        existing
      )
    }
    return existing
  }
  const artwork = await dependencies.database.loadArtwork(artworkId, maxArtworkFiles + 1)
  if (!artwork || artwork.deletedAt) {
    await context.mutateInTransaction<TTransaction>(async (transaction) => {
      await dependencies.database.recordUnplannableItem(transaction, {
        systemJobId: context.job.id,
        artworkId,
        selectionOrdinal,
        attempt: context.job.attempt,
        status: 'SKIPPED',
        errorCode: artwork ? 'ARTWORK_DELETED' : 'ARTWORK_NOT_FOUND',
        errorSummary: artwork ? 'Artwork was deleted after selection' : 'Artwork no longer exists'
      })
    })
    return null
  }
  if (!artwork.artistUserId || !artwork.externalId || artwork.images.length === 0) {
    await context.mutateInTransaction<TTransaction>(async (transaction) => {
      await dependencies.database.recordUnplannableItem(transaction, {
        systemJobId: context.job.id,
        artworkId,
        selectionOrdinal,
        attempt: context.job.attempt,
        status: 'FAILED',
        errorCode: 'INCOMPLETE_ARTWORK',
        errorSummary: 'Artwork requires an artist userId, externalId, and at least one image'
      })
      await context.recordDiagnostic?.(transaction, {
        key: `migration-artwork:${artworkId}`,
        scope: 'ITEM',
        targetType: 'ARTWORK',
        targetId: String(artworkId),
        stage: 'PLANNING',
        code: 'INCOMPLETE_ARTWORK',
        message: 'Artwork requires an artist userId, externalId, and at least one image'
      })
    })
    return null
  }

  let planInput: CreateMigrationPlanInput
  try {
    planInput = await buildPlanInput(context, dependencies, artwork, selectionOrdinal)
  } catch (error) {
    if (error instanceof MigrationActionRequiredError) {
      const failure = publicFailure(error.code)
      const plan = await context.mutateInTransaction<TTransaction, MigrationArtworkPlan>((transaction) =>
        dependencies.database.recordUnplannableItem(transaction, {
          systemJobId: context.job.id,
          artworkId,
          selectionOrdinal,
          attempt: context.job.attempt,
          status: 'ACTION_REQUIRED',
          errorCode: failure.errorCode,
          errorSummary: failure.message
        })
      )
      throw new PlannedMigrationActionRequiredError(error, plan)
    }
    if (error instanceof MigrationPermanentError) {
      const failure = publicFailure(error.code)
      await context.mutateInTransaction<TTransaction>(async (transaction) => {
        await dependencies.database.recordUnplannableItem(transaction, {
          systemJobId: context.job.id,
          artworkId,
          selectionOrdinal,
          attempt: context.job.attempt,
          status: 'FAILED',
          errorCode: failure.errorCode,
          errorSummary: failure.message
        })
        await context.recordDiagnostic?.(transaction, {
          key: `migration-artwork:${artworkId}`,
          scope: 'ITEM',
          targetType: 'ARTWORK',
          targetId: String(artworkId),
          stage: 'PLANNING',
          code: failure.errorCode,
          message: failure.message,
          error
        })
      })
      return null
    }
    throw error
  }
  return context.mutateInTransaction<TTransaction, MigrationArtworkPlan>((transaction) =>
    dependencies.database.createOrLoadPlan(transaction, planInput)
  )
}

async function buildPlanInput<TTransaction extends QueueSqlExecutor>(
  context: MigrationContext,
  dependencies: MigrationExecutorDependencies<TTransaction>,
  artwork: MigrationArtworkSnapshot,
  selectionOrdinal: number
): Promise<CreateMigrationPlanInput> {
  const targetDirectory = buildCanonicalTargetDirectory(artwork.artistUserId!, artwork.externalId!)
  const targetPaths = new Set<string>()
  const sourcePaths = new Set<string>()
  const sourceDirectories = new Set<string>()
  const stagingDirectoryName = dependencies.config.stagingDirectoryName ?? '.pixishelf-migration-staging'
  const maxArtworkFiles = boundedInteger(
    dependencies.config.maxArtworkFiles ?? DEFAULT_MAX_ARTWORK_FILES,
    1,
    MAX_MAX_ARTWORK_FILES,
    'maxArtworkFiles'
  )
  const maxDirectoryEntries = boundedInteger(
    dependencies.config.maxDirectoryEntries ?? DEFAULT_MAX_DIRECTORY_ENTRIES,
    1,
    MAX_MAX_DIRECTORY_ENTRIES,
    'maxDirectoryEntries'
  )
  if (artwork.images.length > maxArtworkFiles) {
    throw new MigrationActionRequiredError(
      'CANDIDATE_LIMIT_EXCEEDED',
      'Artwork image count exceeds the configured migration candidate limit'
    )
  }
  const files: CreateMigrationPlanInput['files'] = []
  const addFile = (input: { imageId: number | null; sourceStoredPath: string; sourceRelativePath: string }) => {
    const ordinal = files.length
    const sourceRelativePath = normalizeStoredRelativePath(input.sourceRelativePath)
    const sourceKey = caseFoldPath(sourceRelativePath)
    if (sourcePaths.has(sourceKey)) {
      if (input.imageId === null) return
      throw new MigrationActionRequiredError(
        'TARGET_CONFLICT',
        'Artwork maps multiple image rows to the same physical source path'
      )
    }
    const targetRelativePath = buildCanonicalTargetPath(targetDirectory, sourceRelativePath)
    const targetKey = caseFoldPath(targetRelativePath)
    if (sourceKey === targetKey && sourceRelativePath !== targetRelativePath) {
      throw new MigrationActionRequiredError(
        'TARGET_CONFLICT',
        'Migration source and target differ only by filesystem case'
      )
    }
    if (targetPaths.has(targetKey)) {
      throw new MigrationActionRequiredError(
        'TARGET_CONFLICT',
        'Artwork maps multiple files to the same canonical target'
      )
    }
    if (files.length >= maxArtworkFiles) {
      throw new MigrationActionRequiredError(
        'CANDIDATE_LIMIT_EXCEEDED',
        'Artwork file count exceeds the configured migration candidate limit'
      )
    }
    targetPaths.add(targetKey)
    sourcePaths.add(sourceKey)
    sourceDirectories.add(path.posix.dirname(sourceRelativePath))
    files.push({
      ordinal,
      imageId: input.imageId,
      sourceStoredPath: input.sourceStoredPath,
      sourceRelativePath,
      targetStoredPath:
        input.imageId !== null && isPathInExactDirectory(sourceRelativePath, targetDirectory)
          ? input.sourceStoredPath
          : toDatabaseStoredPath(targetRelativePath),
      targetRelativePath,
      stagedRelativePath: buildStagedRelativePath({
        stagingDirectoryName,
        systemJobId: context.job.id,
        attempt: context.job.attempt,
        artworkId: artwork.id,
        ordinal,
        filename: path.posix.basename(sourceRelativePath)
      })
    })
  }
  for (const image of [...artwork.images].sort((left, right) => left.id - right.id)) {
    addFile({ imageId: image.id, sourceStoredPath: image.path, sourceRelativePath: image.path })
  }
  for (const image of [...artwork.images].sort((left, right) => left.id - right.id)) {
    if (!image.chaptersPath) continue
    await resolveSafeExistingFile(dependencies.fileSystem, dependencies.config.scanRoot, image.chaptersPath)
    addFile({ imageId: null, sourceStoredPath: image.chaptersPath, sourceRelativePath: image.chaptersPath })
  }
  if (artwork.metaSource) {
    await resolveSafeExistingFile(dependencies.fileSystem, dependencies.config.scanRoot, artwork.metaSource)
    addFile({ imageId: null, sourceStoredPath: artwork.metaSource, sourceRelativePath: artwork.metaSource })
  }
  let remainingDirectoryEntries = maxDirectoryEntries
  for (const sourceDirectory of [...sourceDirectories].sort()) {
    if (sourceDirectory !== '.' && caseFoldPath(sourceDirectory) === caseFoldPath(targetDirectory)) continue
    if (remainingDirectoryEntries === 0) {
      throw new MigrationActionRequiredError(
        'CANDIDATE_LIMIT_EXCEEDED',
        'Artwork source directories exceed the configured enumeration limit'
      )
    }
    const directoryPath = await resolveSafeExistingDirectory(
      dependencies.fileSystem,
      dependencies.config.scanRoot,
      sourceDirectory
    )
    const listing = await dependencies.fileSystem.listDirectoryBounded(directoryPath, remainingDirectoryEntries)
    if (listing.hasMore) {
      throw new MigrationActionRequiredError(
        'CANDIDATE_LIMIT_EXCEEDED',
        'Artwork source directory exceeds the configured enumeration limit'
      )
    }
    remainingDirectoryEntries -= listing.names.length
    for (const filename of listing.names.sort()) {
      if (!isExternalIdOwnedFilename(filename, artwork.externalId!)) continue
      const sourceRelativePath = sourceDirectory === '.' ? filename : `${sourceDirectory}/${filename}`
      if (sourcePaths.has(caseFoldPath(sourceRelativePath))) continue
      await resolveSafeExistingFile(dependencies.fileSystem, dependencies.config.scanRoot, sourceRelativePath)
      addFile({
        imageId: null,
        sourceStoredPath: toDatabaseStoredPath(sourceRelativePath),
        sourceRelativePath
      })
    }
  }
  return {
    systemJobId: context.job.id,
    artworkId: artwork.id,
    selectionOrdinal,
    attempt: context.job.attempt,
    sourceDirectory: sourceDirectories.size === 1 ? [...sourceDirectories][0]! : null,
    targetDirectory,
    files
  }
}

const activeMigrationFiles = new WeakMap<MigrationArtworkPlan, string>()

async function processArtworkPlan<TTransaction extends QueueSqlExecutor>(
  context: MigrationContext,
  dependencies: MigrationExecutorDependencies<TTransaction>,
  plan: MigrationArtworkPlan
) {
  if (plan.status === 'FAILED') {
    await context.mutateInTransaction<TTransaction>((transaction) =>
      recordPlanDiagnostic(
        context,
        transaction,
        plan,
        plan.errorCode ?? 'PREVIOUS_FAILURE',
        plan.errorSummary ?? '此前执行遗留的迁移失败检查点',
        undefined,
        true,
        'INHERITED'
      )
    )
    return
  }
  if (['COMPLETED', 'SKIPPED', 'CANCELLED'].includes(plan.status)) return
  if (plan.files.every(isSameFilePath)) {
    activeMigrationFiles.delete(plan)
    await context.mutateInTransaction<TTransaction>((transaction) =>
      dependencies.database.publishArtwork(transaction, {
        itemId: plan.id,
        artworkId: plan.artworkId,
        targetDirectory: plan.targetDirectory!,
        plannedImageIds: plan.files.flatMap((file) => (file.imageId === null ? [] : [file.imageId])),
        attempt: context.job.attempt,
        terminalStatus: 'SKIPPED',
        files: plan.files.map((file) => ({
          fileId: file.id,
          imageId: file.imageId,
          sourceStoredPath: file.sourceStoredPath,
          targetStoredPath: file.targetStoredPath,
          sourceSha256: null
        }))
      })
    )
    plan.status = 'SKIPPED'
    plan.phase = 'FINALIZING'
    return
  }
  const fingerprints = new Map<string, MigrationFingerprint>()

  if (!['CLEANING_SOURCE', 'FINALIZING'].includes(plan.phase)) {
    await checkpointItem(context, dependencies, plan, { status: 'RUNNING', phase: 'STAGING_FILES' })
    for (const file of plan.files) {
      throwIfAborted(context.signal)
      if (isSameFilePath(file)) continue
      activeMigrationFiles.set(plan, file.id)
      await checkpointFile(context, dependencies, file, 'STAGING')
      const fingerprint = await stageMigrationFile({
        fileSystem: dependencies.fileSystem,
        config: dependencies.config,
        file
      })
      fingerprints.set(file.id, fingerprint)
      file.sourceSize = fingerprint.size
      file.sourceMtimeMs = fingerprint.mtimeMs
      file.sourceSha256 = fingerprint.sha256
      file.stagedSha256 = fingerprint.sha256
      await checkpointFile(context, dependencies, file, 'STAGED', fingerprint)
    }

    activeMigrationFiles.delete(plan)
    await checkpointItem(context, dependencies, plan, { status: 'RUNNING', phase: 'VERIFYING_FILES' })
    for (const file of plan.files) {
      throwIfAborted(context.signal)
      if (isSameFilePath(file)) continue
      activeMigrationFiles.set(plan, file.id)
      const expectedSha256 = requireFileHash(file)
      await publishMigrationFile({
        fileSystem: dependencies.fileSystem,
        config: dependencies.config,
        file,
        expectedSha256
      })
      await checkpointFile(context, dependencies, file, 'PUBLISHED')
    }

    activeMigrationFiles.delete(plan)
    await checkpointItem(context, dependencies, plan, { status: 'RUNNING', phase: 'PUBLISHING_DATABASE' })
    for (const file of plan.files) {
      if (isSameFilePath(file)) continue
      activeMigrationFiles.set(plan, file.id)
      await verifyPreparedMigrationFile({
        fileSystem: dependencies.fileSystem,
        config: dependencies.config,
        file,
        expected: requirePersistedFingerprint(file)
      })
    }
    await context.mutateInTransaction<TTransaction>((transaction) =>
      dependencies.database.publishArtwork(transaction, {
        itemId: plan.id,
        artworkId: plan.artworkId,
        targetDirectory: plan.targetDirectory!,
        plannedImageIds: plan.files.flatMap((file) => (file.imageId === null ? [] : [file.imageId])),
        attempt: context.job.attempt,
        files: plan.files.map((file) => ({
          fileId: file.id,
          imageId: file.imageId,
          sourceStoredPath: file.sourceStoredPath,
          targetStoredPath: file.targetStoredPath,
          sourceSha256: isSameFilePath(file) ? null : requireFileHash(file)
        }))
      })
    )
    plan.phase = 'CLEANING_SOURCE'
  }

  await checkpointItem(context, dependencies, plan, { status: 'RUNNING', phase: 'CLEANING_SOURCE' })
  const removeSource = context.payload.safety.transferMode === 'move' || context.payload.safety.cleanupSource
  for (const file of plan.files) {
    throwIfAborted(context.signal)
    activeMigrationFiles.set(plan, file.id)
    if (removeSource && !isSameFilePath(file)) {
      const expected = fingerprints.get(file.id) ?? requirePersistedFingerprint(file)
      await cleanupPublishedSource({
        fileSystem: dependencies.fileSystem,
        config: dependencies.config,
        file,
        expected
      })
    }
    if (!isSameFilePath(file)) {
      await removeAttemptStaging({ fileSystem: dependencies.fileSystem, config: dependencies.config, file })
    }
    await checkpointFile(context, dependencies, file, 'COMPLETED')
  }
  activeMigrationFiles.delete(plan)
  await checkpointItem(context, dependencies, plan, { status: 'COMPLETED', phase: 'FINALIZING' })
}

async function checkpointItem<TTransaction extends QueueSqlExecutor>(
  context: MigrationContext,
  dependencies: MigrationExecutorDependencies<TTransaction>,
  plan: MigrationArtworkPlan,
  transition: {
    status: MigrationArtworkPlan['status']
    phase: MigrationItemPhase
    errorCode?: string | null
    errorSummary?: string | null
  }
) {
  await context.mutateInTransaction<TTransaction>((transaction) =>
    dependencies.database.checkpointItem(transaction, {
      itemId: plan.id,
      status: transition.status,
      phase: transition.phase,
      attempt: context.job.attempt,
      ...(transition.errorCode !== undefined ? { errorCode: transition.errorCode } : {}),
      ...(transition.errorSummary !== undefined ? { errorSummary: transition.errorSummary } : {})
    })
  )
  plan.status = transition.status
  plan.phase = transition.phase
  plan.attempt = context.job.attempt
}

async function checkpointFile<TTransaction extends QueueSqlExecutor>(
  context: MigrationContext,
  dependencies: MigrationExecutorDependencies<TTransaction>,
  file: MigrationFilePlan,
  status: MigrationFilePlan['status'],
  fingerprint?: MigrationFingerprint
) {
  await context.mutateInTransaction<TTransaction>((transaction) =>
    dependencies.database.checkpointFile(transaction, {
      fileId: file.id,
      status,
      attempt: context.job.attempt,
      ...(fingerprint
        ? {
            sourceSize: fingerprint.size,
            sourceMtimeMs: fingerprint.mtimeMs,
            sourceSha256: fingerprint.sha256,
            stagedSha256: fingerprint.sha256
          }
        : {})
    })
  )
  file.status = status
  file.attempt = context.job.attempt
}

function finalizeActionRequired<TTransaction extends QueueSqlExecutor>(
  context: MigrationContext,
  dependencies: MigrationExecutorDependencies<TTransaction>,
  activePlan: MigrationArtworkPlan | null,
  error: MigrationActionRequiredError
) {
  const failure = publicFailure(error.code)
  return context.finalizeInTransaction<TTransaction>(async (scope) => {
    if (await finalizeRequestedControl(scope, dependencies, activePlan, context.job.attempt, context.signal.aborted)) {
      return
    }
    if (activePlan) {
      if (error.fileId) {
        await dependencies.database.checkpointFile(scope.transaction, {
          fileId: error.fileId,
          status: 'ACTION_REQUIRED',
          attempt: context.job.attempt,
          errorCode: failure.errorCode,
          errorSummary: failure.message
        })
      }
      await dependencies.database.checkpointItem(scope.transaction, {
        itemId: activePlan.id,
        status: 'ACTION_REQUIRED',
        phase: activePlan.phase,
        attempt: context.job.attempt,
        errorCode: failure.errorCode,
        errorSummary: failure.message
      })
    }
    await context.recordDiagnostic?.(scope.transaction, { key: 'task:action-required', scope: 'TASK', error })
    if (activePlan)
      await recordPlanDiagnostic(
        context,
        scope.transaction,
        activePlan,
        failure.errorCode,
        failure.message,
        error,
        false
      )
    await scope.pause({
      reason: 'ACTION_REQUIRED',
      message: failure.message,
      data: { errorCode: failure.errorCode, artworkId: activePlan?.artworkId ?? null }
    })
  })
}

function finalizeRetryOrFail<TTransaction extends QueueSqlExecutor>(
  context: MigrationContext,
  dependencies: MigrationExecutorDependencies<TTransaction>,
  activePlan: MigrationArtworkPlan | null,
  error: unknown
) {
  const failure = classifyFailure(error)
  return context.finalizeInTransaction<TTransaction>(async (scope) => {
    if (await finalizeRequestedControl(scope, dependencies, activePlan, context.job.attempt, false)) return
    const retry = !(error instanceof MigrationPermanentError) && context.job.attempt < context.job.maxAttempts
    if (activePlan) {
      if (retry) {
        await dependencies.database.checkpointItem(scope.transaction, {
          itemId: activePlan.id,
          status: 'RETRY_WAIT',
          phase: activePlan.phase,
          attempt: context.job.attempt,
          errorCode: failure.errorCode,
          errorSummary: failure.message
        })
      } else {
        await dependencies.database.closeItemAndFiles(scope.transaction, {
          itemId: activePlan.id,
          status: 'FAILED',
          phase: activePlan.phase,
          attempt: context.job.attempt,
          errorCode: failure.errorCode,
          errorSummary: failure.message
        })
      }
    }
    if (activePlan)
      await recordPlanDiagnostic(
        context,
        scope.transaction,
        activePlan,
        failure.errorCode,
        failure.message,
        error,
        !retry
      )
    if (retry) {
      const now = dependencies.now?.() ?? new Date()
      await scope.retry({
        diagnostic: extractJobDiagnostic(error),
        availableAt: new Date(now.getTime() + Math.min(30 * 60_000, 30_000 * 2 ** (context.job.attempt - 1))),
        errorCode: failure.jobErrorCode,
        error: failure.message,
        message: '迁移执行异常，等待恢复重试'
      })
    } else {
      await scope.fail({
        diagnostic: extractJobDiagnostic(error),
        errorCode: failure.jobErrorCode,
        error: failure.message,
        message: '迁移执行失败'
      })
    }
  })
}

async function finalizeRequestedControl<TTransaction extends QueueSqlExecutor>(
  scope: MigrationScope<TTransaction>,
  dependencies: MigrationExecutorDependencies<TTransaction>,
  activePlan: MigrationArtworkPlan | null,
  attempt: number,
  shutdown: boolean
) {
  if (scope.executionStatus === 'PAUSING') {
    if (activePlan) {
      await dependencies.database.checkpointItem(scope.transaction, {
        itemId: activePlan.id,
        status: 'PAUSED',
        phase: activePlan.phase,
        attempt
      })
    }
    await scope.pause({ reason: 'USER_REQUESTED', message: '迁移任务已暂停，检查点已保留' })
    return true
  }
  if (scope.executionStatus === 'CANCELLING') {
    if (activePlan) {
      await dependencies.database.closeItemAndFiles(scope.transaction, {
        itemId: activePlan.id,
        status: 'CANCELLED',
        phase: activePlan.phase,
        attempt,
        errorCode: 'CANCELLED',
        errorSummary: 'Migration was cancelled by an administrator'
      })
    }
    await scope.cancel('迁移任务已取消，已发布文件不会被回滚或覆盖')
    return true
  }
  if (shutdown) {
    if (activePlan) {
      await dependencies.database.checkpointItem(scope.transaction, {
        itemId: activePlan.id,
        status: 'RETRY_WAIT',
        phase: activePlan.phase,
        attempt
      })
    }
    await scope.release('迁移 Worker 已停止，检查点已保留')
    return true
  }
  return false
}

function assertKeysetPage(
  page: MigrationSelectionRow[],
  afterArtworkId: number,
  pageSize: number,
  selection: MigrationPayloadV1['selection']
) {
  if (page.length > pageSize) throw new Error('Migration selection port exceeded the requested page bound')
  let previous = afterArtworkId
  for (const row of page) {
    if (!Number.isInteger(row.id) || row.id <= previous) {
      throw new Error('Migration selection port violated strict increasing keyset pagination')
    }
    if (row.deletedAt !== null) throw new Error('Migration selection port returned a deleted artwork')
    if (selection.mode === 'QUERY' && row.id > selection.upperArtworkId) {
      throw new Error('Migration selection port exceeded the frozen QUERY upperArtworkId')
    }
    previous = row.id
  }
}

function requireFileHash(file: MigrationFilePlan) {
  if (!file.sourceSha256) {
    throw new MigrationActionRequiredError(
      'FILESYSTEM_RECOVERY_FAILED',
      `Missing source hash for image ${file.imageId}`
    )
  }
  return file.sourceSha256
}

function isSameFilePath(file: Pick<MigrationFilePlan, 'sourceRelativePath' | 'targetRelativePath'>) {
  return file.sourceRelativePath === file.targetRelativePath
}

function requirePersistedFingerprint(file: MigrationFilePlan): MigrationFingerprint {
  if (file.sourceSize === null || file.sourceMtimeMs === null || !file.sourceSha256) {
    throw new MigrationActionRequiredError(
      'FILESYSTEM_RECOVERY_FAILED',
      `Missing persisted source fingerprint for image ${file.imageId}`
    )
  }
  return { size: file.sourceSize, mtimeMs: file.sourceMtimeMs, sha256: file.sourceSha256 }
}

function classifyFailure(error: unknown) {
  const publicError = publicFailure(errorCodeOf(error))
  const message = publicError.message
  if (error instanceof MigrationPermanentError) {
    if (error.code === 'SOURCE_NOT_FOUND') {
      return { jobErrorCode: 'SOURCE_NOT_FOUND' as const, errorCode: error.code, message }
    }
    if (error.code === 'PATH_OUTSIDE_ALLOWED_ROOT' || error.code === 'INVALID_PATH_SEGMENT') {
      return { jobErrorCode: 'PATH_OUTSIDE_ALLOWED_ROOT' as const, errorCode: error.code, message }
    }
    return { jobErrorCode: 'PRECONDITION_FAILED' as const, errorCode: error.code, message }
  }
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (code === 'ENOENT') return { jobErrorCode: 'SOURCE_NOT_FOUND' as const, errorCode: code, message }
  if (code === 'EACCES' || code === 'EPERM') {
    return { jobErrorCode: 'FILESYSTEM_PERMISSION_DENIED' as const, errorCode: code, message }
  }
  return { jobErrorCode: 'INTERNAL_ERROR' as const, errorCode: publicError.errorCode, message }
}

async function closePlan<TTransaction extends QueueSqlExecutor>(
  context: MigrationContext,
  dependencies: MigrationExecutorDependencies<TTransaction>,
  plan: MigrationArtworkPlan,
  transition: { status: 'FAILED' | 'CANCELLED'; errorCode: string; errorSummary: string; error?: unknown }
) {
  await context.mutateInTransaction<TTransaction>(async (transaction) => {
    await dependencies.database.closeItemAndFiles(transaction, {
      itemId: plan.id,
      status: transition.status,
      phase: plan.phase,
      attempt: context.job.attempt,
      errorCode: transition.errorCode,
      errorSummary: transition.errorSummary
    })
    if (transition.status === 'FAILED')
      await recordPlanDiagnostic(
        context,
        transaction,
        plan,
        transition.errorCode,
        transition.errorSummary,
        transition.error,
        true
      )
  })
  plan.status = transition.status
}

function errorCodeOf(error: unknown) {
  if (error instanceof MigrationPermanentError || error instanceof MigrationActionRequiredError) return error.code
  return (error as NodeJS.ErrnoException | null)?.code ?? 'INTERNAL_ERROR'
}

function publicFailure(code: string) {
  const errorCode = migrationPublicErrorCode(code)
  return { errorCode, message: migrationPublicSummary(errorCode) }
}

function boundedInteger(value: number, minimum: number, maximum: number, name: string) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new Error('Migration execution was interrupted')
}

class PlannedMigrationActionRequiredError extends MigrationActionRequiredError {
  constructor(
    error: MigrationActionRequiredError,
    readonly plan: MigrationArtworkPlan
  ) {
    super(error.code, error.message, error.fileId)
    this.name = 'PlannedMigrationActionRequiredError'
  }
}

async function recordPlanDiagnostic(
  context: MigrationContext,
  transaction: QueueSqlExecutor,
  plan: MigrationArtworkPlan,
  code: string,
  message: string,
  error: unknown,
  closed: boolean,
  origin: 'CURRENT' | 'INHERITED' = 'CURRENT'
) {
  await context.recordDiagnostic?.(transaction, {
    key: `migration-item:${plan.id}`,
    scope: 'ITEM',
    origin,
    targetType: 'ARTWORK',
    targetId: String(plan.artworkId),
    targetLabel: plan.sourceDirectory ?? String(plan.artworkId),
    stage: plan.phase,
    code,
    message,
    error,
    itemAttempt: context.job.attempt
  })
  for (const file of plan.files) {
    const directFailure =
      activeMigrationFiles.get(plan) === file.id ||
      (error instanceof MigrationActionRequiredError && error.fileId === file.id)
    if (file.status === 'COMPLETED' || (!closed && !directFailure)) continue
    await context.recordDiagnostic?.(transaction, {
      key: `migration-file:${file.id}`,
      scope: 'ITEM',
      origin,
      targetType: 'MIGRATION_FILE',
      targetId: file.id,
      targetLabel: file.sourceRelativePath,
      stage: plan.phase,
      code: directFailure ? code : 'PARENT_ITEM_FAILED',
      message: directFailure ? message : '所属作品迁移失败，文件检查点随之终止',
      error,
      itemAttempt: context.job.attempt
    })
  }
}
