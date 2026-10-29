import { freshQuickScope, verifyQuickScopeState } from './direct-delete-quick-verification.ts'
import { rootFor, state, freshScope } from './direct-delete-verification.ts'
import { randomUUID } from 'node:crypto'
import {
  ArtworkDedupOperationError,
  assertArtworkDedupDirectDeleteExecution,
  assertArtworkDedupDirectDeleteClaims,
  claimArtworkDedupScope,
  inspectArtworkDedupArchiveDrain,
  claimArtworkDedupOperationReader,
  recordArtworkDedupOperationReaderOwner,
  releaseArtworkDedupOperationReader,
  beginArtworkDedupDirectDeleteFiles,
  beginArtworkDedupFileStep,
  finishArtworkDedupFileStep,
  finalizeArtworkDedupDirectDelete,
  finishArtworkDedupDirectDeleteStop,
  Prisma
} from '@pixishelf/db'
import {
  PostgresQueueRepository,
  type QueueDatabase,
  type QueueSqlExecutor,
  type ExecutionContext,
  type EnqueuedChildJob
} from '@pixishelf/job-runtime'
import type { ArtworkDedupMaintenancePayload } from '@pixishelf/job-contracts'
import { ControlledDedupReader, DedupReaderSupervisor } from './reader.ts'
import { releaseExitedDedupReader } from './reader-latch.ts'
import { rootBindings, sameRootBindings } from './root-bindings.ts'
import type { ArtworkDedupMaintenanceDependencies } from './maintenance-executor.ts'
import { throwIfAborted } from '../scan/bounded.ts'

