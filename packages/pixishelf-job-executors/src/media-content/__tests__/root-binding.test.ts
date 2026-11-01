vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>())
}))
import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Prisma } from '@pixishelf/db'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { hashScanRootIdentity } from '../../scan/inventory.ts'
import { rootBindings, sameRootBindings } from '../../artwork-dedup/root-bindings.ts'
import {
  assertMediaContentRootUnchanged,
  readMediaContentRootBinding,
  resolveMediaContentRoots,
  resolveMediaContentPath
} from '../roots.ts'

const directories: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(directories.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function fixture(existing = true) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'media-root-binding-')))
  directories.push(root)
  const uuid = randomUUID()
  await fs.writeFile(path.join(root, '.pixishelf-root'), JSON.stringify({ version: 1, id: uuid }))
  const config = { sourceRoot: root, archiveRoot: root, expectedPixivRootIdentity: uuid }
  const legacy = (await resolveMediaContentRoots(config)).source
  const database = {
    pixivMetadataInventoryState: {
      findUnique: vi.fn().mockResolvedValue({ rootIdentity: uuid, rootPathHash: hashScanRootIdentity(root) })
    },
    mediaContentDirectoryState: {
      findUnique: vi.fn().mockResolvedValue(existing ? { rootIdentity: legacy.rootIdentity } : null)
    }
  }
  const binding = await readMediaContentRootBinding(database as unknown as Prisma.TransactionClient)
  return { root, uuid, legacy, database, config: { ...config, ...binding } }
}

function remount(root: string) {
  const lstat = fs.lstat
  vi.spyOn(fs, 'lstat').mockImplementation(async (file, options) => {
    const state = await lstat(file, options as never)
    return file === root
      ? Object.assign(Object.create(Object.getPrototypeOf(state)), state, {
          dev: typeof state.dev === 'bigint' ? state.dev + 1n : state.dev + 1
        })
      : state
  })
}

describe('bound media root across NAS remounts', () => {
  it.each([true, false])('keeps the library namespace with existing directories=%s', async (existing) => {
    const f = await fixture(existing)
    const before = await resolveMediaContentRoots(f.config)
    if (existing) expect(before.source.rootIdentity).toBe(f.legacy.rootIdentity)
    remount(f.root)
    const after = await resolveMediaContentRoots(f.config)
    expect(after.source.deviceId).not.toBe(before.source.deviceId)
    expect(after.source.rootIdentity).toBe(before.source.rootIdentity)
    expect(after.archive).toEqual(after.source)
    expect(sameRootBindings(rootBindings(before), rootBindings(after))).toBe(false)
    if (existing) {
      const legacyBindings = {
        version: 1,
        source: { logicalRoot: before.source.logicalRoot, rootIdentity: before.source.rootIdentity },
        archive: { logicalRoot: before.archive.logicalRoot, rootIdentity: before.archive.rootIdentity },
        archiveRelativePrefix: ''
      }
      expect(sameRootBindings(legacyBindings, rootBindings(before))).toBe(true)
      expect(sameRootBindings(legacyBindings, rootBindings(after))).toBe(false)
    }
    await expect(assertMediaContentRootUnchanged(after.source)).resolves.toBeUndefined()
    await expect(assertMediaContentRootUnchanged(before.source)).rejects.toMatchObject({ code: 'ROOT_CHANGED' })
    await expect(resolveMediaContentPath(before.source, 'future/file', { allowMissing: true })).rejects.toMatchObject({
      code: 'ROOT_CHANGED'
    })
  })

  it('still rejects another library, a missing marker, or a changed configured path', async () => {
    const f = await fixture()
    await expect(
      resolveMediaContentRoots({
        ...f.config,
        sourceRootBinding: { identity: f.legacy.rootIdentity, pathHash: 'different' }
      })
    ).rejects.toMatchObject({ code: 'ROOT_CHANGED' })
    await fs.writeFile(path.join(f.root, '.pixishelf-root'), JSON.stringify({ version: 1, id: randomUUID() }))
    await expect(resolveMediaContentRoots(f.config)).rejects.toMatchObject({ code: 'ROOT_CHANGED' })
    await fs.unlink(path.join(f.root, '.pixishelf-root'))
    await expect(resolveMediaContentRoots(f.config)).rejects.toMatchObject({ code: 'ROOT_CHANGED' })
  })

  it('does not adopt a persisted namespace without a bound inventory UUID', async () => {
    const f = await fixture()
    f.database.pixivMetadataInventoryState.findUnique.mockResolvedValue(null)
    f.database.mediaContentDirectoryState.findUnique.mockClear()
    expect(await readMediaContentRootBinding(f.database as unknown as Prisma.TransactionClient)).toEqual({
      expectedPixivRootIdentity: null
    })
    expect(f.database.mediaContentDirectoryState.findUnique).not.toHaveBeenCalled()
    const config = { sourceRoot: f.root, archiveRoot: f.root, expectedPixivRootIdentity: null }
    const before = await resolveMediaContentRoots(config)
    remount(f.root)
    expect((await resolveMediaContentRoots(config)).source.rootIdentity).not.toBe(before.source.rootIdentity)
  })
})
