import path from 'node:path'
import type { PrismaClient } from '@pixishelf/db'
import {
  createArchiveExecutorRegistrations,
  createDefaultArchiveMediaProviderRegistry,
  createMaintenanceExecutorRegistrations,
  createVideoMediaExecutorRegistrations,
  createVideoProcessingExecutorRegistrations,
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
  const resolved = resolveExecutorWorkerConfiguration(input.config)
  for (const definition of createArchiveExecutorRegistrations({
    database: input.database,
    providers: createDefaultArchiveMediaProviderRegistry(),
    config: {
      scanRoot: resolved.archiveRoot,
      maxMediaBytes: resolved.archiveMaxMediaBytes
    }
  })) {
    registry.register(definition)
  }
  for (const definition of createMaintenanceExecutorRegistrations({
    database: input.database,
    scanRoot: resolved.sourceMediaRoot
  })) {
    registry.register(definition)
  }
  for (const definition of createVideoMediaExecutorRegistrations({
    database: input.database,
    config: {
      scanRoot: resolved.sourceMediaRoot,
      posterStorageRoot: resolved.posterStorageRoot,
      chapterPreviewStorageRoot: resolved.chapterPreviewRoot,
      ffmpegPath: resolved.ffmpegPath,
      ffprobePath: resolved.ffprobePath
    }
  })) {
    registry.register(definition)
  }
  for (const definition of createVideoKeyframeExecutorRegistrations({
    database: input.database,
    config: {
      scanRoot: resolved.sourceMediaRoot,
      keyframeStorageRoot: resolved.keyframeStorageRoot,
      ffmpegPath: resolved.ffmpegPath,
      ffprobePath: resolved.ffprobePath,
      ffmpegThreads: resolved.ffmpegThreads
    }
  })) {
    registry.register(definition)
  }
  for (const definition of createVideoProcessingExecutorRegistrations({
    database: input.database,
    config: {
      scanRoot: resolved.sourceMediaRoot,
      chapterPreviewRoot: resolved.chapterPreviewRoot,
      ffmpegPath: resolved.ffmpegPath,
      ffprobePath: resolved.ffprobePath,
      ffmpegThreads: resolved.ffmpegThreads
    }
  })) {
    registry.register(definition)
  }
  return registry
}

export function resolveExecutorWorkerConfiguration(config: ExecutorWorkerConfig) {
  return {
    sourceMediaRoot: config.sourceMediaRoot,
    archiveRoot: config.archiveRoot,
    archiveMaxMediaBytes: config.archiveMaxMediaBytes,
    posterStorageRoot: path.join(config.derivedMediaRoot, 'video', 'posters'),
    chapterPreviewRoot: path.join(config.derivedMediaRoot, 'video', 'chapters'),
    keyframeStorageRoot: path.join(config.derivedMediaRoot, 'video', 'keyframes'),
    ffmpegPath: config.ffmpegPath,
    ffprobePath: config.ffprobePath,
    ffmpegThreads: config.keyframeFfmpegThreads
  }
}
