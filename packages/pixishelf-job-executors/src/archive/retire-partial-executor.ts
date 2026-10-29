import { readPartialRetirementSnapshot } from './retire-partial-proof.ts'
import { readdir, realpath, rm } from 'node:fs/promises'
import path from 'node:path'
import { type ArchiveMaintenancePayload } from '@pixishelf/job-contracts'
import { type Prisma } from '@pixishelf/db'
import type { ExecutionContext, EnqueuedChildJob } from '@pixishelf/job-runtime'
import {
  beginExecutorMediaWrite,
  publishExecutorMediaWrite,
  resolveExecutorMediaDirectory
} from '../scan/media-content-write.ts'
import { ArchiveExecutorError, ArchiveMediaRecoveryRequired } from './errors.ts'
import { ScanExecutorError } from '../scan/errors.ts'
import {
  buildArchiveStoragePaths,
  pathExists,
  readArchiveManifestDigest,
  resolveCreatablePathWithinRoot,
  resolveExistingPathWithinRoot,
  validateArchiveStoredMedia
} from './storage.ts'
import type { ArchiveMaintenanceExecutorDependencies } from './maintenance-executor.ts'

type Payload = Extract<ArchiveMaintenancePayload, { action: 'RETIRE_PARTIAL_REVISION' }>
export async function executePartialRetirement(
  context: ExecutionContext<ArchiveMaintenancePayload, EnqueuedChildJob>,
  payload: Payload,
  dependencies: ArchiveMaintenanceExecutorDependencies
) {
  const alreadyRetired = await context.mutateInTransaction<Prisma.TransactionClient, boolean>(async (tx) =>
    Boolean(
      (await tx.archiveRevision.findUnique({ where: { id: payload.revisionId }, select: { retiredAt: true } }))
        ?.retiredAt
    )
  )
  if (alreadyRetired)
    return context.finalizeInTransaction<Prisma.TransactionClient>(async (scope) => {
      await scope.complete({ result: payload, message: '旧部分归档副本已清理' })
    })
  const prepared = await context.mutateInTransaction<
    Prisma.TransactionClient,
    Awaited<ReturnType<typeof readPartialRetirementSnapshot>>
  >((tx) => readPartialRetirementSnapshot(tx, payload))
  const oldPath = buildArchiveStoragePaths({
    scanRoot: dependencies.config.scanRoot,
    archiveImportId: prepared.old.archiveImport!.id,
    providerKey: prepared.old.archiveImport!.providerKey,
    creatorBucket: prepared.old.archiveImport!.creatorBucket,
    externalId: prepared.old.archiveImport!.externalId
  }).finalRelativePath
  if (prepared.old.archivePath !== oldPath)
    throw new ArchiveExecutorError('STATE_CONFLICT', '旧版本目录不再是原发布路径，拒绝清理。')
  const directory = await resolveExecutorMediaDirectory({
    context,
    sourceRoot: dependencies.config.sourceMediaRoot ?? dependencies.config.scanRoot,
    archiveRoot: dependencies.config.scanRoot,
    location: 'archive',
    relativeDirectory: oldPath
  })
  let write
  try {
    write = await beginExecutorMediaWrite({
      context,
      directory,
      scope: { kind: 'DIRECTORY' },
      sessionId: `archive-retire:${context.job.id}`,
      artworkIds: [prepared.old.artworkId],
      now: dependencies.now?.() ?? new Date()
    })
  } catch (error) {
    if (error instanceof ScanExecutorError && error.code === 'STATE_CONFLICT')
      throw new ArchiveMediaRecoveryRequired('旧部分归档清理声明需要核对并按恢复手册续行。', { cause: error })
    throw error
  }
  const replacementDirectory = await resolveExistingPathWithinRoot(
    dependencies.config.scanRoot,
    prepared.replacement.archivePath
  )
  await readArchiveManifestDigest(replacementDirectory, prepared.replacement.archiveImport!.sealedManifestSha256!)
  await validateArchiveStoredMedia(
    replacementDirectory,
    prepared.media.map((item) => ({ stagedPath: item.path, sha256: item.sha256, byteCount: BigInt(item.size) }))
  )
  const oldDirectory = await resolveCreatablePathWithinRoot(dependencies.config.scanRoot, oldPath)
  if (await pathExists(oldDirectory)) {
    const canonical = await resolveExistingPathWithinRoot(dependencies.config.scanRoot, oldPath)
    if (canonical !== path.resolve(await realpath(dependencies.config.scanRoot), oldPath))
      throw new ArchiveExecutorError('STATE_CONFLICT', '旧版本路径经过符号链接，拒绝清理。')
    const allowed = new Set(['manifest.json', ...prepared.frozen.media.map((item) => item.path)])
    for (const entry of await readdir(oldDirectory, { recursive: true, withFileTypes: true })) {
      const relative = path.relative(oldDirectory, path.join(entry.parentPath, entry.name)).replace(/\\/g, '/')
      if (
        entry.isSymbolicLink() ||
        (!entry.isDirectory() && !allowed.has(relative)) ||
        (entry.isDirectory() && ![...allowed].some((file) => file.startsWith(`${relative}/`)))
      ) {
        throw new ArchiveExecutorError('STATE_CONFLICT', '旧归档目录包含未登记内容，保留文件供人工核查。')
      }
    }
    if (!prepared.old.retirementStartedAt || (await pathExists(path.join(oldDirectory, 'manifest.json')))) {
      await readArchiveManifestDigest(oldDirectory, prepared.old.archiveImport!.sealedManifestSha256!)
    }
    const remaining = []
    for (const item of prepared.frozen.media) {
      if (!prepared.old.retirementStartedAt || (await pathExists(path.join(oldDirectory, item.path)))) {
        remaining.push({ stagedPath: item.path, sha256: item.sha256, byteCount: BigInt(item.size) })
      }
    }
    await validateArchiveStoredMedia(oldDirectory, remaining)
  } else if (!prepared.old.retirementStartedAt) {
    throw new ArchiveExecutorError('MEDIA_INVALID', '旧部分归档目录缺失且没有清理检查点。')
  }
  await context.mutateInTransaction<Prisma.TransactionClient>(async (tx) => {
    await readPartialRetirementSnapshot(tx, payload)
    await tx.archiveRevision.update({
      where: { id: payload.revisionId },
      data: { retirementStartedAt: prepared.old.retirementStartedAt ?? new Date() }
    })
  })
  context.signal.throwIfAborted()
  await rm(oldDirectory, { recursive: true, force: true })
  return context.finalizeInTransaction<Prisma.TransactionClient>(async (scope) => {
    await publishExecutorMediaWrite(scope.transaction, write, 'committed', async (tx) => {
      await readPartialRetirementSnapshot(tx, payload)
      await tx.archiveRevision.update({ where: { id: payload.revisionId }, data: { retiredAt: new Date() } })
    })
    await scope.complete({ result: payload, message: '补全成功，旧部分归档副本已清理' })
  })
}
