import { readFile } from 'node:fs/promises'
import { ArchiveExecutorError } from './errors.ts'
import { assertArchiveDownloadGeneration, assertArchiveSourceSnapshot } from './dedup-source-snapshot.ts'
import {
  buildArchiveStoragePaths,
  copyArchiveCheckpoint,
  assertArchiveManifestIdentity,
  readArchiveManifestDigest,
  resolveExistingPathWithinRoot,
  pathExists,
  prepareArchiveStagingDirectory,
  validateArchiveStoredMedia
} from './storage.ts'
import type { ArchiveExecutorDependencies, ArchiveTransaction } from './types.ts'
import type { ArchiveExecutorContext, LoadedArchiveImport } from './executor.ts'

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason ?? new ArchiveExecutorError('CANCELLED', '归档执行已取消')
}

/** Register the execution before even the first staging mkdir/stat; the original Import proof is immutable. */
export async function registerArchiveDownloadGeneration(
  transaction: ArchiveTransaction,
  context: ArchiveExecutorContext,
  archiveImport: LoadedArchiveImport,
  scanRoot: string
) {
  await assertArchiveSourceSnapshot(transaction, archiveImport)
  const paths = buildArchiveStoragePaths({
    scanRoot,
    archiveImportId: archiveImport.id,
    providerKey: archiveImport.providerKey,
    creatorBucket: archiveImport.creatorBucket,
    externalId: archiveImport.externalId,
    generationToken: context.job.executionToken
  })
  const existing = await transaction.archiveStagingGeneration.findUnique({
    where: { token: context.job.executionToken }
  })
  if (existing) {
    if (
      existing.jobId !== context.job.id ||
      existing.archiveImportId !== archiveImport.id ||
      existing.drainedAt ||
      existing.sealedAt ||
      existing.cleanedAt
    )
      {throw new ArchiveExecutorError('STATE_CONFLICT', '归档执行代已退出或不属于当前执行')}
  } else {
    await transaction.archiveStagingGeneration.create({
      data: {
        token: context.job.executionToken,
        jobId: context.job.id,
        archiveImportId: archiveImport.id,
        path: paths.stagingRelativePath
      }
    })
  }
  return paths.stagingRelativePath
}

export async function markDownloadDrained(context: ArchiveExecutorContext, now: Date) {
  await context.mutateInTransaction<ArchiveTransaction>(async (transaction) => {
    await transaction.archiveStagingGeneration.updateMany({
      where: {
        token: context.job.executionToken,
        jobId: context.job.id,
        archiveImportId: context.payload.archiveImportId
      },
      data: { drainedAt: now }
    })
  })
}

