import { Prisma, type PrismaClient } from '@pixishelf/db'
import {
  artworkBatchDeletePayloadSchema,
  artworkBatchDeleteResultSchema,
  type ArtworkBatchDeletePayload
} from '@pixishelf/job-contracts'
import { JobExecutionFenceError } from '@pixishelf/job-runtime'
import type { ExecutionContext, ExecutorDefinition, QueueSqlExecutor, EnqueuedChildJob } from '@pixishelf/job-runtime'
import { z } from 'zod'
import { ContentWriteConflict } from './content-context.ts'
import { fileErrorCode } from './delete-artwork-files.ts'
import { createArtworkDeletionService } from './delete-artwork.ts'
import { createDeletionContentContext } from './content-context.ts'
import { createDeletionGuard } from './deletion-content-guard.ts'
import { createArchiveArtworkMaintenanceRequest } from './archive-request.ts'

type Tx = Prisma.TransactionClient & QueueSqlExecutor
export function createArtworkBatchDeleteExecutor(deps: {
  database: PrismaClient
  sourceRoot: string
  archiveRoot: string
}): ExecutorDefinition {
  return {
    jobType: 'ARTWORK_BATCH_DELETE',
    definitionVersion: 1,
    executionLane: 'BACKGROUND_WRITER',
    progressPolicy: 'STANDARD',
    parsePayload: (value) => artworkBatchDeletePayloadSchema.parse(value),
    execute: (context) =>
      executeArtworkBatchDelete(
        context as unknown as ExecutionContext<ArtworkBatchDeletePayload, EnqueuedChildJob>,
        deps
      )
  }
}

