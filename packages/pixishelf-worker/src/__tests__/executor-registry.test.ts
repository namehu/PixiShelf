import { describe, expect, it, vi } from 'vitest'
import { JOB_DEFINITION_VERSION } from '@pixishelf/job-contracts'
import type { PrismaClient } from '@pixishelf/db'
import { createWorkerExecutorRegistry } from '../create-worker-executor-registry.js'
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

    expect(registry.resolve({ type: 'SCAN', definitionVersion: JOB_DEFINITION_VERSION, payload: {} })).toMatchObject({
      jobType: 'SCAN',
      definitionVersion: JOB_DEFINITION_VERSION,
      payload: {},
      execute
    })
    expect(registry.resolve({ type: 'SCAN', definitionVersion: 2, payload: {} })).toBeNull()
    expect(registry.resolve({ type: 'NOT_A_JOB', definitionVersion: 1, payload: {} })).toBeNull()
    expect(() =>
      registry.resolve({ type: 'SCAN', definitionVersion: JOB_DEFINITION_VERSION, payload: { unexpected: true } })
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

  it('registers the three initial production executor capabilities', () => {
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
      { jobType: 'VIDEO_KEYFRAME_DISCOVERY', definitionVersions: [JOB_DEFINITION_VERSION] },
      { jobType: 'VIDEO_KEYFRAME_GENERATION', definitionVersions: [JOB_DEFINITION_VERSION] }
    ])
  })
})
