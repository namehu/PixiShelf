import type { ExecutionLogger } from '@pixishelf/job-runtime'

interface ScanProgressContext {
  progress(input: {
    progress: number
    stage: string
    message: string
    data: { processed: number; total: number }
  }): Promise<void>
  logger: ExecutionLogger
}

export async function reportScanPageProgress(input: {
  context: ScanProgressContext
  event: 'scan.progress.page' | 'local-import.progress.page'
  processed: number
  total: number
}) {
  const progress = input.total === 0 ? 100 : Math.min(95, Math.round((input.processed / input.total) * 95))
  await input.context.progress({
    progress,
    stage: 'PROCESSING',
    message: `Processed ${input.processed}/${input.total} frozen inputs`,
    data: { processed: input.processed, total: input.total }
  })
  input.context.logger.info(input.event, {
    stage: 'PROCESSING',
    processed: input.processed,
    total: input.total,
    progress
  })
}

export function logFrozenSnapshotPage(input: { logger: ExecutionLogger; frozen: number; pageItems: number }) {
  input.logger.info('scan.snapshot.page.frozen', {
    stage: 'DISCOVERY',
    frozen: input.frozen,
    pageItems: input.pageItems
  })
}
