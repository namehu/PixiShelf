import { EventEmitter } from 'node:events'
import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ARTWORK_DEDUP_DEFAULTS } from '@pixishelf/job-contracts'
import { ARTWORK_DEDUP_LIMITS } from '../limits.ts'
import { ControlledDedupReader, DedupReaderSupervisor } from '../reader.ts'
import { ownerProvesExit, proveReaderExited, type DedupReaderOwner } from '../reader-owner.ts'

const workerRequire = createRequire(new URL('../../../../pixishelf-worker/package.json', import.meta.url))
const options = {
  entrypoint: new URL('../reader-child.ts', import.meta.url).pathname,
  execArgv: ['--import', workerRequire.resolve('tsx')],
  stallMs: 2000,
  closeMs: 300
}
const signal = new AbortController().signal
const owner: DedupReaderOwner = {
  version: 1,
  machineId: '1'.repeat(64),
  bootId: '2'.repeat(64),
  pidNamespace: 'pid:1',
  parentPid: 1,
  childPid: 2
}
const root = {
  logicalRoot: 'source-media:v1' as const,
  rootIdentity: 'a'.repeat(64),
  absolutePath: '/fixture',
  deviceId: 1n,
  inode: 2n
}
let directory: string | undefined
let reader: ControlledDedupReader | undefined
afterEach(async () => {
  await reader?.close().catch(() => undefined)
  reader = undefined
  if (directory) await fs.rm(directory, { recursive: true, force: true })
  directory = undefined
  vi.useRealTimers()
})

