import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { JOB_DEFINITION_VERSION } from '@pixishelf/job-contracts'
import type { PrismaClient } from '@pixishelf/db'
import { createWorkerExecutorRegistry, resolveExecutorWorkerConfiguration } from '../create-worker-executor-registry.js'
import { ExecutorRegistry } from '../executor-registry.js'
import { assertProductionWorkerCapabilities, PRODUCTION_WORKER_CAPABILITIES } from '../production-capabilities.js'

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
      { jobType: 'SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [2, 3] },
      { jobType: 'VIDEO_MEDIA_PROBE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
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

  it('rejects an executor registered in a lane that does not match its job type', () => {
    expect(() =>
      new ExecutorRegistry().register({
        jobType: 'ARCHIVE_RESOLVE_ITEM',
        executionLane: 'BACKGROUND_WRITER',
        definitionVersion: JOB_DEFINITION_VERSION,
        execute: async () => ({ kind: 'completed' })
      })
    ).toThrow('must register in ARCHIVE_RESOLVE')
  })

  it('locks the production Worker to all 20 dual-lane executor capabilities', () => {
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

    const capabilities = registry.capabilities()
    expect(capabilities).toHaveLength(20)
    expect(capabilities).toEqual(PRODUCTION_WORKER_CAPABILITIES)
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

  it('fails the production runtime assertion when a Registry capability drifts', () => {
    expect(() => assertProductionWorkerCapabilities(PRODUCTION_WORKER_CAPABILITIES.slice(0, 16))).toThrow(
      'Production Worker capability inventory drifted'
    )
  })
})
