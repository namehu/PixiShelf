import { EventEmitter } from 'node:events'
import path from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { IsolatedDurationProbe } from '../animation-duration-child.ts'

describe('isolated WebP duration process', () => {
  it('parses a real animated WebP through the child IPC boundary', async () => {
    const fixture = path.resolve(process.cwd(), '../pixishelf-webp-player/tests/fixtures/short.webp')
    const probe = new IsolatedDurationProbe({ timeoutMs: 5_000 })
    try {
      const result = await probe.probe(path.dirname(fixture), path.basename(fixture), new AbortController().signal)
      expect(result.probe.status).toBe('READY')
      expect(result.probe.durationMs).toBeGreaterThan(0)
      expect(result.preState).toEqual(result.postState)
      expect(result.probe.readBytes).toBeLessThan(4_096)
    } finally {
      await probe.close()
    }
  })

  it('preserves timeout reason and never spawns over a child that ignores termination', async () => {
    class StuckChild extends EventEmitter {
      exitCode = null
      signalCode = null
      send(_message: unknown, callback: (error?: Error) => void) { callback() }
      kill = vi.fn(() => true)
    }
    const child = new StuckChild()
    const spawnProcess = vi.fn(() => child as unknown as ChildProcess)
    const probe = new IsolatedDurationProbe({ timeoutMs: 10, spawnProcess })
    await expect(probe.probe('root', 'item.webp', new AbortController().signal)).rejects.toMatchObject({
      code: 'PROBE_TIMEOUT'
    })
    await expect(probe.probe('root', 'item.webp', new AbortController().signal)).rejects.toMatchObject({
      code: 'PROBE_CHILD_UNAVAILABLE'
    })
    expect(spawnProcess).toHaveBeenCalledTimes(1)
    expect(child.kill).toHaveBeenCalled()
    await probe.close()
  })

  it('kills an active child on cancellation', async () => {
    class StuckChild extends EventEmitter {
      exitCode = null
      signalCode = null
      send(_message: unknown, callback: (error?: Error) => void) { callback() }
      kill = vi.fn(() => {
        queueMicrotask(() => this.emit('close', null, 'SIGKILL'))
        return true
      })
    }
    const child = new StuckChild()
    const probe = new IsolatedDurationProbe({ spawnProcess: () => child as unknown as ChildProcess })
    const controller = new AbortController()
    const pending = probe.probe('root', 'item.webp', controller.signal)
    controller.abort(new Error('cancelled'))
    await expect(pending).rejects.toThrow('cancelled')
    expect(child.kill).toHaveBeenCalled()
    await probe.close()
  })
})
