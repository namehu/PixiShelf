import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DedupReaderSupervisor, type ControlledDedupReader } from '../reader.ts'
import { directDeleteNativeFixture } from './direct-delete-native-fixture.ts'
const require = createRequire(new URL('../../../../pixishelf-worker/package.json', import.meta.url))
let directory: string | undefined, reader: ControlledDedupReader | undefined
let nativeFixture: Awaited<ReturnType<typeof directDeleteNativeFixture>> | undefined
const signal = new AbortController().signal
async function fixture() {
  directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-direct-delete-native-')))
  await fs.mkdir(path.join(directory, 'parent'))
  await fs.writeFile(path.join(directory, 'parent', 'exact'), 'frozen')
  await fs.writeFile(path.join(directory, 'neighbor'), 'keep')
  reader = new DedupReaderSupervisor({
    entrypoint: new URL('../reader-child.ts', import.meta.url).pathname,
    execArgv: ['--import', require.resolve('tsx')]
  }).create()
  await reader.start()
  const { source: root } = await reader.resolveRoots(
    { operation: 'roots', sourceRoot: directory, archiveRoot: directory, expectedPixivRootIdentity: null },
    signal
  )
  const inspected = await reader.inspectMaintenance({ root, relativePath: 'parent/exact', signal })
  return { root, relativePath: 'parent/exact', expectedState: inspected.state!, allowMissing: false, signal }
}
afterEach(async () => {
  await nativeFixture?.close()
  nativeFixture = undefined
  await reader?.close()
  reader = undefined
  if (directory) await fs.rm(directory, { recursive: true, force: true })
  directory = undefined
})
describe('DIRECT_DELETE fd anchored native dependency', () => {
  it('unlinks only the exact file, syncs and keeps parent and neighbor', async () => {
    const input = await fixture()
    expect(await reader!.deleteFile(input)).toEqual({ location: 'ABSENT', directoriesSynced: true })
    expect((await fs.stat(path.join(directory!, 'parent'))).isDirectory()).toBe(true)
    expect(await fs.readFile(path.join(directory!, 'neighbor'), 'utf8')).toBe('keep')
    await expect(reader!.deleteFile(input)).rejects.toBeDefined()
    expect(await reader!.deleteFile({ ...input, allowMissing: true })).toEqual({
      location: 'ABSENT',
      directoriesSynced: true
    })
  })
  it('preserves a new occupant and refuses hard links', async () => {
    const input = await fixture()
    await fs.unlink(path.join(directory!, 'parent/exact'))
    await fs.writeFile(path.join(directory!, 'parent/exact'), 'new occupant')
    await expect(reader!.deleteFile({ ...input, allowMissing: true })).rejects.toMatchObject({ code: 'FILE_CHANGED' })
    expect(await fs.readFile(path.join(directory!, 'parent/exact'), 'utf8')).toBe('new occupant')
    const observed = await reader!.inspectMaintenance(input)
    await fs.link(path.join(directory!, 'parent/exact'), path.join(directory!, 'second-link'))
    await expect(reader!.deleteFile({ ...input, expectedState: observed.state! })).rejects.toMatchObject({
      code: 'FILE_CHANGED'
    })
  })
  it('refuses an ancestor symlink without touching its target', async () => {
    const input = await fixture()
    await fs.mkdir(path.join(directory!, 'other'))
    await fs.writeFile(path.join(directory!, 'other/exact'), 'outside frozen parent')
    await fs.symlink('other', path.join(directory!, 'alias'))
    await expect(reader!.deleteFile({ ...input, relativePath: 'alias/exact' })).rejects.toMatchObject({
      code: 'UNSAFE_PATH'
    })
    expect(await fs.readFile(path.join(directory!, 'other/exact'), 'utf8')).toBe('outside frozen parent')
  })
  it('rejects changed root marker before unlink', async () => {
    const input = await fixture()
    await fs.writeFile(path.join(directory!, '.pixishelf-root'), JSON.stringify({ version: 1, id: randomUUID() }))
    await expect(reader!.deleteFile(input)).rejects.toMatchObject({ code: 'ROOT_CHANGED' })
    expect(await fs.readFile(path.join(directory!, 'parent/exact'), 'utf8')).toBe('frozen')
  })
  it('propagates EIO after real unlink and syncs again before acknowledging an original-intent missing replay', async () => {
    const input = await fixture()
    await reader!.close()
    reader = undefined
    nativeFixture = await directDeleteNativeFixture(path.join(directory!, 'native-sync'), 'sync-failure')
    expect(await nativeFixture.deleteFile(input)).toEqual({ code: 'EIO' })
    await nativeFixture.waitForEvents('SF')
    await expect(fs.lstat(path.join(directory!, input.relativePath))).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await fs.stat(path.join(directory!, 'parent'))).isDirectory()).toBe(true)
    await nativeFixture.close()
    nativeFixture = await directDeleteNativeFixture(path.join(directory!, 'native-missing'), 'sync-failure')
    // A restarted reader must also reject an absent original-intent file if its directory sync fails.
    expect(await nativeFixture.deleteFile({ ...input, allowMissing: true })).toEqual({ code: 'EIO' })
    await nativeFixture.waitForEvents('SF')
    // The same frozen identity can acknowledge absence only with original-intent evidence at the caller.
    // Both required native syncs must succeed on this replay; ENOENT alone is not a durable receipt.
    expect(await nativeFixture.deleteFile({ ...input, allowMissing: true })).toEqual({
      receipt: { location: 'ABSENT', directoriesSynced: true }
    })
    await nativeFixture.waitForEvents('SFSS')
    expect(await fs.readFile(path.join(directory!, 'neighbor'), 'utf8')).toBe('keep')
  }, 15000)
  it.each(['new-directory', 'outside-symlink'] as const)(
    'pins the verified parent across an action-boundary %s replacement', async (replacement) => {
      const input = await fixture()
      await reader!.close()
      reader = undefined
      // This sibling is outside the resolved media root, but remains in our disposable fixture.
      const outside = await fs.mkdtemp(path.join(path.dirname(directory!), 'dedup-dd07-outside-'))
      try {
        await fs.writeFile(path.join(outside, 'exact'), 'outside untouched')
        nativeFixture = await directDeleteNativeFixture(path.join(directory!, 'native-parent'), 'parent-barrier')
        const deletion = nativeFixture.deleteFile(input)
        // U is emitted inside the wrapped unlinkat, after production fstatat has checked the held fd.
        await nativeFixture.waitForEvents('SU')
        await fs.rename(path.join(directory!, 'parent'), path.join(directory!, 'frozen-parent'))
        if (replacement === 'outside-symlink') await fs.symlink(outside, path.join(directory!, 'parent'))
        else {
          await fs.mkdir(path.join(directory!, 'parent'))
          await fs.writeFile(path.join(directory!, 'parent/exact'), 'new occupant untouched')
        }
        nativeFixture.resume()
        expect(await deletion).toEqual({ receipt: { location: 'ABSENT', directoriesSynced: true } })
        await nativeFixture.waitForEvents('SUS')
        await expect(fs.lstat(path.join(directory!, 'frozen-parent/exact'))).rejects.toMatchObject({ code: 'ENOENT' })
        expect((await fs.stat(path.join(directory!, 'frozen-parent'))).isDirectory()).toBe(true)
        expect(await fs.readFile(path.join(outside, 'exact'), 'utf8')).toBe('outside untouched')
        expect(await fs.readFile(path.join(directory!, 'parent/exact'), 'utf8')).toBe(
          replacement === 'outside-symlink' ? 'outside untouched' : 'new occupant untouched'
        )
      } finally {
        await nativeFixture?.close()
        nativeFixture = undefined
        await fs.rm(outside, { recursive: true, force: true })
      }
    }, 15000
  )

})
