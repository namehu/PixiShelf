import {
  assertMediaContentDirectorySnapshot,
  captureMediaContentDirectory,
  type MediaContentDirectorySnapshot,
  type Prisma
} from '@pixishelf/db'
import type { ExecutionContext, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { resolveMediaContentRoots } from '../media-content/index.ts'
import { ScanExecutorError } from './errors.ts'

/** Capture before discovery; retaining a filtered list cannot protect reconcile from a paused upload. */
export async function captureScanMediaDirectory(input: {
  context: Pick<ExecutionContext, 'mutateInTransaction'>
  scanRoot: string
  relativeDirectory: string
}): Promise<MediaContentDirectorySnapshot> {
  const inventory = await input.context.mutateInTransaction<
    Prisma.TransactionClient & QueueSqlExecutor,
    { rootIdentity: string | null } | null
  >((transaction) =>
    transaction.pixivMetadataInventoryState.findUnique({
      where: { id: 'pixiv' },
      select: { rootIdentity: true }
    })
  )
  const roots = await resolveMediaContentRoots({
    sourceRoot: input.scanRoot,
    archiveRoot: input.scanRoot,
    expectedPixivRootIdentity: inventory?.rootIdentity ?? null
  })
  return input.context.mutateInTransaction<Prisma.TransactionClient & QueueSqlExecutor, MediaContentDirectorySnapshot>(
    async (transaction) => {
      const result = await captureMediaContentDirectory(transaction, {
        directory: {
          logicalRoot: roots.source.logicalRoot,
          rootIdentity: roots.source.rootIdentity,
          relativeDirectory: input.relativeDirectory === '.' ? '' : input.relativeDirectory
        }
      })
      if (result.status !== 'READY') throw conflict(result.status)
      return result.value
    }
  )
}

/** Call before Artwork locks or any publication DML inside the existing execution fence. */
export async function assertScanMediaDirectory(
  transaction: Prisma.TransactionClient,
  snapshot: MediaContentDirectorySnapshot
): Promise<void> {
  const result = await assertMediaContentDirectorySnapshot(transaction, { snapshot })
  if (result.status !== 'READY') throw conflict(result.status)
}

function conflict(status: string) {
  return new ScanExecutorError(
    'STATE_CONFLICT',
    `Media directory changed or has an unfinished writer (${status}); keep the previous registered media`
  )
}