// Clean yields may retain verification only in this process and the unchanged queue/domain attempt.
const verificationProcessSession = randomUUID()
export function matchesVerificationResume(
  value: unknown,
  expected: { jobId: string; executionVersion: number; attempt: number; processSession: string }
) {
  if (!value || typeof value !== 'object') return false
  const marker = value as Record<string, unknown>
  return Object.entries(expected).every(([key, field]) => marker[key] === field)
}
type Tx = Prisma.TransactionClient & QueueSqlExecutor
type Transaction = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>
/** Gate is enforced by the registered maintenance dispatcher. Internal export permits isolated core tests. */
export async function executeArtworkDedupDirectDelete(
  context: ExecutionContext<ArtworkDedupMaintenancePayload, EnqueuedChildJob>,
  deps: ArtworkDedupMaintenanceDependencies
) {
  const execution = {
    operationId: context.payload.operationId,
    executionVersion: context.payload.executionVersion,
    jobId: context.job.id
  }
  const tx: Transaction = <T>(fn: (t: Prisma.TransactionClient) => Promise<T>) =>
    context.mutateInTransaction<Tx, T>((t) => fn(t))
  const started = (deps.now ?? Date.now)(),
    token = randomUUID()
  let reader: ControlledDedupReader | undefined,
    claimedReader = false,
    closed = true,
    failure: unknown,
    done = false,
    waiting = false,
    stopping = false
  try {
    const resumeIdentity = { ...execution, attempt: context.job.attempt, processSession: verificationProcessSession }
    const { op, resume } = await tx(async (t) => {
      const op = await assertArtworkDedupDirectDeleteExecution(t, execution, true)
      const resume = op.preparationVersion === 2 && matchesVerificationResume(op.verificationResume, resumeIdentity)
      // Consume before any I/O. A crash cannot leave a reusable grant for this execution.
      if (op.preparationVersion === 2)
        await t.artworkDedupOperation.update({ where: { id: op.id }, data: { verificationResume: Prisma.DbNull } })
      return { op, resume }
    })
    stopping = !!op.cancelRequestedAt
    const claims = await tx((t) => t.artworkDedupClaim.count({ where: { operationId: op.id } }))
    if (!stopping) {
      if (!claims) await tx((t) => claimArtworkDedupScope(t, { execution, expectedVersion: op.version }))
      else await tx((t) => assertArtworkDedupDirectDeleteClaims(t, execution))
    }
    const drain =
      stopping && !claims
        ? { drained: true, stopJobIds: [] }
        : await tx((t) => inspectArtworkDedupArchiveDrain(t, op.id))
    if (!drain.drained) {
      const repository = new PostgresQueueRepository(deps.database as unknown as QueueDatabase)
      for (const id of drain.stopJobIds) {
        try {
          await repository.requestCancellation(id)
        } catch (error) {
          // Unresolved original content declarations require their domain recovery; never clear a token here.
          if (
            !error ||
            typeof error !== 'object' ||
            !('code' in error) ||
            error.code !== 'MEDIA_CONTENT_RECOVERY_REQUIRED'
          ) {
            throw error
          }
        }
      }
      waiting = true
    } else if (!stopping) {
      await releaseExitedDedupReader(deps.database, deps.readerOptions)
      await tx((t) => claimArtworkDedupOperationReader(t, { execution, readerToken: token }))
      claimedReader = true
      closed = false
      reader = (deps.supervisor ?? new DedupReaderSupervisor(deps.readerOptions)).create()
      const owner = await reader.start(context.signal)
      await tx((t) => recordArtworkDedupOperationReaderOwner(t, { execution, readerToken: token, owner }))
      const inventory = await tx((t) =>
        t.pixivMetadataInventoryState.findUnique({ where: { id: 'pixiv' }, select: { rootIdentity: true } })
      )
      const request = {
        operation: 'roots' as const,
        sourceRoot: deps.sourceRoot,
        archiveRoot: deps.archiveRoot,
        expectedPixivRootIdentity: inventory?.rootIdentity ?? null
      }
      const roots = await reader.resolveRoots(request, context.signal)
      if (!sameRootBindings(op.rootBindings, rootBindings(roots))) throw new ArtworkDedupOperationError('ROOT_CHANGED')
      const verificationContext = {
        transaction: tx,
        execution,
        reader,
        roots,
        signal: context.signal,
        shouldYield: () =>
          (deps.now ?? Date.now)() - started >= (deps.sliceMs ?? 10000) ||
          reader!.metrics.bytesRead >= (deps.sliceBytes ?? 268435456n)
      }
      let freshComplete: boolean
      if (op.preparationVersion === 2) {
        let stage = resume ? op.stage : 'FRESH'
        if (!resume || !['FRESH', 'VERIFY_STATE', 'DELETE_FILES'].includes(stage)) {
          stage = 'FRESH'
          await tx(async (t) => {
            await assertArtworkDedupDirectDeleteExecution(t, execution)
            await t.artworkDedupOperation.update({
              where: { id: op.id },
              data: { status: 'VERIFYING', stage, afterArtworkId: 0, afterFileId: null, verifiedFiles: 0n }
            })
            await t.artworkDedupOperationArtwork.updateMany({
              where: { operationId: op.id },
              data: { freshVerifiedExecutionVersion: null, inspectionComplete: false }
            })
          })
        }
        freshComplete = stage === 'FRESH' ? await freshQuickScope(verificationContext) : true
        if (freshComplete) {
          if (stage !== 'VERIFY_STATE')
            await tx(async (t) => {
              await assertArtworkDedupDirectDeleteExecution(t, execution)
              await t.artworkDedupOperation.update({
                where: { id: op.id },
                data: { status: 'VERIFYING', stage: 'VERIFY_STATE', afterArtworkId: 0, afterFileId: null }
              })
            })
          freshComplete = await verifyQuickScopeState(verificationContext)
        }
      } else {
        if (op.stage !== 'FRESH')
          await tx(async (t) => {
            await assertArtworkDedupDirectDeleteExecution(t, execution)
            await t.artworkDedupOperation.update({
              where: { id: op.id },
              data: { status: 'VERIFYING', stage: 'FRESH', afterArtworkId: 0, afterFileId: null }
            })
            await t.artworkDedupOperationArtwork.updateMany({
              where: { operationId: op.id },
              data: { freshVerifiedExecutionVersion: null }
            })
          })
        freshComplete = await freshScope(verificationContext)
      }
      if (!sameRootBindings(op.rootBindings, rootBindings(await reader.resolveRoots(request, context.signal)))) {
        throw new ArtworkDedupOperationError('ROOT_CHANGED')
      }
      if (freshComplete) {
        await tx((t) => beginArtworkDedupDirectDeleteFiles(t, execution))
        const deleteStarted = (deps.now ?? Date.now)()
        for (;;) {
          const current = await tx((t) => assertArtworkDedupDirectDeleteExecution(t, execution, true))
          if (current.cancelRequestedAt) {
            stopping = true
            break
          }
          throwIfAborted(context.signal)
          const file = await tx((t) =>
            t.artworkDedupOperationFile.findFirst({
              where: { operationId: op.id, status: { not: 'DELETED' }, artwork: { role: 'COPY' } },
              orderBy: { fileId: 'asc' }
            })
          )
          if (!file) {
            done = true
            break
          }
          const root = rootFor(file, roots),
            expectedState = state(file)
          // Intent is durable before IPC. A persistence failure here makes zero filesystem calls.
          const intent = await tx((t) =>
            beginArtworkDedupFileStep(t, {
              execution,
              fileId: file.fileId,
              step: 'DELETE',
              expectedFileVersion: file.version
            })
          )
          await deps.onDirectDeleteBoundary?.('INTENT', file.fileId)
          await tx((t) => assertArtworkDedupDirectDeleteExecution(t, execution))
          const receipt = await reader.deleteFile({
            root,
            relativePath: file.canonicalPath,
            expectedState,
            allowMissing: intent.replayIntent ?? false,
            signal: context.signal
          })
          await deps.onDirectDeleteBoundary?.('UNLINKED', file.fileId)
          await tx(async (t) => {
            await finishArtworkDedupFileStep(t, {
              execution,
              fileId: file.fileId,
              step: 'DELETE',
              expectedFileVersion: file.version,
              receipt
            })
            await t.artworkDedupOperation.update({ where: { id: op.id }, data: { deletedFiles: { increment: 1 } } })
          })
          await deps.onDirectDeleteBoundary?.('RECEIPTED', file.fileId)
          if ((deps.now ?? Date.now)() - deleteStarted >= (deps.sliceMs ?? 10000)) break
        }
      }
    }
  } catch (error) {
    failure = error
  } finally {
    if (reader) {
      try {
        await reader.close()
        closed = true
      } catch (error) {
        failure = error
      }
    }
    if (claimedReader) {
      try {
        await deps.database.$transaction((t) =>
          releaseArtworkDedupOperationReader(t, { execution, readerToken: token, blocked: !closed })
        )
      } catch (error) {
        failure = error
      }
    }
  }
  return context.finalizeInTransaction<Tx>(async (scope) => {
    const op = await assertArtworkDedupDirectDeleteExecution(scope.transaction, execution, true)
    if (op.readerToken || !closed) {
      await scope.transaction.artworkDedupOperation.update({
        where: { id: op.id },
        data: { status: 'RECOVERY_REQUIRED', errorCode: 'READER_CLOSE_FAILED' }
      })
      await scope.pause({ reason: 'ACTION_REQUIRED', message: '读取进程尚未确认退出，删除范围保持锁定' })
    } else if (waiting) {
      await scope.transaction.artworkDedupOperation.update({
        where: { id: op.id },
        data: { status: 'DRAINING', stage: 'DRAIN' }
      })
      await scope.retry({
        availableAt: new Date((deps.now ?? Date.now)() + 3000),
        errorCode: 'RESOURCE_BUSY',
        error: 'Source executions not drained',
        message: '等待旧执行实际退出，已让出写入槽',
        preserveAttempt: true,
        schedulingYield: true
      })
    } else if (stopping || op.cancelRequestedAt || scope.executionStatus === 'CANCELLING') {
      const stopped = await finishArtworkDedupDirectDeleteStop(scope.transaction, execution)
      if (scope.executionStatus === 'CANCELLING') await scope.cancel('已在文件边界停止；未终结范围保持保护')
      else {
        await scope.complete({
          result: { operationId: op.id, status: stopped.status },
          message: stopped.status === 'CANCELLED' ? '删除前已取消' : '已在文件边界停止，已删除文件不可恢复'
        })
      }
    } else if (scope.executionStatus === 'PAUSING') {
      await scope.transaction.artworkDedupOperation.update({
        where: { id: op.id },
        data: { status: 'RECOVERY_REQUIRED', errorCode: 'PAUSED' }
      })
      await scope.pause({ reason: 'USER_REQUESTED', message: '已停止，原删除范围保持保护' })
    } else if (failure) {
      const code =
        failure && typeof failure === 'object' && 'code' in failure ? String(failure.code) : 'DIRECT_DELETE_FAILED'
      await scope.transaction.artworkDedupOperation.update({
        where: { id: op.id },
        data: { status: 'RECOVERY_REQUIRED', errorCode: code }
      })
      await scope.fail({ errorCode: 'INTERNAL_ERROR', error: code, message: '删除未完成，原范围和来源保护保持' })
    } else if (done) {
      await deps.onDirectDeleteBoundary?.('FINALIZE')
      const result = await finalizeArtworkDedupDirectDelete(scope.transaction, execution)
      await scope.complete({ result: { operationId: op.id, status: result.status }, message: '重复副本已永久删除' })
    } else if (context.signal.aborted) {
      await scope.release('删除等待原执行恢复，范围保持锁定')
    } else {
      if (op.preparationVersion === 2)
        await scope.transaction.artworkDedupOperation.update({
          where: { id: op.id },
          data: {
            verificationResume: {
              ...execution,
              attempt: context.job.attempt,
              processSession: verificationProcessSession
            }
          }
        })
      // This transaction both grants continuation and decrements the preserved queue attempt.
      // Expired leases do not decrement it; a restart also changes processSession.
      await scope.retry({
        availableAt: new Date((deps.now ?? Date.now)() + 3000),
        errorCode: 'RESOURCE_BUSY',
        error: 'Deletion yielded',
        message: '已保存逐文件回执，等待继续',
        preserveAttempt: true,
        schedulingYield: true
      })
    }
  })
}
