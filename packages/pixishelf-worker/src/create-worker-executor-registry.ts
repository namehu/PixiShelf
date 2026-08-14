import path from 'node:path'
import type { PrismaClient } from '@pixishelf/db'
import {
  createArchiveExecutorRegistrations,
  createDefaultArchiveMediaProviderRegistry,
  createVideoKeyframeExecutorRegistrations
} from '@pixishelf/job-executors'
import type { WorkerConfig } from './config.js'
import { ExecutorRegistry } from './executor-registry.js'

type ExecutorWorkerConfig = Pick<
  WorkerConfig,
  | 'archiveRoot'
  | 'sourceMediaRoot'
  | 'derivedMediaRoot'
  | 'archiveMaxMediaBytes'
  | 'ffmpegPath'
  | 'ffprobePath'
  | 'keyframeFfmpegThreads'
>

export function createWorkerExecutorRegistry(input: { database: PrismaClient; config: ExecutorWorkerConfig }) {
  const registry = new ExecutorRegistry()
  for (const definition of createArchiveExecutorRegistrations({
    database: input.database,
    providers: createDefaultArchiveMediaProviderRegistry(),
    config: {
      scanRoot: input.config.archiveRoot,
      maxMediaBytes: input.config.archiveMaxMediaBytes
    }
  })) {
    registry.register(definition)
  }
  for (const definition of createVideoKeyframeExecutorRegistrations({
    database: input.database,
    config: {
      scanRoot: input.config.sourceMediaRoot,
      keyframeStorageRoot: path.join(input.config.derivedMediaRoot, 'video', 'keyframes'),
      ffmpegPath: input.config.ffmpegPath,
      ffprobePath: input.config.ffprobePath,
      ffmpegThreads: input.config.keyframeFfmpegThreads
    }
  })) {
    registry.register(definition)
  }
  return registry
}
