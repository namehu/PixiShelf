import { spawn, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { ControlledDedupReader, DedupReaderSupervisor } from '../reader.ts'
import { probeMaintenanceFilesystem } from '../maintenance-files.ts'

const workerRequire = createRequire(new URL('../../../../pixishelf-worker/package.json', import.meta.url))
const execArgv = ['--import', workerRequire.resolve('tsx')]
const signal = new AbortController().signal
let directory: string | undefined
let reader: ControlledDedupReader | undefined
const children: ChildProcess[] = []
afterEach(async () => {
  await reader?.close()
  reader = undefined
  await Promise.all(
    children.splice(0).map(async (child) => {
      if (child.exitCode !== null || child.signalCode !== null) return
      const closed = new Promise<void>((resolve) => child.once('close', () => resolve()))
      child.kill('SIGKILL')
      await closed
    })
  )
  if (directory) await fs.rm(directory, { recursive: true, force: true })
  directory = undefined
})
async function fixture() {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-maintenance-')))
  reader = new DedupReaderSupervisor({
    entrypoint: new URL('../reader-child.ts', import.meta.url).pathname,
    execArgv,
    stallMs: 5000,
    closeMs: 1000
  }).create()
  await reader.start()
  const { source } = await reader.resolveRoots(
    { operation: 'roots', sourceRoot: directory, archiveRoot: directory, expectedPixivRootIdentity: null },
    signal
  )
  return { root: source, signal }
}
function renameChild(message: { root: string; from: string; to: string; waitBeforeMove?: boolean }) {
  const child = spawn(
    process.execPath,
    [...execArgv, new URL('./maintenance-rename-fixture.ts', import.meta.url).pathname],
    {
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      serialization: 'advanced'
    }
  )
  children.push(child)
  let stderr = ''
  child.stderr?.on('data', (value) => {
    stderr += value.toString()
  })
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
    child.once('close', (code, signal) => resolve({ code, signal }))
  )
  const result = new Promise<{ type: string; code?: string; pid?: number }>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`fixture timeout: ${stderr}`)), 5000)
    child.once('message', (value) => {
      clearTimeout(timer)
      resolve(value as never)
    })
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', () => {
      clearTimeout(timer)
      reject(new Error(`fixture closed: ${stderr}`))
    })
  })
  child.send(message)
  return { child, result, closed }
}

