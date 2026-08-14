import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { JOB_DEFINITION_VERSION } from '@pixishelf/job-contracts'
import type { PrismaClient } from '@pixishelf/db'
import { createWorkerExecutorRegistry, resolveExecutorWorkerConfiguration } from '../create-worker-executor-registry.js'
import { ExecutorRegistry } from '../executor-registry.js'

describe('ExecutorRegistry', () => {
  it('publishes only registered job type and definition version capabilities', () => {
    const registry = new ExecutorRegistry()
      .register({
        jobType: 'VIDEO_MEDIA_PROBE',
        definitionVersion: JOB_DEFINITION_VERSION,
        execute: vi.fn(async () => ({ kind: 'completed' as const }))
      })
      .register({
        jobType: 'SCAN',
        definitionVersion: 2,
        parsePayload: (payload) => payload,
        execute: vi.fn(async () => ({ kind: 'completed' as const }))
      })
      .register({
        jobType: 'SCAN',
        definitionVersion: 3,
        parsePayload: (payload) => payload,
        execute: vi.fn(async () => ({ kind: 'completed' as const }))
      })

    expect(registry.capabilities()).toEqual([
      { jobType: 'SCAN', definitionVersions: [2, 3] },
      { jobType: 'VIDEO_MEDIA_PROBE', definitionVersions: [1] }
    ])
  })

  it('resolves an exact registration and parses its payload', () => {
    const execute = vi.fn(async () => ({ kind: 'completed' as const }))
    const registry = new ExecutorRegistry().register({
      jobType: 'SCAN',
      definitionVersion: JOB_DEFINITION_VERSION,
      execute
    })

    expect(
      registry.resolve({
        type: 'SCAN',
        definitionVersion: JOB_DEFINITION_VERSION,
        payload: { mode: 'INCREMENTAL' }
      })
    ).toMatchObject({
      jobType: 'SCAN',
      definitionVersion: JOB_DEFINITION_VERSION,
      payload: { mode: 'INCREMENTAL' },
      execute
    })
    expect(registry.resolve({ type: 'SCAN', definitionVersion: 2, payload: {} })).toBeNull()
    expect(registry.resolve({ type: 'NOT_A_JOB', definitionVersion: 1, payload: {} })).toBeNull()
    expect(() =>
      registry.resolve({
        type: 'SCAN',
        definitionVersion: JOB_DEFINITION_VERSION,
        payload: { mode: 'INCREMENTAL', unexpected: true }
      })
    ).toThrow()
  })

  it('rejects duplicate registrations and future versions without an explicit payload parser', () => {
    const registry = new ExecutorRegistry().register({
      jobType: 'SCAN',
      definitionVersion: JOB_DEFINITION_VERSION,
      execute: async () => ({ kind: 'completed' })
    })

    expect(() =>
      registry.register({
        jobType: 'SCAN',
        definitionVersion: JOB_DEFINITION_VERSION,
        execute: async () => ({ kind: 'completed' })
      })
    ).toThrow('already registered')
    expect(() =>
      new ExecutorRegistry().register({
        jobType: 'SCAN',
        definitionVersion: 2,
        execute: async () => ({ kind: 'completed' })
      })
    ).toThrow('requires an explicit payload parser')
  })

  it('registers every production executor capability migrated through phase four', () => {
    const registry = createWorkerExecutorRegistry({
      database: {} as PrismaClient,
      config: {
        archiveRoot: '/media/archive',
        sourceMediaRoot: '/media/source',
        derivedMediaRoot: '/media/derived',
        archiveMaxMediaBytes: 512 * 1024 * 1024,
        ffmpegPath: 'ffmpeg',
        ffprobePath: 'ffprobe',
        keyframeFfmpegThreads: 2
      }
    })

    expect(registry.capabilities()).toEqual([
      { jobType: 'ARCHIVE_IMPORT', definitionVersions: [JOB_DEFINITION_VERSION] },
      { jobType: 'DERIVED_MEDIA_GC', definitionVersions: [JOB_DEFINITION_VERSION] },
      { jobType: 'MEDIA_DERIVED_TAG_SYNC', definitionVersions: [JOB_DEFINITION_VERSION] },
      { jobType: 'REFILL_META_SOURCE', definitionVersions: [JOB_DEFINITION_VERSION] },
      { jobType: 'SCAN_RUN_RETENTION_CLEANUP', definitionVersions: [JOB_DEFINITION_VERSION] },
      { jobType: 'TRIGGER_LOG_RETENTION_CLEANUP', definitionVersions: [JOB_DEFINITION_VERSION] },
      { jobType: 'VIDEO_CHAPTER_PREVIEW_GENERATION', definitionVersions: [JOB_DEFINITION_VERSION] },
      { jobType: 'VIDEO_KEYFRAME_DISCOVERY', definitionVersions: [JOB_DEFINITION_VERSION] },
      { jobType: 'VIDEO_KEYFRAME_GENERATION', definitionVersions: [JOB_DEFINITION_VERSION] },
      { jobType: 'VIDEO_MEDIA_PROBE', definitionVersions: [JOB_DEFINITION_VERSION] },
      { jobType: 'VIDEO_POSTER_GENERATION', definitionVersions: [JOB_DEFINITION_VERSION] },
      { jobType: 'VIDEO_STREAMING_OPTIMIZATION', definitionVersions: [JOB_DEFINITION_VERSION] },
      { jobType: 'WEBP_ANIMATION_SCAN', definitionVersions: [JOB_DEFINITION_VERSION] }
    ])
  })

  it('maps Worker roots and process configuration into executor domains', () => {
    expect(
      resolveExecutorWorkerConfiguration({
        archiveRoot: '/media/archive',
        sourceMediaRoot: '/media/source',
        derivedMediaRoot: '/media/derived',
        archiveMaxMediaBytes: 512 * 1024 * 1024,
        ffmpegPath: '/usr/bin/ffmpeg',
        ffprobePath: '/usr/bin/ffprobe',
        keyframeFfmpegThreads: 3
      })
    ).toEqual({
      sourceMediaRoot: '/media/source',
      archiveRoot: '/media/archive',
      archiveMaxMediaBytes: 512 * 1024 * 1024,
      posterStorageRoot: path.join('/media/derived', 'video', 'posters'),
      chapterPreviewRoot: path.join('/media/derived', 'video', 'chapters'),
      keyframeStorageRoot: path.join('/media/derived', 'video', 'keyframes'),
      ffmpegPath: '/usr/bin/ffmpeg',
      ffprobePath: '/usr/bin/ffprobe',
      ffmpegThreads: 3
    })
  })
})