export async function executeArtworkBatchDelete(
  context: ExecutionContext<ArtworkBatchDeletePayload, EnqueuedChildJob>,
  deps: { database: PrismaClient; sourceRoot: string; archiveRoot: string }
) {
  const { database } = deps
  if (!context.payload.confirmed) {
    return { kind: 'skipped' as const, reason: 'PRECONDITION_NOT_MET' as const, message: '删除尚未确认' }
  }
  const owner = await database.systemJob.findUniqueOrThrow({
    where: { id: context.job.id },
    select: { requestedByUserId: true, availableAt: true, lastAttemptStartedAt: true }
  })
  const userId = owner.requestedByUserId
  if (!userId) return { kind: 'failed' as const, errorCode: 'INTERNAL_ERROR' as const, error: '删除任务缺少请求账户' }
  context.logger.info('[ArtworkBatchDelete] Started', {
    artworks: context.payload.items.length,
    attempt: context.job.attempt,
    queueMs: owner.lastAttemptStartedAt
      ? Math.max(0, owner.lastAttemptStartedAt.getTime() - owner.availableAt.getTime())
      : null
  })
  const checkExecution = () => context.signal.throwIfAborted()
  const transaction = <T>(body: (tx: Prisma.TransactionClient) => Promise<T>) =>
    context.mutateInTransaction<Tx, T>(body)
  const requestArchive = createArchiveArtworkMaintenanceRequest({
    writeJobEvent: (tx, event) => tx.systemJobEvent.create({ data: event })
  })
  const deletion = createArtworkDeletionService({
    database,
    getScanPath: async () => deps.sourceRoot,
    guard: createDeletionGuard(database, createDeletionContentContext(database, deps.archiveRoot)),
    requestArchiveArtworkMaintenance: (input) => transaction((tx) => requestArchive(input, tx)),
    logger: context.logger
  })
  const job = await database.systemJob.findUniqueOrThrow({ where: { id: context.job.id }, select: { result: true } })
  const parsed = artworkBatchDeleteResultSchema.safeParse(job.result)
  const result = parsed.success ? parsed.data : { items: [] }
  const save = () =>
    transaction(async (tx) => {
      await tx.systemJob.update({ where: { id: context.job.id }, data: { result: result as Prisma.InputJsonValue } })
    })
  let stopped = false
  for (const item of context.payload.items) {
    checkExecution()
    const current = await database.systemJob.findUniqueOrThrow({
      where: { id: context.job.id },
      select: { payload: true }
    })
    if (artworkBatchDeletePayloadSchema.parse(current.payload).stopAfterCurrent) {
      stopped = true
      break
    }
    let state = result.items.find((entry) => entry.artworkId === item.artworkId)
    if (
      state &&
      (state.status === 'DELETED' ||
        state.status === 'TRASH_SUBMITTED' ||
        (state.status === 'FAILED' && state.round === context.payload.round))
    ) {
      continue
    }
    if (!state) {
      state = {
        artworkId: item.artworkId,
        round: context.payload.round,
        status: 'PROCESSING',
        report: null,
        message: '正在删除'
      }
      result.items.push(state)
    }
    Object.assign(state, { round: context.payload.round, status: 'PROCESSING', message: '正在删除' })
    await save()
    await context.progress({
      progress: Math.floor(
        (result.items.filter((entry) => entry.status !== 'PROCESSING').length / context.payload.items.length) * 100
      ),
      stage: 'DELETING',
      message: `正在处理作品 #${item.artworkId}`
    })
    const started = performance.now()
    const phases: Record<'PREPARATION' | 'FILES' | 'DATABASE', number | null> = {
      PREPARATION: null,
      FILES: null,
      DATABASE: null
    }
    const observe = (phase: keyof typeof phases, milliseconds: number) => {
      phases[phase] = (phases[phase] ?? 0) + milliseconds
    }
    try {
      const report = await deletion.deleteArtwork(
        { artworkId: item.artworkId, operationId: item.operationId, selectedPaths: item.selectedPaths },
        { requestedByUserId: userId, control: { checkExecution, transaction, observe } }
      )
      state.report = report
      state.status =
        report.outcome === 'COMPLETED' ? 'DELETED' : report.outcome === 'QUEUED' ? 'TRASH_SUBMITTED' : 'FAILED'
      state.message =
        report.outcome === 'COMPLETED'
          ? '已永久删除'
          : report.outcome === 'QUEUED'
            ? report.archive?.lifecycleState === 'TRASHED'
              ? '文件已移入回收站'
              : '回收已提交，等待文件移动'
            : report.warnings.some((warning) => warning.includes('（WRITING）'))
              ? '作品正在写入，请待当前任务结束后按原范围重试'
              : report.warnings.some((warning) => warning.includes('（ROOT_CHANGED）'))
                ? '媒体根目录已变化，请核对原目录和删除记录后重试'
                : (report.warnings.at(-1) ?? '删除未完成，请按原范围重试')
    } catch (error) {
      checkExecution()
      if (error instanceof JobExecutionFenceError) throw error
      state.status = 'FAILED'
      const code = fileErrorCode(error)
      state.message =
        error instanceof ContentWriteConflict
          ? error.message
          : error instanceof SyntaxError || error instanceof z.ZodError
            ? '原删除清单损坏或不符合格式，请核对原清单后重试'
            : error instanceof Error && /^Artwork [1-9][0-9]* not found$/.test(error.message)
              ? `作品 #${item.artworkId} 已不存在，未执行新的文件删除`
              : code === 'REPLACE_WRITE_LOCK_BUSY'
                ? '原删除文件锁仍被占用，请在停写维护后核对原操作；不会自动移除文件锁'
                : ['EACCES', 'EPERM'].includes(code)
                  ? '无法读取原删除范围，请检查作品目录或存储权限后重试'
                  : '无法读取原删除范围，请核对存储和原删除记录后重试'
      context.logger.warn('[ArtworkBatchDelete] Item failed before report', { artworkId: item.artworkId, code })
    }
    await save()
    context.logger.info('[ArtworkBatchDelete] Item', {
      artworkId: item.artworkId,
      outcome: state.status,
      elapsedMs: Math.round(performance.now() - started),
      phasesMs: phases
    })
  }
  checkExecution()
  const failed = result.items.filter((item) => item.status === 'FAILED').length
  const completed = result.items.filter((item) => item.status === 'DELETED' || item.status === 'TRASH_SUBMITTED').length
  await context.progress({
    progress: stopped ? Math.floor((completed / context.payload.items.length) * 100) : 100,
    stage: stopped ? 'STOPPED' : 'COMPLETED',
    message: stopped ? `已停止后续删除，已处理 ${completed} 部` : `处理完成：${completed} 部成功，${failed} 部失败`
  })
  return stopped
    ? { kind: 'cancelled' as const, message: '已停止后续删除；已完成的删除和回收不会撤销' }
    : { kind: 'completed' as const, result, message: `处理完成：${completed} 部成功，${failed} 部失败` }
}
