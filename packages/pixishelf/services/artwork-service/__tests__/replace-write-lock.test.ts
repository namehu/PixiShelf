import { mkdtemp, mkdir, readdir, rm, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { withReplaceWriteLock } from '../replace-write-lock'

describe('replace media write lock', () => {
  const directories: string[] = []
  afterEach(async () => {
    for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true })
  })

  it('serializes three concurrent uploads in one directory', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-write-lock-'))
    directories.push(directory)
    let active = 0
    let peak = 0
    const results = await Promise.all([1, 2, 3].map((value) => withReplaceWriteLock(directory, async () => {
      active++
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 30))
      active--
      return value
    }, { waitMs: 1_000 })))
    expect(results).toEqual([1, 2, 3])
    expect(peak).toBe(1)
    await expect(readdir(directory)).resolves.toEqual([])
  })

  it('releases a lock after an action throws', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-write-lock-'))
    directories.push(directory)
    await expect(withReplaceWriteLock(directory, async () => { throw new Error('write failed') })).rejects.toThrow('write failed')
    await expect(withReplaceWriteLock(directory, async () => 'recovered')).resolves.toBe('recovered')
  })

  it('stops a cancelled waiter before it can mutate files', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-write-lock-'))
    directories.push(directory)
    let release!: () => void
    const held = withReplaceWriteLock(directory, () => new Promise<void>((resolve) => { release = resolve }))
    while (!release) await new Promise((resolve) => setTimeout(resolve, 1))
    let cancelled = false
    let entered = false
    const waiting = withReplaceWriteLock(directory, async () => { entered = true }, {
      waitMs: 1_000, isCancelled: () => cancelled
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    cancelled = true
    await expect(waiting).rejects.toMatchObject({ code: 'REPLACE_WRITE_LOCK_BUSY' })
    expect(entered).toBe(false)
    release()
    await held
  })

  it('keeps a pre-existing lock for manual recovery after bounded waiting', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-write-lock-'))
    directories.push(directory)
    await mkdir(path.join(directory, '.replace-write-lock'))
    await expect(withReplaceWriteLock(directory, async () => 'unsafe', { waitMs: 20 })).rejects.toMatchObject({
      code: 'REPLACE_WRITE_LOCK_BUSY'
    })
    await expect(readdir(path.join(directory, '.replace-write-lock'))).resolves.toEqual([])
  })

  it('never follows a lock directory symlink or junction', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-write-lock-'))
    const outside = await mkdtemp(path.join(os.tmpdir(), 'pixishelf-write-lock-outside-'))
    directories.push(directory, outside)
    await symlink(outside, path.join(directory, '.replace-write-lock'), process.platform === 'win32' ? 'junction' : 'dir')
    await expect(withReplaceWriteLock(directory, async () => 'unsafe', { waitMs: 20 })).rejects.toMatchObject({
      code: 'REPLACE_WRITE_LOCK_BUSY'
    })
    await expect(readdir(outside)).resolves.toEqual([])
  })
})
