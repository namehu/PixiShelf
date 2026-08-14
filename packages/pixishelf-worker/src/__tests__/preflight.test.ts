import { describe, expect, it, vi } from 'vitest'
import type { WorkerConfig } from '../config.js'
import { runStartupPreflight } from '../preflight.js'

const config: WorkerConfig = {
  databaseUrl: 'postgresql://worker:secret@postgres:5432/pixishelf',
  sourceMediaRoot: '/media/source',
  derivedMediaRoot: '/media/derived',
  archiveRoot: '/media/archive',
  ffmpegPath: '/usr/bin/ffmpeg',
  ffprobePath: '/usr/bin/ffprobe',
  serviceVersion: '1.0.0',
  healthHost: '0.0.0.0',
  healthPort: 3011,
  heartbeatIntervalMs: 30_000,
  preflightTimeoutMs: 8_000
}

describe('startup preflight', () => {
  it('checks schema, mount permissions, and both executables through injected dependencies', async () => {
    const checkDatabaseSchema = vi.fn().mockResolvedValue(undefined)
    const checkPath = vi.fn().mockResolvedValue(undefined)
    const checkExecutable = vi.fn().mockResolvedValue(undefined)

    await runStartupPreflight(config, { checkDatabaseSchema, checkPath, checkExecutable })

    expect(checkDatabaseSchema).toHaveBeenCalledOnce()
    expect(checkPath.mock.calls).toEqual(
      expect.arrayContaining([
        ['/media/source', 'read'],
        ['/media/derived', 'read-write'],
        ['/media/archive', 'read-write']
      ])
    )
    expect(checkExecutable.mock.calls).toEqual(
      expect.arrayContaining([
        ['/usr/bin/ffmpeg', 8_000, undefined],
        ['/usr/bin/ffprobe', 8_000, undefined]
      ])
    )
  })

  it('does not touch paths or binaries when the schema check fails', async () => {
    const checkPath = vi.fn()
    const checkExecutable = vi.fn()
    await expect(
      runStartupPreflight(config, {
        checkDatabaseSchema: vi.fn().mockRejectedValue(new Error('schema mismatch')),
        checkPath,
        checkExecutable
      })
    ).rejects.toThrow('schema mismatch')
    expect(checkPath).not.toHaveBeenCalled()
    expect(checkExecutable).not.toHaveBeenCalled()
  })

  it('stops waiting for an in-flight check when the Worker begins draining', async () => {
    const controller = new AbortController()
    const checkPath = vi.fn()
    const checkExecutable = vi.fn()
    const preflight = runStartupPreflight(
      config,
      {
        checkDatabaseSchema: () => new Promise<void>(() => undefined),
        checkPath,
        checkExecutable
      },
      controller.signal
    )

    controller.abort(new Error('Worker is draining'))
    await expect(preflight).rejects.toThrow('Worker is draining')
    expect(checkPath).not.toHaveBeenCalled()
    expect(checkExecutable).not.toHaveBeenCalled()
  })
})