export async function prepareDownloadGeneration(
  context: ArchiveExecutorContext,
  dependencies: ArchiveExecutorDependencies,
  archiveImport: LoadedArchiveImport
): Promise<{ stagingDirectory: string; existingManifestDigest: string | null }> {
  const paths = buildArchiveStoragePaths({
    scanRoot: dependencies.config.scanRoot,
    archiveImportId: archiveImport.id,
    providerKey: archiveImport.providerKey,
    creatorBucket: archiveImport.creatorBucket,
    externalId: archiveImport.externalId,
    generationToken: context.job.executionToken
  })
  await context.mutateInTransaction<ArchiveTransaction>((transaction) =>
    assertArchiveDownloadGeneration(transaction, {
      archiveImport,
      jobId: context.job.id,
      token: context.job.executionToken
    })
  )
  const previousPath = archiveImport.stagingPath
  // A legacy rename may have succeeded before its DB transaction. Verify it read-only in the download lane.
  const finalExists = await pathExists(paths.finalAbsolutePath)
  let existingManifestDigest: string | null = null
  let stagingDirectory: string
  if (finalExists) {
    const manifestFile = await resolveExistingPathWithinRoot(paths.finalAbsolutePath, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8')) as { revisionId?: string }
    if (
      manifest.revisionId !== archiveImport.id ||
      archiveImport.items.length !== archiveImport.totalItems ||
      archiveImport.items.some((item) => item.status !== 'COMPLETED')
    ) {
      throw new ArchiveExecutorError('STATE_CONFLICT', '已存在的归档版本身份或检查点未知，拒绝覆盖')
    }
    await assertArchiveManifestIdentity(paths.finalAbsolutePath, archiveImport)
    await validateArchiveStoredMedia(paths.finalAbsolutePath, archiveImport.items)
    existingManifestDigest = await readArchiveManifestDigest(paths.finalAbsolutePath)
    stagingDirectory = paths.finalAbsolutePath
  } else {
    stagingDirectory = paths.stagingAbsolutePath
  }
  const storedPath = finalExists ? paths.finalRelativePath : paths.stagingRelativePath
  await context.mutateInTransaction<ArchiveTransaction>(async (transaction) => {
    await assertArchiveDownloadGeneration(transaction, {
      archiveImport,
      jobId: context.job.id,
      token: context.job.executionToken
    })
    await transaction.archiveImportItem.updateMany({
      where: { archiveImportId: archiveImport.id, status: 'COMPLETED', stagedGenerationPath: null },
      data: { stagedGenerationPath: previousPath }
    })
    await transaction.archiveStagingGeneration.update({
      where: { token: context.job.executionToken },
      data: { path: storedPath, manifestSha256: existingManifestDigest }
    })
    const changed = await transaction.archiveImport.updateMany({
      where: {
        id: archiveImport.id,
        systemJobId: context.job.id,
        phase: 'DOWNLOAD',
        generationToken: context.job.executionToken,
        cleanupRequestedAt: null
      },
      data: { generationToken: context.job.executionToken, stagingPath: storedPath, sealedManifestSha256: null }
    })
    if (changed.count !== 1) throw new ArchiveExecutorError('STATE_CONFLICT', '归档下载代绑定已变化')
  })
  if (!finalExists) {
    stagingDirectory = await prepareArchiveStagingDirectory(dependencies.config.scanRoot, paths.stagingRelativePath)
    for (const item of archiveImport.items) {
      throwIfAborted(context.signal)
      if (item.status !== 'COMPLETED') continue
      await context.mutateInTransaction<ArchiveTransaction>((transaction) =>
        assertArchiveDownloadGeneration(transaction, {
          archiveImport,
          jobId: context.job.id,
          token: context.job.executionToken
        })
      )
      let copied: string | null = null
      try {
        const source = await resolveExistingPathWithinRoot(
          dependencies.config.scanRoot,
          item.stagedGenerationPath ?? previousPath
        )
        copied = await copyArchiveCheckpoint({
          from: source,
          to: stagingDirectory,
          item,
          token: context.job.executionToken
        })
      } catch (error) {
        if (context.signal.aborted) throw error
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'ENOENT' && !(error instanceof ArchiveExecutorError && error.code === 'MEDIA_INVALID')) throw error
      }
      await context.mutateInTransaction<ArchiveTransaction>(async (transaction) => {
        await assertArchiveDownloadGeneration(transaction, {
          archiveImport,
          jobId: context.job.id,
          token: context.job.executionToken
        })
        const current = await transaction.archiveImport.findUniqueOrThrow({ where: { id: archiveImport.id } })
        if (current.generationToken !== context.job.executionToken || current.cleanupRequestedAt)
          {throw new ArchiveExecutorError('STATE_CONFLICT', '归档下载代已失效')}
        await transaction.archiveImportItem.update({
          where: { id: item.id },
          data: copied
            ? { stagedPath: copied, stagedGenerationPath: storedPath }
            : {
                status: 'PENDING',
                attempts: 0,
                stagedPath: null,
                byteCount: null,
                sha256: null,
                finishedAt: null
              }
        })
      })
      item.stagedPath = copied
      item.stagedGenerationPath = copied ? storedPath : null
      if (!copied) {
        item.status = 'PENDING'
        item.attempts = 0
        item.byteCount = null
        item.sha256 = null
      }
    }
  }
  archiveImport.generationToken = context.job.executionToken
  archiveImport.stagingPath = storedPath
  return { stagingDirectory, existingManifestDigest }
}
