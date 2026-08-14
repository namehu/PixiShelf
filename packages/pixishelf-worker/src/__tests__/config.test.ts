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
      healthPort: 3011,
      heartbeatIntervalMs: 30_000
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
