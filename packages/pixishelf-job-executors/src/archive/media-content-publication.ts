import {
  rebindCompletedArchivePublicationMediaWrite,
  type MediaContentDirectoryKey,
  type MediaContentOwner,
  type Prisma
} from '@pixishelf/db'
import type { ExecutionContext, QueueSqlExecutor } from '@pixishelf/job-runtime'
import type { ExecutorMediaWrite } from '../scan/media-content-write.ts'
import { ArchiveExecutorError } from './errors.ts'
import { assertCompletedArchivePublication, type ArchiveStoragePaths } from './storage.ts'

/** This recovery path is only for an immutable revision whose rename already completed. */
export async function recoverCompletedArchivePublicationWrite(input: {
  context: Pick<ExecutionContext, 'mutateInTransaction'> & {
    job: Pick<ExecutionContext['job'], 'id' | 'executionToken' | 'attempt'>
  }
  directory: MediaContentDirectoryKey
  paths: ArchiveStoragePaths
  archiveImport: Parameters<typeof assertCompletedArchivePublication>[2] & {
    generationToken: string | null
    sealedManifestSha256: string | null
    stagingPath: string
  }
  expectedArtworkId: number | null
  now: Date
}): Promise<ExecutorMediaWrite | null> {
  const { context, archiveImport } = input
  const sessionId = `archive-publish:${archiveImport.id}`
  const rows = await context.mutateInTransaction<
    Prisma.TransactionClient & QueueSqlExecutor,
    Prisma.MediaContentPathWriteGetPayload<{}>[]
  >((tx) =>
    tx.mediaContentPathWrite.findMany({
      where: {
        jobId: context.job.id,
        sessionId,
        scope: 'DIRECTORY',
        parentWriteId: null,
        directory: input.directory,
        status: { in: ['ACTIVE', 'READY', 'RECOVERY_REQUIRED'] }
      },
      take: 2
    })
  )
  if (!rows.length) return null
  if (rows.length !== 1 || !archiveImport.generationToken || !archiveImport.sealedManifestSha256)
    throw new ArchiveExecutorError('STATE_CONFLICT', '归档发布恢复声明不唯一或缺少封存证明')
  const row = rows[0]!
  if (!row.jobId || !row.executionToken || row.executionAttempt === null)
    throw new ArchiveExecutorError('STATE_CONFLICT', '归档发布恢复声明缺少执行身份')
  await assertCompletedArchivePublication(input.paths, archiveImport.sealedManifestSha256, archiveImport)
  const owner: MediaContentOwner = {
    ownerUserId: null,
    sessionId,
    sessionVersion: 1n,
    execution: {
      jobId: context.job.id,
      executionToken: context.job.executionToken,
      executionAttempt: context.job.attempt
    }
  }
  return context.mutateInTransaction<Prisma.TransactionClient & QueueSqlExecutor, ExecutorMediaWrite>(async (tx) => {
    const result = await rebindCompletedArchivePublicationMediaWrite(tx, {
      owner,
      previous: {
        owner: {
          ownerUserId: row.ownerUserId,
          sessionId: row.sessionId,
          sessionVersion: row.sessionVersion,
          execution: { jobId: row.jobId!, executionToken: row.executionToken!, executionAttempt: row.executionAttempt! }
        },
        handle: {
          writeId: row.id,
          directoryId: row.directoryId,
          writeToken: row.writeToken,
          declarationVersion: row.declarationVersion,
          scope: { kind: 'DIRECTORY' },
          parentWriteId: row.parentWriteId
        },
        source: {
          writeToken: row.writeToken,
          artworkIds: input.expectedArtworkId === null ? [] : [input.expectedArtworkId],
          imageIds: []
        }
      },
      expectedArtworkId: input.expectedArtworkId,
      proof: {
        kind: 'FINAL_VERIFIED_STAGING_ABSENT',
        archiveImportId: archiveImport.id,
        generationToken: archiveImport.generationToken!,
        manifestSha256: archiveImport.sealedManifestSha256!,
        stagingPath: archiveImport.stagingPath,
        finalDirectory: input.directory
      },
      now: input.now
    })
    if (result.status !== 'READY')
      throw new ArchiveExecutorError('STATE_CONFLICT', `归档发布声明交接被拒绝 (${result.status})`)
    return { owner: result.value.owner, handles: [result.value.handle], source: result.value.source }
  })
}
