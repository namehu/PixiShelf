import { executeArtworkDedupDirectDelete } from './direct-delete.ts'
import { randomUUID } from 'node:crypto'
import {
  ArtworkDedupOperationError,
  assertArtworkDedupOperationExecution,
  claimArtworkDedupOperationReader,
  completeArtworkDedupPrepare,
  readArtworkDedupOperationArtworksPage,
  recordArtworkDedupOperationReaderOwner,
  releaseArtworkDedupOperationReader,
  updateArtworkDedupOperationCheckpoint,
  type ArtworkDedupOperationExecution,
  type Prisma,
  type PrismaClient
} from '@pixishelf/db'
import {
  artworkDedupMaintenanceV1PayloadSchema,
  artworkDedupMaintenanceV2PayloadSchema,
  artworkDedupMaintenanceV3PayloadSchema,
  artworkDedupMaintenanceV4PayloadSchema,
  artworkDedupMaintenanceV5PayloadSchema,
  ARTWORK_DEDUP_DIRECT_DELETE_DEFINITION_VERSION,
  assertArtworkDedupMaintenanceModeEnabled,
  type ArtworkDedupMaintenancePayload
} from '@pixishelf/job-contracts'
import type { ExecutionContext, ExecutorDefinition, EnqueuedChildJob, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { MediaContentFileError } from '../media-content/roots.ts'
import { throwIfAborted } from '../scan/bounded.ts'
import { ARTWORK_DEDUP_LIMITS as limits } from './limits.ts'
import {
  ControlledDedupReader,
  DedupReaderError,
  DedupReaderSupervisor,
  type DedupReaderOptions,
  type ReaderMetrics
} from './reader.ts'
import {
  DedupPrepareError,
  prepareArtworkDirectory,
  prepareArtworkInventory,
  type DedupPrepareContext
} from './maintenance-prepare.ts'
import { MaintenanceFileError } from './maintenance-files.ts'
import { releaseExitedDedupReader } from './reader-latch.ts'
import { rootBindings, sameRootBindings } from './root-bindings.ts'

type Tx = Prisma.TransactionClient & QueueSqlExecutor
export interface ArtworkDedupMaintenanceDependencies {
  database: PrismaClient
  sourceRoot: string
  archiveRoot: string
  readerOptions: DedupReaderOptions
  supervisor?: DedupReaderSupervisor
  now?: () => number
  sliceMs?: number
  sliceBytes?: bigint
  onDirectDeleteBoundary?: (boundary: 'INTENT' | 'UNLINKED' | 'RECEIPTED' | 'FINALIZE', fileId?: string) => Promise<void>
  onMeasurement?: (value: ReaderMetrics & { operationId: string; elapsedMs: number }) => void
}
export function createArtworkDedupMaintenanceExecutor(
  dependencies: ArtworkDedupMaintenanceDependencies,
  definitionVersion: 1 | 2 | 3 | 4 | typeof ARTWORK_DEDUP_DIRECT_DELETE_DEFINITION_VERSION = 1
): ExecutorDefinition {
  const supervisor = dependencies.supervisor ?? new DedupReaderSupervisor(dependencies.readerOptions)
  return {
    jobType: 'ARTWORK_DEDUP_MAINTENANCE',
    definitionVersion,
    executionLane: 'BACKGROUND_WRITER',
    progressPolicy: 'STANDARD',
    parsePayload: (value) =>
      (definitionVersion === 1 ? artworkDedupMaintenanceV1PayloadSchema : definitionVersion === 2 ? artworkDedupMaintenanceV2PayloadSchema : definitionVersion === 3 ? artworkDedupMaintenanceV3PayloadSchema : definitionVersion === 4 ? artworkDedupMaintenanceV4PayloadSchema : artworkDedupMaintenanceV5PayloadSchema).parse(value),
    execute: (context: ExecutionContext<ArtworkDedupMaintenancePayload, EnqueuedChildJob>) =>
      executeArtworkDedupMaintenance(context, { ...dependencies, supervisor })
  } as ExecutorDefinition
}
export async function executeArtworkDedupMaintenance(
  context: ExecutionContext<ArtworkDedupMaintenancePayload, EnqueuedChildJob>,
  dependencies: ArtworkDedupMaintenanceDependencies
) {
  if (context.payload.mode === 'DIRECT_DELETE') {
    assertArtworkDedupMaintenanceModeEnabled('DIRECT_DELETE', 'DIRECT_DELETE')
    return executeArtworkDedupDirectDelete(context, dependencies)
  }
  const now = dependencies.now ?? Date.now,
    started = now()
  const execution: ArtworkDedupOperationExecution = {
    operationId: context.payload.operationId,
    executionVersion: context.payload.executionVersion,
    jobId: context.job.id
  }
  const transaction: DedupPrepareContext['transaction'] = <T>(action: (tx: Prisma.TransactionClient) => Promise<T>) =>
    context.mutateInTransaction<Tx, T>((tx) => action(tx))
  const readerToken = randomUUID()
  let reader: ControlledDedupReader | undefined,
    failure: unknown,
    progressFailure: unknown,
    progressPending: Promise<void> | undefined
  let claimed = false,
    done = false,
    stage = 'INVENTORY'
  try {
    throwIfAborted(context.signal)
    const initial = await transaction((tx) => assertArtworkDedupOperationExecution(tx, execution))
    if ((initial.preparePurpose === 'DIRECT_DELETE') !== ('purpose' in context.payload && context.payload.purpose === 'DIRECT_DELETE'))
      {throw new DedupPrepareError('DIRECT_DELETE_PROTOCOL_REQUIRED')}
    assertArtworkDedupMaintenanceModeEnabled(
      context.payload.mode,
      initial.preparePurpose === 'DIRECT_DELETE' ? 'DIRECT_DELETE' : initial.preparePurpose === 'PURGE' ? 'PURGE' : 'ISOLATION'
    )
    if (context.payload.mode !== 'PREPARE' || !['ISOLATION', 'DIRECT_DELETE'].includes(initial.preparePurpose))
      {throw new DedupPrepareError('ARTWORK_DEDUP_MODE_DISABLED')}
    stage = initial.stage
    if (!['INVENTORY', 'INSPECT', 'VERIFY'].includes(stage)) throw new DedupPrepareError('INVALID_CHECKPOINT')
    await releaseExitedDedupReader(dependencies.database, dependencies.readerOptions)
    await transaction((tx) => claimArtworkDedupOperationReader(tx, { execution, readerToken }))
    claimed = true
    reader = (dependencies.supervisor ?? new DedupReaderSupervisor(dependencies.readerOptions)).create()
    let lastProgress = initial.lastProgressAt?.getTime() ?? started
    reader.onProgress = (metrics) => {
      if (progressPending || now() - lastProgress < limits.progressMs || context.signal.aborted) return
      lastProgress = now()
      progressPending = context
        .progress({
          progress: Math.min(
            99,
            Math.floor((initial.preparedArtworks / Math.max(1, initial.keepers + initial.copies)) * 100)
          ),
          stage,
          message: '正在生成清理预览',
          data: {
            operationId: execution.operationId,
            inspectedFiles: metrics.inspections,
            readBytes: metrics.bytesRead.toString()
          }
        })
        .catch(async (error: unknown) => {
          progressFailure = error
          await reader!.close(error instanceof Error ? error : new Error('Progress persistence failed'))
        })
        .finally(() => {
          progressPending = undefined
        })
      void progressPending.catch(() => undefined)
    }
    const owner = await reader.start(context.signal)
    await transaction((tx) => recordArtworkDedupOperationReaderOwner(tx, { execution, readerToken, owner }))
    const inventory = await transaction((tx) =>
      tx.pixivMetadataInventoryState.findUnique({ where: { id: 'pixiv' }, select: { rootIdentity: true } })
    )
    const request = {
      operation: 'roots' as const,
      sourceRoot: dependencies.sourceRoot,
      archiveRoot: dependencies.archiveRoot,
      expectedPixivRootIdentity: inventory?.rootIdentity ?? null
    }
    const roots = await reader.resolveRoots(request, context.signal)
    const bindings = rootBindings(roots)
    if (!sameRootBindings(initial.rootBindings, bindings))
      {throw new MediaContentFileError('ROOT_CHANGED', 'ROOT_CHANGED')}
    const shouldYield = () =>
      now() - started >= (dependencies.sliceMs ?? limits.sliceMs) ||
      reader!.metrics.bytesRead >= (dependencies.sliceBytes ?? limits.sliceBytes)
    const pipeline: DedupPrepareContext = { execution, transaction, roots, reader, signal: context.signal, shouldYield }
    while (!shouldYield()) {
      throwIfAborted(context.signal)
      if (progressFailure) throw progressFailure
      if (stage === 'VERIFY') {
        done = true
        break
      }
      const current = await transaction((tx) => assertArtworkDedupOperationExecution(tx, execution))
      if (!sameRootBindings(current.rootBindings, bindings))
        {throw new MediaContentFileError('ROOT_CHANGED', 'ROOT_CHANGED')}
      const [item] = await transaction((tx) =>
        readArtworkDedupOperationArtworksPage(tx, { execution, afterArtworkId: current.afterArtworkId, limit: 1 })
      )
      if (!item) {
        stage = stage === 'INVENTORY' ? 'INSPECT' : 'VERIFY'
        await transaction((tx) =>
          updateArtworkDedupOperationCheckpoint(tx, { execution, data: { stage, afterArtworkId: 0 } })
        )
        continue
      }
      const complete =
        stage === 'INVENTORY'
          ? item.inventoryComplete || (await prepareArtworkInventory(pipeline, item))
          : item.inspectionComplete || (await prepareArtworkDirectory(pipeline, item))
      if (complete)
        {await transaction((tx) =>
          updateArtworkDedupOperationCheckpoint(tx, {
            execution,
            data: {
              afterArtworkId: item.artworkId,
              ...(stage === 'INSPECT' ? { preparedArtworks: { increment: 1 } } : {})
            }
          })
        )}
    }
    if (!sameRootBindings(bindings, rootBindings(await reader.resolveRoots(request, context.signal))))
      {throw new MediaContentFileError('ROOT_CHANGED', 'ROOT_CHANGED')}
  } catch (error) {
    failure = error
  } finally {
    if (reader) reader.onProgress = undefined
    try {
      await progressPending
    } catch (error) {
      failure = error
    }
    failure ??= progressFailure
    let closed = !reader
    if (reader)
      {try {
        await reader.close()
        closed = true
      } catch (error) {
        failure = error
      }}
    if (claimed)
      {try {
        await dependencies.database.$transaction((tx) =>
          releaseArtworkDedupOperationReader(tx, { execution, readerToken, blocked: !closed })
        )
      } catch (error) {
        failure = error
      }}
    if (reader)
      {dependencies.onMeasurement?.({
        ...reader.metrics,
        operationId: execution.operationId,
        elapsedMs: now() - started
      })}
  }
  return context.finalizeInTransaction<Tx>(async (scope) => {
    const op = await assertArtworkDedupOperationExecution(scope.transaction, execution, { allowControl: true })
    if (failure instanceof DedupReaderError && failure.code === 'READER_CLOSE_FAILED') {
      await updateArtworkDedupOperationCheckpoint(scope.transaction, {
        execution,
        allowControl: true,
        data: { errorCode: 'READER_CLOSE_FAILED' }
      })
      if (scope.executionStatus === 'CANCELLING') throw failure
      await scope.pause({ reason: 'ACTION_REQUIRED', message: '读取进程尚未确认退出，请完成恢复处理' })
      return
    }
    if (scope.executionStatus === 'CANCELLING') {
      await scope.cancel('预览已取消，原媒体保留')
      return
    }
    if (scope.executionStatus === 'PAUSING') {
      await scope.pause({ reason: 'USER_REQUESTED', message: '预览已暂停，检查点已保存' })
      return
    }
    if (context.signal.aborted) {
      await scope.release('预览等待 Worker 恢复')
      return
    }
    if (failure) {
      const stale =
        (failure instanceof DedupPrepareError && failure.code === 'SNAPSHOT_CHANGED') ||
        (failure instanceof ArtworkDedupOperationError && failure.code === 'STALE')
      if (stale) {
        const result = await completeArtworkDedupPrepare(scope.transaction, { execution })
        if (result.status !== 'STALE') throw failure
        await scope.complete({
          result: { operationId: op.id, status: result.status },
          message: '来源已变化，请重新生成预览'
        })
        return
      }
      const code =
        failure instanceof MediaContentFileError ||
        failure instanceof DedupPrepareError ||
        failure instanceof DedupReaderError ||
        failure instanceof MaintenanceFileError ||
        failure instanceof ArtworkDedupOperationError
          ? failure.code
          : failure instanceof Error && failure.message === 'ARTWORK_DEDUP_MODE_DISABLED'
            ? failure.message
            : 'PREPARE_ENVIRONMENT'
      await updateArtworkDedupOperationCheckpoint(scope.transaction, { execution, data: { errorCode: code } })
      await scope.fail({ errorCode: 'INTERNAL_ERROR', error: code, message: '预览未完成，请检查后重试' })
      return
    }
    if (done) {
      const result = await completeArtworkDedupPrepare(scope.transaction, { execution })
      await scope.complete({
        result: { operationId: op.id, status: result.status },
        message: result.status === 'READY' ? '清理预览已生成' : '预览存在阻断项，请查看详情'
      })
      return
    }
    if (!op.lastProgressAt || now() - op.lastProgressAt.getTime() >= limits.progressMs) {
      await updateArtworkDedupOperationCheckpoint(scope.transaction, {
        execution,
        data: { lastProgressAt: new Date(now()) }
      })
      await scope.transaction.systemJob.update({
        where: { id: context.job.id },
        data: { stage: op.stage, message: `正在生成预览 · 已检查 ${op.preparedFiles} 个文件` }
      })
    }
    await scope.retry({
      availableAt: new Date(now() + limits.cooldownMs),
      errorCode: 'RESOURCE_BUSY',
      error: 'Preparation yielded',
      message: '预览已保存检查点，等待继续',
      preserveAttempt: true,
      schedulingYield: true
    })
  })
}
