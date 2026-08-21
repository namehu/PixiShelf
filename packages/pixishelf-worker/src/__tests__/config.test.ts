import { describe, expect, it } from 'vitest'
import { createDefaultWorkerId, parseWorkerConfig } from '../config.js'
import { parseHealthcheckOptions } from '../healthcheck.js'

const requiredEnvironment = {
  DATABASE_URL: 'postgresql://worker:secret@postgres:5432/pixishelf',
  SOURCE_MEDIA_ROOT: '/media/source',
  DERIVED_MEDIA_ROOT: '/media/derived',
  ARCHIVE_ROOT: '/media/archive'
}

describe('worker config', () => {
  it('uses operational defaults and compatibility path aliases', () => {
    expect(parseWorkerConfig(requiredEnvironment)).toMatchObject({
      ffmpegPath: 'ffmpeg',
      ffprobePath: 'ffprobe',
      keyframeFfmpegThreads: 2,
      archiveMaxMediaBytes: 512 * 1024 * 1024,
      scanDiscoveryMaxEntries: 10_000_000,
      scanDiscoveryExcludedRootDirectories: ['local-imports', 'sources', '.archive-staging', '.trash'],
      healthPort: 3011,
      heartbeatIntervalMs: 30_000,
      dispatchEnabled: false,
      dispatchPollIntervalMs: 1_000,
      jobLeaseDurationMs: 60_000,
      jobHeartbeatIntervalMs: 20_000,
      queueTransactionMaxWaitMs: 5_000,
      queueTransactionTimeoutMs: 30_000,
      dispatchDrainGraceMs: 30_000
    })
    expect(
      parseWorkerConfig({
        DATABASE_URL: requiredEnvironment.DATABASE_URL,
        SCAN_PATH: '/media/source',
        DERIVED_MEDIA_STORAGE_PATH: '/media/derived',
        ARCHIVE_STORAGE_PATH: '/media/archive'
      })
    ).toMatchObject({
      sourceMediaRoot: '/media/source',
      derivedMediaRoot: '/media/derived',
      archiveRoot: '/media/archive'
    })
  })

  it('rejects invalid database and numeric configuration', () => {
    expect(() => parseWorkerConfig({ ...requiredEnvironment, DATABASE_URL: 'mysql://database/pixishelf' })).toThrow()
    expect(() => parseWorkerConfig({ ...requiredEnvironment, WORKER_HEARTBEAT_INTERVAL_MS: '20' })).toThrow()
    expect(() => parseWorkerConfig({ ...requiredEnvironment, WORKER_SERVICE_VERSION: 'x'.repeat(51) })).toThrow()
    expect(() => parseWorkerConfig({ ...requiredEnvironment, KEYFRAME_FFMPEG_THREADS: '9' })).toThrow()
    expect(() => parseWorkerConfig({ ...requiredEnvironment, ARCHIVE_MAX_MEDIA_BYTES: '0' })).toThrow()
    expect(() => parseWorkerConfig({ ...requiredEnvironment, SCAN_DISCOVERY_MAX_ENTRIES: '100000001' })).toThrow()
    expect(() =>
      parseWorkerConfig({ ...requiredEnvironment, SCAN_DISCOVERY_EXCLUDED_ROOT_DIRECTORIES: '../sources' })
    ).toThrow()
    expect(() =>
      parseWorkerConfig({
        ...requiredEnvironment,
        WORKER_JOB_LEASE_DURATION_MS: '20000',
        WORKER_JOB_HEARTBEAT_INTERVAL_MS: '10000',
        WORKER_QUEUE_TRANSACTION_TIMEOUT_MS: '10000'
      })
    ).toThrow('less than half')
    expect(() =>
      parseWorkerConfig({
        ...requiredEnvironment,
        WORKER_JOB_LEASE_DURATION_MS: '30000',
        WORKER_JOB_HEARTBEAT_INTERVAL_MS: '10000',
        WORKER_QUEUE_TRANSACTION_TIMEOUT_MS: '30000'
      })
    ).toThrow('less than the job lease')
    expect(() => parseWorkerConfig({ ...requiredEnvironment, WORKER_QUEUE_TRANSACTION_MAX_WAIT_MS: '99' })).toThrow()
    expect(() => parseWorkerConfig({ ...requiredEnvironment, WORKER_DISPATCH_ENABLED: 'yes' })).toThrow()
  })

  it('parses the dispatch opt-in explicitly', () => {
    expect(parseWorkerConfig({ ...requiredEnvironment, WORKER_DISPATCH_ENABLED: 'true' }).dispatchEnabled).toBe(true)
    expect(parseWorkerConfig({ ...requiredEnvironment, WORKER_DISPATCH_ENABLED: '0' }).dispatchEnabled).toBe(false)
  })

  it('allows the Pixiv discovery traversal limit to be tuned independently', () => {
    expect(
      parseWorkerConfig({
        ...requiredEnvironment,
        SCAN_DISCOVERY_MAX_ENTRIES: '25000000',
        SCAN_DISCOVERY_EXCLUDED_ROOT_DIRECTORIES: 'incoming, cache,incoming'
      })
    ).toMatchObject({
      scanDiscoveryMaxEntries: 25_000_000,
      scanDiscoveryExcludedRootDirectories: ['incoming', 'cache']
    })
    expect(
      parseWorkerConfig({ ...requiredEnvironment, SCAN_DISCOVERY_EXCLUDED_ROOT_DIRECTORIES: '' })
        .scanDiscoveryExcludedRootDirectories
    ).toEqual([])
  })

  it('defaults healthcheck mode to ready', () => {
    expect(parseHealthcheckOptions([], {})).toEqual({ mode: 'ready', host: '127.0.0.1', port: 3011, timeoutMs: 2_000 })
    expect(parseHealthcheckOptions(['--mode=live'], { WORKER_HEALTH_PORT: '4444' })).toMatchObject({
      mode: 'live',
      port: 4444
    })
    expect(() => parseHealthcheckOptions(['--mode=other'], {})).toThrow('Unsupported healthcheck mode')
  })

  it('bounds generated Worker IDs for long container hostnames', () => {
    const workerId = createDefaultWorkerId('host'.repeat(100), 123_456, '00000000-0000-4000-8000-000000000000')
    expect(workerId.length).toBeLessThanOrEqual(120)
    expect(workerId).toMatch(/:123456:00000000-0000-4000-8000-000000000000$/)
  })
})
