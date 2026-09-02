import path from 'node:path'
import type { PrismaClient } from '@pixishelf/db'
import {
  createArchiveExecutorRegistrations,
  createArchiveMaintenanceExecutorRegistrations,
  createArchiveResolverExecutorRegistrations,
  createArchiveUploaderScanExecutorRegistrations,
  createDefaultArchiveMediaProviderRegistry,
  createMaintenanceExecutorRegistrations,
  createMigrationExecutorRegistrations,
  createNodeMigrationFileSystem,
  createNodePendingReplaceFileSystem,
  createPendingReplaceExecutorRegistrations,
  createPixivArtworkExecutorRegistrations,
  createPixivArtistExecutorRegistrations,
  createPixivSeriesExecutorRegistrations,
  createPixivTagExecutorRegistrations,
  createPrismaMigrationDatabase,
  createPrismaPendingReplaceDatabase,
  createScanExecutorRegistrations,
  createVideoMediaExecutorRegistrations,
  createVideoProcessingExecutorRegistrations,
  createVideoKeyframeExecutorRegistrations,
  GovernedArchiveProviderRegistry,
  PostgresArchiveProviderGovernor
} from '@pixishelf/job-executors'
import type { WorkerConfig } from './config.js'
import { ExecutorRegistry } from './executor-registry.js'
import { assertProductionWorkerCapabilities } from './production-capabilities.js'

type ExecutorWorkerConfig = Pick<
  WorkerConfig,
  | 'archiveRoot'
  | 'sourceMediaRoot'
  | 'derivedMediaRoot'
  | 'pixivDataRoot'
  | 'archiveMaxMediaBytes'
  | 'scanDiscoveryMaxEntries'
  | 'scanDiscoveryExcludedRootDirectories'
  | 'ffmpegPath'
  | 'ffprobePath'
  | 'keyframeFfmpegThreads'
>

export function createWorkerExecutorRegistry(input: { database: PrismaClient; config: ExecutorWorkerConfig }) {
  const registry = new ExecutorRegistry()
  const resolved = resolveExecutorWorkerConfiguration(input.config)
  const archiveProviders = new GovernedArchiveProviderRegistry(
    createDefaultArchiveMediaProviderRegistry(),
    new PostgresArchiveProviderGovernor(input.database)
  )
  for (const definition of createArchiveResolverExecutorRegistrations({
    database: input.database,
    providers: archiveProviders
  })) {
    registry.register(definition)
  }
  for (const definition of createArchiveUploaderScanExecutorRegistrations({
    database: input.database,
    providers: archiveProviders
  })) {
    registry.register(definition)
  }
  for (const definition of createArchiveExecutorRegistrations({
    database: input.database,
    providers: archiveProviders,
    config: {
      scanRoot: resolved.archiveRoot,
      maxMediaBytes: resolved.archiveMaxMediaBytes
    }
  })) {
    registry.register(definition)
  }
  for (const definition of createArchiveMaintenanceExecutorRegistrations({
    database: input.database,
    config: { scanRoot: resolved.archiveRoot }
  })) {
    registry.register(definition)
  }
  for (const definition of createMaintenanceExecutorRegistrations({
    database: input.database,
    scanRoot: resolved.sourceMediaRoot
  })) {
    registry.register(definition)
  }
  for (const definition of createScanExecutorRegistrations({
    database: input.database,
    config: {
      scanRoot: resolved.sourceMediaRoot,
      discoveryExcludedRootDirectories: resolved.scanDiscoveryExcludedRootDirectories,
      limits: { maxDiscoveryEntries: resolved.scanDiscoveryMaxEntries }
    }
  })) {
    registry.register(definition)
  }
  for (const definition of createMigrationExecutorRegistrations({
    database: createPrismaMigrationDatabase(input.database),
    fileSystem: createNodeMigrationFileSystem(),
    config: { scanRoot: resolved.sourceMediaRoot }
  })) {
    registry.register(definition)
  }
  for (const definition of createPendingReplaceExecutorRegistrations({
    database: createPrismaPendingReplaceDatabase(input.database),
    fileSystem: createNodePendingReplaceFileSystem(),
    config: { scanRoot: resolved.sourceMediaRoot }
  })) {
    registry.register(definition)
  }
  for (const definition of createPixivTagExecutorRegistrations({
    // 注册在统一后台写入注册表中，确保能力审计和线上执行器清单一致。
    database: input.database,
    pixivDataRoot: resolved.pixivDataRoot
  })) {
    registry.register(definition)
  }
  for (const definition of createPixivArtworkExecutorRegistrations({
    database: input.database,
    pixivDataRoot: resolved.pixivDataRoot
  })) {
    registry.register(definition)
  }
  for (const definition of createPixivSeriesExecutorRegistrations({
    database: input.database,
    pixivDataRoot: resolved.pixivDataRoot
  })) {
    registry.register(definition)
  }
  for (const definition of createPixivArtistExecutorRegistrations({
    database: input.database,
    pixivDataRoot: resolved.pixivDataRoot
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
  assertProductionWorkerCapabilities(registry.capabilities())
  return registry
}

export function resolveExecutorWorkerConfiguration(config: ExecutorWorkerConfig) {
  return {
    sourceMediaRoot: config.sourceMediaRoot,
    archiveRoot: config.archiveRoot,
    archiveMaxMediaBytes: config.archiveMaxMediaBytes,
    scanDiscoveryMaxEntries: config.scanDiscoveryMaxEntries,
    scanDiscoveryExcludedRootDirectories: config.scanDiscoveryExcludedRootDirectories,
    posterStorageRoot: path.join(config.derivedMediaRoot, 'video', 'posters'),
    chapterPreviewRoot: path.join(config.derivedMediaRoot, 'video', 'chapters'),
    keyframeStorageRoot: path.join(config.derivedMediaRoot, 'video', 'keyframes'),
    pixivDataRoot: config.pixivDataRoot,
    ffmpegPath: config.ffmpegPath,
    ffprobePath: config.ffprobePath,
    ffmpegThreads: config.keyframeFfmpegThreads
  }
}
