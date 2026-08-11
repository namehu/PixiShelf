import { disconnectDatabase } from '../lib/prisma'
import logger from '../lib/logger'
import { runArchiveWorkerLoop } from '../services/archive/archive-worker'

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
