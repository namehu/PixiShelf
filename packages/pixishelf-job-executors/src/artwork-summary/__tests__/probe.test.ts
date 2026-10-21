import { EventEmitter } from 'node:events'
import type { spawn } from 'node:child_process'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { IsolatedSummaryProbe } from '../probe.ts'

describe('isolated image summary probe', () => {
  it('compares a real image, reuses unchanged evidence and rejects symlink/traversal', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'summary-probe-'))
    const probe = new IsolatedSummaryProbe()
    try {
      await sharp({ create: { width: 64, height: 80, channels: 3, background: '#224466' } }).png().toFile(path.join(root, 'a.png'))
      const signal = new AbortController().signal
      // Valid two-frame APNG with a .png extension; libvips metadata.pages is absent.
      await writeFile(path.join(root, 'animated.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAAIAAAACAAAAAAAAAAAAAEACgAA8k66YgAAABFJREFUeJxj4NKIwooYhpYEAJmLIwFk09IbAAAAGmZjVEwAAAABAAAACAAAAAgAAAAAAAAAAAABAAoAAGk9ULYAAAAVZmRBVAAAAAJ4nGO4syoAK2IYWhIADHp1gdvYwW4AAAAASUVORK5CYII=', 'base64'))
      expect((await probe.analyze(root, 'animated.png', null, signal)).failureCode).toBe('NON_STATIC')
      const first = await probe.analyze(root, 'a.png', null, signal)
      expect(first.feature?.colors).toHaveLength(192)
      expect(first.feature?.aspect).toBe(0.8)
      expect(await probe.analyze(root, 'a.png', first, signal)).toEqual(first)
      await symlink(path.join(root, 'a.png'), path.join(root, 'link.png'))
      expect((await probe.analyze(root, 'link.png', null, signal)).failureCode).toBe('UNSAFE_PATH')
      expect((await probe.analyze(root, '../a.png', null, signal)).failureCode).toBe('UNSAFE_PATH')
      await writeFile(path.join(root, 'a.png'), 'broken image')
      expect((await probe.analyze(root, 'a.png', first, signal)).feature).toBeNull()
    } finally { probe.close(); await rm(root, { recursive: true, force: true }) }
  })
  it('never replaces an unkillable child after its deadline', async () => {
    class Stuck extends EventEmitter {
      send(_value: unknown, callback: () => void) { callback() }
      kill = vi.fn(() => {
        // A response already in transit must not turn a timed-out request into success.
        queueMicrotask(() => this.emit('message', { feature: null, sourceKey: null }))
        return true
      })
    }
    const child = new Stuck()
    const spawnProcess = vi.fn(() => child) as unknown as typeof spawn
    const probe = new IsolatedSummaryProbe({ timeoutMs: 10, spawnProcess })
    await expect(probe.analyze('root', 'a', null, new AbortController().signal)).rejects.toThrow('SUMMARY_CHILD_UNAVAILABLE')
    await expect(probe.analyze('root', 'b', null, new AbortController().signal)).rejects.toThrow('SUMMARY_CHILD_UNAVAILABLE')
    expect(spawnProcess).toHaveBeenCalledTimes(1)
    child.emit('exit')
  })
})
