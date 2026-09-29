import type { ArtistMergePayload } from '@pixishelf/job-contracts'
import type { EnqueuedChildJob, ExecutionContext, QueueSqlExecutor } from '@pixishelf/job-runtime'
import { applyArtistMerge, type Prisma } from '@pixishelf/db'

export async function executeArtistMerge(context: ExecutionContext<ArtistMergePayload, EnqueuedChildJob>) {
  return context.finalizeInTransaction<Prisma.TransactionClient & QueueSqlExecutor>(async (scope) => {
    if (scope.executionStatus === 'CANCELLING') {
      await scope.cancel('合并已取消，艺术家未改变')
      return
    }
    if (scope.executionStatus === 'PAUSING') {
      await scope.pause({ reason: 'USER_REQUESTED', message: '合并已暂停，艺术家未改变' })
      return
    }
    if (context.signal.aborted) {
      await scope.release('等待 Worker 恢复')
      return
    }
    const summary = await applyArtistMerge(scope.transaction, context.payload.mergeId, context.job.id)
    await scope.complete({
      result: { mergeId: context.payload.mergeId, summary },
      message: '艺术家合并完成，作品和归档绑定已迁移'
    })
  })
}
