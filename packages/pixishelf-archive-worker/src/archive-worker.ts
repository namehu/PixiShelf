import { disconnectDatabase } from '../../pixishelf/lib/prisma'
import logger from '../../pixishelf/lib/logger'
import { runArchiveWorkerLoop } from '../../pixishelf/services/archive/archive-worker'
import { runVideoKeyframeWorkerLoop } from '../../pixishelf/services/video-keyframe-worker'

const controller = new AbortController()
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => controller.abort())
}

runWorkerHost()
  .catch((error) => {
    logger.error('Worker host stopped unexpectedly', { error })
    process.exitCode = 1
  })
  .finally(async () => {
    await disconnectDatabase()
  })

async function runWorkerHost() {
  const loops = [
    runArchiveWorkerLoop({ signal: controller.signal }),
    runVideoKeyframeWorkerLoop({ signal: controller.signal })
  ]
  try {
    await Promise.all(loops)
  } catch (error) {
    controller.abort()
    await Promise.allSettled(loops)
    throw error
  }
}