describe('bounded isolated detection reader', () => {
  it('locks resource limits to the shared contract', () => {
    expect(ARTWORK_DEDUP_LIMITS).toMatchObject({
      mediaPage: ARTWORK_DEDUP_DEFAULTS.mediaPageSize,
      statConcurrency: ARTWORK_DEDUP_DEFAULTS.statConcurrency,
      hashConcurrency: ARTWORK_DEDUP_DEFAULTS.hashConcurrency,
      cacheBatch: ARTWORK_DEDUP_DEFAULTS.cacheBatchSize,
      sliceMs: ARTWORK_DEDUP_DEFAULTS.yieldAfterMs,
      sliceBytes: BigInt(ARTWORK_DEDUP_DEFAULTS.yieldAfterBytes),
      cooldownMs: ARTWORK_DEDUP_DEFAULTS.cooldownMs
    })
  })
  it('validates roots, stats, and hashes only in the real fixed child and reports actual bytes', async () => {
    directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-reader-')))
    await fs.writeFile(path.join(directory, 'original.bin'), Buffer.alloc(150_000, 31))
    reader = new DedupReaderSupervisor(options).create()
    const identity = await reader.start()
    expect(identity.childPid).not.toBe(process.pid)
    const roots = await reader.resolveRoots(
      { operation: 'roots', sourceRoot: directory, archiveRoot: directory, expectedPixivRootIdentity: null },
      signal
    )
    const input = { root: roots.source, relativePath: 'original.bin', signal }
    expect((await reader.inspect(input)).state.size).toBe(150_000n)
    const result = await reader.read(input)
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(result.bytesRead).toBe(150_000n)
    expect(reader.metrics).toMatchObject({ inspections: 1, reads: 1, bytesRead: 150_000n })
    expect(await proveReaderExited(options, identity)).toBe(false)
    await reader.close()
    expect(await proveReaderExited(options, identity)).toBe(true)
  }, 15_000)
  it('reports a disappeared root as a run failure and missing or zero files as local failures', async () => {
    directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-reader-')))
    await fs.writeFile(path.join(directory, 'zero'), '')
    reader = new DedupReaderSupervisor(options).create()
    await reader.start()
    const roots = await reader.resolveRoots(
      { operation: 'roots', sourceRoot: directory, archiveRoot: directory, expectedPixivRootIdentity: null },
      signal
    )
    await expect(reader.inspect({ root: roots.source, relativePath: 'zero', signal })).rejects.toMatchObject({
      code: 'INVALID_FILE'
    })
    await expect(reader.inspect({ root: roots.source, relativePath: 'missing', signal })).rejects.toMatchObject({
      code: 'NOT_READABLE'
    })
    await fs.rm(directory, { recursive: true })
    await expect(reader.inspect({ root: roots.source, relativePath: 'missing', signal })).rejects.toMatchObject({
      code: 'ROOT_CHANGED'
    })
  })
  it.each(['inspect', 'read'] as const)(
    'kills stalled %s, waits for close, and never replaces an unclosed child',
    async (operation) => {
      vi.useFakeTimers()
      const child = fakeChild()
      const spawn = vi.fn(() => child as unknown as ChildProcess)
      const supervisor = new DedupReaderSupervisor({ ...options, spawnProcess: spawn, stallMs: 30, closeMs: 20 })
      reader = supervisor.create()
      const pending = reader[operation]({ root, relativePath: 'hung', signal })
      const rejected = expect(pending).rejects.toMatchObject({ code: 'READER_CLOSE_FAILED' })
      await vi.advanceTimersByTimeAsync(31)
      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
      expect(() => supervisor.create()).toThrow('READER_BUSY')
      await vi.advanceTimersByTimeAsync(21)
      await rejected
      expect(() => supervisor.create()).toThrow('READER_CLOSE_FAILED')
      child.emit('close', null, 'SIGKILL')
      expect(() => supervisor.create()).toThrow('READER_CLOSE_FAILED')
      expect(spawn).toHaveBeenCalledTimes(1)
    }
  )
  it.each(['inspect', 'read'] as const)(
    'terminates a real unresponsive %s child while the parent stays responsive',
    async (operation) => {
      const supervisor = new DedupReaderSupervisor({
        entrypoint: new URL('./stalled-reader-fixture.cjs', import.meta.url).pathname,
        stallMs: 100,
        closeMs: 500
      })
      reader = supervisor.create()
      await reader.start()
      let ticks = 0
      const responsive = setInterval(() => {
        ticks++
      }, 5)
      try {
        await expect(reader[operation]({ root, relativePath: 'blocked', signal })).rejects.toMatchObject({
          code: 'READER_STALLED'
        })
        expect(ticks).toBeGreaterThan(0)
        const replacement = supervisor.create()
        await replacement.close()
      } finally {
        clearInterval(responsive)
      }
    }
  )
  it('aborts startup identity work and reports an unclosed child instead of hanging start forever', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    reader = new DedupReaderSupervisor({
      ...options,
      spawnProcess: () => child as unknown as ChildProcess,
      closeMs: 20
    }).create()
    const controller = new AbortController()
    const pending = reader.start(controller.signal)
    const rejected = expect(pending).rejects.toMatchObject({ code: 'READER_CLOSE_FAILED' })
    controller.abort(new Error('Pause during root preparation'))
    expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    await vi.advanceTimersByTimeAsync(21)
    await rejected
    child.emit('close', null, 'SIGKILL')
  })
  it('ignores late results after cancellation and permits replacement only after close', async () => {
    const child = fakeChild()
    const supervisor = new DedupReaderSupervisor({ ...options, spawnProcess: () => child as unknown as ChildProcess })
    reader = supervisor.create()
    const abort = new AbortController()
    const pending = reader.read({ root, relativePath: 'read', signal: abort.signal })
    const rejected = expect(pending).rejects.toThrow('cancelled')
    abort.abort(new Error('cancelled'))
    child.emit('message', { type: 'result', id: 1, value: { bytesRead: 50n }, rss: 10 })
    expect(reader.metrics.bytesRead).toBe(0n)
    expect(() => supervisor.create()).toThrow('READER_BUSY')
    child.emit('close', null, 'SIGKILL')
    await rejected
    const replacement = supervisor.create()
    await replacement.close()
  })
  it('resets stall only on actual increasing bytes, and bounds stat/hash requests', async () => {
    vi.useFakeTimers()
    const child = fakeChild()
    reader = new DedupReaderSupervisor({
      ...options,
      spawnProcess: () => child as unknown as ChildProcess,
      stallMs: 30
    }).create()
    const pending = reader.read({ root, relativePath: 'large', signal })
    const rejected = expect(pending).rejects.toThrow()
    await expect(reader.read({ root, relativePath: 'second', signal })).rejects.toMatchObject({ code: 'READER_BUSY' })
    await vi.advanceTimersByTimeAsync(20)
    child.emit('message', { type: 'progress', id: 1, bytesRead: 10n, rss: 10 })
    await vi.advanceTimersByTimeAsync(20)
    expect(child.kill).not.toHaveBeenCalled()
    child.emit('message', { type: 'progress', id: 1, bytesRead: 10n, rss: 10 })
    await vi.advanceTimersByTimeAsync(25)
    expect(child.kill).toHaveBeenCalledTimes(1)
    child.emit('close', null, 'SIGKILL')
    await rejected
    expect(reader.metrics.bytesRead).toBe(10n)
  })
  it('proves exit after the parent Worker is truly SIGKILLed, without relying on its finally handler', async () => {
    const worker = spawn(
      process.execPath,
      [...options.execArgv, new URL('./crash-worker-fixture.ts', import.meta.url).pathname],
      { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], serialization: 'advanced' }
    )
    const identity = await new Promise<DedupReaderOwner>((resolve, reject) => {
      worker.once('error', reject)
      worker.once('message', (value: unknown) => resolve((value as { owner: DedupReaderOwner }).owner))
      worker.once('exit', () => reject(new Error('Fixture exited before ready')))
    })
    const closed = new Promise<void>((resolve) => worker.once('close', () => resolve()))
    worker.kill('SIGKILL')
    await closed
    // The reader's disconnect handler executes independently of the killed Worker.
    await expect(proveReaderExited(options, identity)).resolves.toBe(true)
  }, 10_000)
  it('rejects different hosts/namespaces and live or reused PIDs as exit proof', () => {
    expect(ownerProvesExit(owner, owner, false)).toBe(false)
    expect(ownerProvesExit(owner, owner, true)).toBe(true)
    expect(ownerProvesExit(owner, { ...owner, machineId: '3'.repeat(64) }, true)).toBe(false)
    expect(ownerProvesExit(owner, { ...owner, pidNamespace: 'pid:other' }, true)).toBe(false)
    expect(ownerProvesExit(owner, { ...owner, bootId: '4'.repeat(64) }, false)).toBe(true)
  })
})
function fakeChild() {
  const child = new EventEmitter() as EventEmitter & { send: ReturnType<typeof vi.fn>; kill: ReturnType<typeof vi.fn> }
  child.send = vi.fn((_message: unknown, callback?: (error: Error | null) => void) => {
    callback?.(null)
    return true
  })
  child.kill = vi.fn(() => true)
  return child
}
