import { disconnectDatabase } from '../../pixishelf/lib/prisma'
import logger from '../../pixishelf/lib/logger'
import { runArchiveWorkerLoop } from '../../pixishelf/services/archive/archive-worker'

const controller = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => controller.abort())
}

runArchiveWorkerLoop({ signal: controller.signal })
  .catch((error) => {
    logger.error('Archive worker stopped unexpectedly', { error })
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectDatabase()
  })
