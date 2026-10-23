import { readExecutorMediaRecoveryDomainSnapshot } from './media-content-recovery.ts'
import { createHash } from 'node:crypto'
import {
  assertMediaContentOwnerPublication,
  beginMediaContentPathWrite,
  beginMediaContentSourceWrite,
  consumeMediaContentRecovery,
  finishMediaContentSourceWrite,
  resumeMediaContentSourceWrite,
  withMediaContentOwnerPublication,
  type MediaContentDirectoryKey,
  type MediaContentOwner,
  type MediaContentSourceWriteToken,
  type MediaContentWriteHandle,
  type MediaContentWriteScope,
  type Prisma
} from '@pixishelf/db'
import type { ExecutionContext, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { resolveMediaContentRoots } from '../media-content/index.ts'
import { ScanExecutorError } from './errors.ts'

export interface ExecutorMediaWrite {
  owner: MediaContentOwner
  handles: MediaContentWriteHandle[]
  source: MediaContentSourceWriteToken
}

/** Resolves root identity outside transactions. The caller keeps its existing runtime fence. */
export async function resolveExecutorMediaDirectory(input: {
  context: Pick<ExecutionContext, 'mutateInTransaction'>
  sourceRoot: string
  archiveRoot?: string
  relativeDirectory: string
  location?: 'source' | 'archive'
}): Promise<MediaContentDirectoryKey> {
  const inventory = await input.context.mutateInTransaction<
    Prisma.TransactionClient & QueueSqlExecutor,
    { rootIdentity: string | null } | null
  >((transaction) =>
    transaction.pixivMetadataInventoryState.findUnique({ where: { id: 'pixiv' }, select: { rootIdentity: true } })
  )
  const roots = await resolveMediaContentRoots({
    sourceRoot: input.sourceRoot,
    archiveRoot: input.archiveRoot ?? input.sourceRoot,
    expectedPixivRootIdentity: inventory?.rootIdentity ?? null
  })
  const root = input.location === 'archive' ? roots.archive : roots.source
  const directory = input.relativeDirectory.replace(/^\/+/, '')
  const relativeDirectory =
    input.location === 'archive' && roots.archiveRelativePrefix
      ? [roots.archiveRelativePrefix, directory].filter(Boolean).join('/')
      : directory
  return {
    logicalRoot: root.logicalRoot,
    rootIdentity: root.rootIdentity,
    relativeDirectory: relativeDirectory === '.' ? '' : relativeDirectory
  }
}

/** Commit this declaration before touching any registered bytes or their destination. */
export async function beginExecutorMediaWrite(input: {
  context: Pick<ExecutionContext, 'mutateInTransaction'> & {
    job: Pick<ExecutionContext['job'], 'id' | 'executionToken' | 'attempt'>
  }
  directory: MediaContentDirectoryKey
  scope: MediaContentWriteScope
  sessionId: string
  artworkIds?: number[]
  imageIds?: number[]
  now?: Date
}): Promise<ExecutorMediaWrite> {
  const owner: MediaContentOwner = {
    ownerUserId: null,
    sessionId: input.sessionId,
    sessionVersion: 1n,
    execution: {
      jobId: input.context.job.id,
      executionToken: input.context.job.executionToken,
      executionAttempt: input.context.job.attempt
    }
  }
  const writeToken = workerWriteToken(owner, input.directory, input.scope)
  return input.context.mutateInTransaction<Prisma.TransactionClient & QueueSqlExecutor, ExecutorMediaWrite>(
    async (transaction) => {
      const recovered = await consumeMediaContentRecovery(transaction, {
        owner,
        expectedScopes: [{ directory: input.directory, scope: input.scope }],
        artworkIds: input.artworkIds ?? [],
        imageIds: input.imageIds ?? [],
        readDomainSnapshot: readExecutorMediaRecoveryDomainSnapshot,
        now: input.now ?? new Date()
      })
      if (recovered.status === 'READY') return recovered.value
      if (recovered.status !== 'MISSING')
        throw new ScanExecutorError('STATE_CONFLICT', `Media recovery grant is invalid (${recovered.status})`)
      const started = await beginMediaContentPathWrite(transaction, {
        directory: input.directory,
        scope: input.scope,
        owner,
        writeToken,
        upload: null,
        parent: null,
        now: input.now ?? new Date()
      })
      if (started.status !== 'READY')
        throw new ScanExecutorError('STATE_CONFLICT', `Media write is blocked (${started.status})`)
      const source = await beginOrResumeSourceWrite(transaction, {
        artworkIds: input.artworkIds ?? [],
        imageIds: input.imageIds ?? [],
        writeToken,
        now: input.now ?? new Date()
      })
      return { owner, handles: [started.value], source }
    }
  )
}

/** Business DML and gate release are one transaction; an uncertain outcome never unlocks files. */
export async function publishExecutorMediaWrite<T>(
  transaction: Prisma.TransactionClient,
  write: ExecutorMediaWrite,
  outcome: 'committed' | 'verified-rollback',
  publish: (transaction: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  const result = await withMediaContentOwnerPublication(
    transaction,
    { owner: write.owner, handles: write.handles, outcome, now: new Date() },
    async (tx) => {
      const result = await publish(tx)
      if (!(await finishMediaContentSourceWrite(tx, { token: write.source, outcome }))) {
        throw new ScanExecutorError('STATE_CONFLICT', 'Media source write ownership changed before publication')
      }
      return result
    }
  )
  return result.result
}

/** Multiple migration directories share one owner and source epoch; no file list is widened. */
export async function beginExecutorMediaDirectoryWrites(input: {
  context: Pick<ExecutionContext, 'mutateInTransaction'> & {
    job: Pick<ExecutionContext['job'], 'id' | 'executionToken' | 'attempt'>
  }
  directories: MediaContentDirectoryKey[]
  sessionId: string
  artworkIds: number[]
}): Promise<ExecutorMediaWrite> {
  if (
    !input.directories.length ||
    input.directories.length > 100 ||
    new Set(
      input.directories.map((directory) =>
        JSON.stringify([directory.logicalRoot, directory.rootIdentity, directory.relativeDirectory])
      )
    ).size !== input.directories.length
  ) {
    throw new ScanExecutorError('STATE_CONFLICT', 'Media write requires 1–100 unique directory declarations')
  }
  const owner: MediaContentOwner = {
    ownerUserId: null,
    sessionId: input.sessionId,
    sessionVersion: 1n,
    execution: {
      jobId: input.context.job.id,
      executionToken: input.context.job.executionToken,
      executionAttempt: input.context.job.attempt
    }
  }
  const directories = [...input.directories].sort((a, b) =>
    a.logicalRoot < b.logicalRoot
      ? -1
      : a.logicalRoot > b.logicalRoot
        ? 1
        : a.relativeDirectory < b.relativeDirectory
          ? -1
          : a.relativeDirectory > b.relativeDirectory
            ? 1
            : 0
  )
  return input.context.mutateInTransaction<Prisma.TransactionClient & QueueSqlExecutor, ExecutorMediaWrite>(
    async (transaction) => {
      const recovered = await consumeMediaContentRecovery(transaction, {
        owner,
        expectedScopes: directories.map((directory) => ({ directory, scope: { kind: 'DIRECTORY' as const } })),
        artworkIds: input.artworkIds,
        imageIds: [],
        readDomainSnapshot: readExecutorMediaRecoveryDomainSnapshot,
        now: new Date()
      })
      if (recovered.status === 'READY') return recovered.value
      if (recovered.status !== 'MISSING')
        throw new ScanExecutorError('STATE_CONFLICT', `Media recovery grant is invalid (${recovered.status})`)
      const handles: MediaContentWriteHandle[] = []
      for (const directory of directories) {
        const started = await beginMediaContentPathWrite(transaction, {
          directory,
          scope: { kind: 'DIRECTORY' },
          owner,
          writeToken: workerWriteToken(owner, directory, { kind: 'DIRECTORY' }),
          upload: null,
          parent: null,
          now: new Date()
        })
        if (started.status !== 'READY')
          throw new ScanExecutorError('STATE_CONFLICT', `Media write is blocked (${started.status})`)
        handles.push(started.value)
      }
      const source = await beginOrResumeSourceWrite(transaction, {
        artworkIds: input.artworkIds,
        imageIds: [],
        writeToken: handles[0]!.writeToken,
        now: new Date()
      })
      return { owner, handles, source }
    }
  )
}

export function assertExecutorMediaWrite(transaction: Prisma.TransactionClient, write: ExecutorMediaWrite) {
  return assertMediaContentOwnerPublication(transaction, { owner: write.owner, handles: write.handles })
}

function workerWriteToken(
  owner: MediaContentOwner,
  directory: MediaContentDirectoryKey,
  scope: MediaContentWriteScope
): string {
  // A trusted execution owns this stable token; no caller can discover or claim it merely by naming a file path.
  const encoded = JSON.stringify([
    'worker-media-write:v1',
    owner.ownerUserId,
    owner.sessionId,
    owner.sessionVersion.toString(),
    owner.execution?.jobId,
    owner.execution?.executionToken,
    owner.execution?.executionAttempt,
    directory.logicalRoot,
    directory.rootIdentity,
    directory.relativeDirectory,
    scope.kind,
    scope.kind === 'PATH' ? scope.relativePath : null
  ])
  const bytes = createHash('sha256').update(encoded).digest().subarray(0, 16)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = bytes.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function beginOrResumeSourceWrite(
  transaction: Prisma.TransactionClient,
  input: {
    artworkIds: number[]
    imageIds: number[]
    writeToken: string
    now: Date
  }
) {
  const token = { artworkIds: input.artworkIds, imageIds: input.imageIds, writeToken: input.writeToken }
  const resumed = await resumeMediaContentSourceWrite(transaction, { token })
  if (resumed.status === 'READY') return resumed.value
  if (resumed.status !== 'MISSING')
    throw new ScanExecutorError('STATE_CONFLICT', `Media source ownership changed (${resumed.status})`)
  return beginMediaContentSourceWrite(transaction, input)
}
