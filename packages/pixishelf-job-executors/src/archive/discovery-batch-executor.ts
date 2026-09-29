import { Prisma } from '@pixishelf/db'
import {
  DISCOVERY_BATCH_JOB_TYPE,
  discoveryBatchPayloadSchema,
  parseDiscoveryBatchCheckpoint,
  TERMINAL_JOB_STATUSES,
  type DiscoveryBatchPayload
} from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext, ExecutorDefinition, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { DiscoveryScanConflict, enqueueDiscoveryScan, lockDiscoverySource } from './discovery-scan-enqueue.ts'

export function createDiscoveryBatchExecutorRegistration(): ExecutorDefinition<DiscoveryBatchPayload> {
  return {
    jobType: DISCOVERY_BATCH_JOB_TYPE,
    executionLane: 'ARCHIVE_RESOLVE',
    definitionVersion: 1,
    progressPolicy: 'STANDARD',
    parsePayload: (value) => discoveryBatchPayloadSchema.parse(value),
    execute: (context) => executeDiscoveryBatch(context)
  }
}

export async function executeDiscoveryBatch(
  context: ExecutionContext<DiscoveryBatchPayload, EnqueuedChildJob>,
  dependencies: { now?: () => Date } = {}
) {
  return context.finalizeInTransaction<Prisma.TransactionClient & QueueSqlExecutor>(async (scope) => {
    const tx = scope.transaction
    const job = await tx.systemJob.findUniqueOrThrow({ where: { id: context.job.id } })
    const state = parseDiscoveryBatchCheckpoint(job.result)
    if (scope.executionStatus === 'CANCELLING') state.control = 'CANCEL'
    if (scope.executionStatus === 'PAUSING' && state.control !== 'CANCEL') state.control = 'PAUSE'
    const save = () =>
      tx.systemJob.update({
        where: { id: job.id },
        data: {
          result: state,
          progress: Math.floor((state.index / context.payload.sources.length) * 100),
          stage: state.phase
        }
      })
    const yieldLane = async () => {
      await save()
      await scope.retry({
        availableAt: new Date((dependencies.now?.() ?? new Date()).getTime() + 1000),
        preserveAttempt: true,
        schedulingYield: true,
        errorCode: 'RESOURCE_BUSY',
        error: 'Discovery batch yielded at a durable round boundary',
        message: `已处理 ${state.index}/${context.payload.sources.length} 个来源`
      })
    }
    if (state.control === 'PAUSE') {
      await save()
      await scope.pause({ reason: 'USER_REQUESTED', message: '批次已暂停' })
      return
    }
    if (context.signal.aborted && state.control !== 'CANCEL') {
      await scope.release('批次等待 Worker 恢复')
      return
    }
    const child = state.childJobId ? await tx.systemJob.findUnique({ where: { id: state.childJobId } }) : null
    if (state.control === 'CANCEL') {
      if (child && !TERMINAL_JOB_STATUSES.has(child.status)) {
        await yieldLane()
        return
      }
      for (const source of context.payload.sources.slice(state.index)) {
        state.results.push({ sourceId: source.id, status: 'CANCELLED', message: '批次已取消，已发现结果保留' })
      }
      state.index = context.payload.sources.length
      state.childJobId = null
      await save()
      await scope.cancel('批次已取消，已发现结果保留')
      return
    }
    const sourceInput = context.payload.sources[state.index]
    if (!sourceInput) {
      await scope.complete({ result: state, message: '批量扫描完成' })
      return
    }
    const finishSource = async (status: 'COMPLETED' | 'FAILED' | 'SKIPPED', message: string) => {
      state.results.push({ sourceId: sourceInput.id, status, message })
      state.index++
      state.phase = 'LATEST'
      state.round = 0
      state.childJobId = null
      if (state.index === context.payload.sources.length)
        await scope.complete({ result: state, message: '批量扫描完成，请查看逐来源结果' })
      else await yieldLane()
    }
    if (sourceInput.skipReason && !state.childJobId) {
      await finishSource('SKIPPED', sourceInput.skipReason)
      return
    }
    if (child && !TERMINAL_JOB_STATUSES.has(child.status)) {
      await yieldLane()
      return
    }
    if (state.childJobId && (!child || child.status !== 'COMPLETED')) {
      await finishSource('FAILED', child?.error ?? '当前扫描未成功完成，请重新扫描此来源')
      return
    }
    await lockDiscoverySource(tx, sourceInput.id)
    const source = await tx.archiveUploaderSource.findUnique({ where: { id: sourceInput.id } })
    if (!source || source.status !== 'ACTIVE') {
      await finishSource('SKIPPED', source ? '来源已停用' : '来源已删除')
      return
    }
    const active = await tx.archiveUploaderScanRun.findFirst({
      where: { sourceId: source.id, status: { in: ['PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSED'] } }
    })
    if (active) {
      await finishSource('SKIPPED', '该来源已有其他活动扫描')
      return
    }
    if (child) {
      const result = child.result as { uidDiscovery?: { outcome?: string } } | null
      if (result?.uidDiscovery?.outcome === 'BOUND') state.phase = 'LATEST'
      else if (state.phase === 'LATEST' && source.incrementalCursor) state.phase = 'LATEST'
      else if (source.historyCursor) state.phase = 'HISTORY'
      else {
        await finishSource('COMPLETED', '最新增量与未完成历史均已扫描')
        return
      }
    }
    try {
      const run = await enqueueDiscoveryScan(tx, {
        sourceId: source.id,
        sourceKind: 'ALL',
        mode: state.phase,
        now: dependencies.now?.() ?? new Date(),
        requestedByUserId: job.requestedByUserId,
        parentJobId: job.id,
        idempotencyKey: `discovery-batch:${job.id}:${state.index}:${state.round}`
      })
      state.childJobId = run.systemJobId
      state.round++
    } catch (error) {
      if (!(error instanceof DiscoveryScanConflict)) throw error
      await finishSource('SKIPPED', error.message)
      return
    }
    await yieldLane()
  })
}