describe('controlled maintenance file foundation', () => {
  it('inspects exact paths, reports hard links and final symlinks, and rejects unsafe parents', async () => {
    const input = await fixture()
    await fs.writeFile(path.join(directory!, 'original'), 'keep')
    await fs.writeFile(path.join(directory!, 'empty'), '')
    await fs.link(path.join(directory!, 'original'), path.join(directory!, 'hardlink'))
    await fs.symlink('original', path.join(directory!, 'symlink'))
    await fs.symlink(os.tmpdir(), path.join(directory!, 'escape'))
    expect(await reader!.inspectMaintenance({ ...input, relativePath: 'original' })).toMatchObject({
      kind: 'FILE',
      state: { size: 4n, linkCount: 2n }
    })
    expect(await reader!.inspectMaintenance({ ...input, relativePath: 'empty' })).toMatchObject({
      kind: 'FILE',
      state: { size: 0n }
    })
    expect(await reader!.inspectMaintenance({ ...input, relativePath: 'symlink' })).toMatchObject({ kind: 'SYMLINK' })
    expect(await reader!.inspectMaintenance({ ...input, relativePath: 'missing/file' })).toMatchObject({
      kind: 'MISSING',
      state: null
    })
    await expect(reader!.inspectMaintenance({ ...input, relativePath: 'escape/outside' })).rejects.toMatchObject({
      code: 'UNSAFE_PATH'
    })
    await expect(reader!.inspectMaintenance({ ...input, relativePath: '../outside' })).rejects.toMatchObject({
      code: 'UNSAFE_PATH'
    })
  })
  it('pages a stable directory at 100 entries and rejects a changed directory cursor', async () => {
    const input = await fixture()
    await fs.mkdir(path.join(directory!, 'owned'))
    const names = Array.from({ length: 201 }, (_, index) => String(index).padStart(4, '0'))
    await Promise.all(names.map((name) => fs.writeFile(path.join(directory!, 'owned', name), name)))
    const first = await reader!.inspectDirectory({
      ...input,
      relativePath: 'owned',
      afterName: null,
      expectedState: null
    })
    expect(first.entries.map((entry) => entry.name)).toEqual(names.slice(0, 100))
    const second = await reader!.inspectDirectory({
      ...input,
      relativePath: 'owned',
      afterName: first.nextName,
      expectedState: first.state
    })
    expect(second.entries.map((entry) => entry.name)).toEqual(names.slice(100, 200))
    const last = await reader!.inspectDirectory({
      ...input,
      relativePath: 'owned',
      afterName: second.nextName,
      expectedState: second.state
    })
    expect(last.entries.map((entry) => entry.name)).toEqual(names.slice(200))
    expect(last.nextName).toBeNull()
    await fs.writeFile(path.join(directory!, 'owned/new'), 'new')
    await expect(
      reader!.inspectDirectory({
        ...input,
        relativePath: 'owned',
        afterName: first.nextName,
        expectedState: first.state
      })
    ).rejects.toMatchObject({ code: 'FILE_CHANGED' })
  })
  it('refuses an over-budget directory instead of returning an apparently complete partial list', async () => {
    const input = await fixture()
    await fs.mkdir(path.join(directory!, 'oversized'))
    for (let start = 0; start < 10001; start += 100) {
      await Promise.all(
        Array.from({ length: Math.min(100, 10001 - start) }, (_, i) =>
          fs.writeFile(path.join(directory!, 'oversized', String(start + i)), '')
        )
      )
    }
    await expect(
      reader!.inspectDirectory({ ...input, relativePath: 'oversized', afterName: null, expectedState: null })
    ).rejects.toMatchObject({ code: 'DIRECTORY_BUDGET_EXCEEDED' })
  }, 20000)
  it('probes real no-replace and synchronization support in the fixed reader without touching originals', async () => {
    const input = await fixture()
    await fs.writeFile(path.join(directory!, 'original'), 'original')
    expect(await reader!.probeFilesystem({ ...input, operationId: 'operation-test' })).toMatchObject({
      platform: process.platform,
      exclusiveRename: true,
      directorySync: true,
      fileSync: true,
      rootIdentity: input.root.rootIdentity
    })
    expect(await fs.readFile(path.join(directory!, 'original'), 'utf8')).toBe('original')
    expect(await fs.readdir(path.join(directory!, '.trash/artwork-dedup/operation-test'))).toEqual([])
  })
  it('refuses native file actions outside a controlled child before creating a probe', async () => {
    const input = await fixture()
    // Vitest may itself have IPC; disable just the capability indicator for this direct call.
    const original = process.send
    delete process.send
    try {
      await expect(probeMaintenanceFilesystem({ ...input, operationId: 'forbidden' })).rejects.toMatchObject({
        code: 'FILESYSTEM_CAPABILITY_UNAVAILABLE'
      })
    } finally {
      if (original) process.send = original
      else delete process.send
    }
    await expect(fs.stat(path.join(directory!, '.trash'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it.each(['file', 'symlink'] as const)(
    'never replaces an occupied %s destination in the native syscall',
    async (kind) => {
      await fixture()
      await fs.writeFile(path.join(directory!, 'from'), 'source')
      await fs.writeFile(path.join(directory!, 'other'), 'other')
      if (kind === 'file') await fs.writeFile(path.join(directory!, 'to'), 'destination')
      else await fs.symlink('other', path.join(directory!, 'to'))
      const { result, closed } = renameChild({ root: directory!, from: 'from', to: 'to' })
      expect(await result).toMatchObject({ type: 'error', code: 'FILE_CONFLICT' })
      expect((await closed).code).toBe(0)
      expect(await fs.readFile(path.join(directory!, 'from'), 'utf8')).toBe('source')
      expect(await fs.readFile(path.join(directory!, 'to'), 'utf8')).toBe(kind === 'file' ? 'destination' : 'other')
      expect((await fs.lstat(path.join(directory!, 'to'))).isSymbolicLink()).toBe(kind === 'symlink')
    }
  )
  it('moves to an absent destination with the same inode', async () => {
    await fixture()
    await fs.writeFile(path.join(directory!, 'from'), 'source')
    const before = await fs.stat(path.join(directory!, 'from'), { bigint: true })
    const { result, closed } = renameChild({ root: directory!, from: 'from', to: 'to' })
    expect(await result).toEqual({ type: 'result' })
    expect((await closed).code).toBe(0)
    await expect(fs.stat(path.join(directory!, 'from'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await fs.stat(path.join(directory!, 'to'), { bigint: true })).ino).toBe(before.ino)
  })
  it('has no surviving executor after the process hosting the native action is killed', async () => {
    await fixture()
    await fs.writeFile(path.join(directory!, 'from'), 'source')
    const { child, result, closed } = renameChild({ root: directory!, from: 'from', to: 'to', waitBeforeMove: true })
    expect(await result).toMatchObject({ type: 'ready', pid: child.pid })
    child.kill('SIGKILL')
    expect((await closed).signal).toBe('SIGKILL')
    expect(() => process.kill(child.pid!, 0)).toThrow()
    await new Promise((resolve) => setTimeout(resolve, 1100))
    expect(await fs.readFile(path.join(directory!, 'from'), 'utf8')).toBe('source')
    await expect(fs.stat(path.join(directory!, 'to'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
