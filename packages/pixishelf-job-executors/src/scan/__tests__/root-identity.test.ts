import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Prisma } from '@pixishelf/db'
import { hashScanRootIdentity } from '../inventory.ts'
import { resolveSafeScanRoot, type SafeScanRoot } from '../paths.ts'
import {
  assertPixivRootUnchanged,
  bindPixivInventoryRoot,
  createPixivRootMarker,
  readPixivRootMarker
} from '../root-identity.ts'
import type { ScanTransaction } from '../types.ts'

vi.mock('node:fs/promises', async (importOriginal) => ({ ...(await importOriginal<typeof fs>()) }))

const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pixiv-root-identity-'))
  roots.push(directory)
  return resolveSafeScanRoot(directory)
}

type State = Prisma.PixivMetadataInventoryStateGetPayload<Record<string, never>>
function legacy(root: SafeScanRoot): State {
  return {
    id: 'pixiv',
    status: 'READY',
    rootPathHash: hashScanRootIdentity(root.absolutePath),
    rootIdentity: null,
    rootDeviceId: root.deviceId,
    rootInode: root.inode,
    baselineGeneration: 4,
    baselineStartedAt: new Date(0),
    baselineCompletedAt: new Date(1),
    createdAt: new Date(0),
    updatedAt: new Date(1)
  }
}
function database(initial: State | null) {
  let state = initial
  const delegate = {
    findUnique: vi.fn(async () => state),
    findUniqueOrThrow: vi.fn(async () => state!),
    create: vi.fn(async ({ data }: { data: Partial<State> }) => {
      state = { ...data, updatedAt: new Date() } as State
      return state
    }),
    updateMany: vi.fn(async ({ data }: { data: Partial<State> }) => {
      state = { ...state!, ...data }
      return { count: 1 }
    })
  }
  return { transaction: { pixivMetadataInventoryState: delegate } as unknown as ScanTransaction, delegate }
}

describe('persistent Pixiv root identity', () => {
  it('initializes a new root and reuses its marker after a database rollback', async () => {
    const root = await fixture()
    const db = database(null)
    db.delegate.create.mockRejectedValueOnce(new Error('commit failed'))
    await expect(bindPixivInventoryRoot(db.transaction, root, new Date())).rejects.toThrow('commit failed')
    const marker = await readPixivRootMarker(root)
    expect(marker).toBeTruthy()
    const result = await bindPixivInventoryRoot(db.transaction, root, new Date())
    expect(result.state.rootIdentity).toBe(marker)
    expect(result.state.status).toBe('INITIALIZING')
  })

  it('automatically upgrades an exact legacy match without resetting its baseline', async () => {
    const root = await fixture()
    const state = legacy(root)
    const db = database(state)
    const result = await bindPixivInventoryRoot(db.transaction, root, new Date())
    expect(result.state).toMatchObject({ ...state, rootIdentity: await readPixivRootMarker(root) })
    expect(result.remounted).toBe(false)
  })

  it.each(['device', 'inode', 'missing'] as const)('requires confirmation for legacy %s drift', async (kind) => {
    const root = await fixture()
    const state = legacy(root)
    if (kind === 'device') state.rootDeviceId = root.deviceId + 1n
    if (kind === 'inode') state.rootInode = root.inode + 1n
    if (kind === 'missing') state.rootDeviceId = state.rootInode = null
    const db = database(state)
    await expect(bindPixivInventoryRoot(db.transaction, root, new Date())).rejects.toThrow('needs confirmation')
    expect(await readPixivRootMarker(root)).toBeNull()
    expect(db.delegate.updateMany).not.toHaveBeenCalled()
    expect((await bindPixivInventoryRoot(db.transaction, root, new Date(), true)).state.rootIdentity).toBeTruthy()
  })

  it('accepts a bound UUID after both device and inode drift, retaining inventory state', async () => {
    const root = await fixture()
    const identity = await createPixivRootMarker(root)
    const state = {
      ...legacy(root),
      rootIdentity: identity,
      rootDeviceId: root.deviceId + 2n,
      rootInode: root.inode + 3n
    }
    const db = database(state)
    const result = await bindPixivInventoryRoot(db.transaction, root, new Date())
    expect(result).toMatchObject({
      remounted: true,
      state: { ...state, rootDeviceId: root.deviceId, rootInode: root.inode }
    })
    expect(db.delegate.updateMany.mock.calls[0]?.[0].data).toEqual({
      rootIdentity: identity,
      rootDeviceId: root.deviceId,
      rootInode: root.inode
    })
  })

  it('rejects missing and foreign UUIDs without changing the database or overwriting markers', async () => {
    const root = await fixture()
    const db = database({ ...legacy(root), rootIdentity: randomUUID() })
    await expect(bindPixivInventoryRoot(db.transaction, root, new Date())).rejects.toThrow('UUID is missing')
    expect(await readPixivRootMarker(root)).toBeNull()
    const foreign = await createPixivRootMarker(root)
    await expect(bindPixivInventoryRoot(db.transaction, root, new Date(), true)).rejects.toThrow('does not match')
    expect(await readPixivRootMarker(root)).toBe(foreign)
    expect(db.delegate.updateMany).not.toHaveBeenCalled()
  })

  it.each(['{', '{}', '{"version":2,"id":"wrong"}', 'x'.repeat(1025)])('rejects malformed markers', async (bytes) => {
    const root = await fixture()
    await fs.writeFile(path.join(root.absolutePath, '.pixishelf-root'), bytes)
    await expect(createPixivRootMarker(root)).rejects.toThrow()
    expect(await fs.readFile(path.join(root.absolutePath, '.pixishelf-root'), 'utf8')).toBe(bytes)
  })

  it('rejects a marker symlink (including a dangling link)', async () => {
    const root = await fixture()
    const target = path.join(root.absolutePath, 'missing-directory')
    await fs.symlink(target, path.join(root.absolutePath, '.pixishelf-root'), 'junction')
    await expect(readPixivRootMarker(root)).rejects.toThrow('regular file')
  })

  it('does not require write access to verify an existing marker', async () => {
    const root = await fixture()
    const identity = await createPixivRootMarker(root)
    const db = database({ ...legacy(root), rootIdentity: identity })
    const open = vi.spyOn(fs, 'open')
    await bindPixivInventoryRoot(db.transaction, root, new Date())
    expect(open.mock.calls.every((call) => call[1] !== 'wx')).toBe(true)
    expect(db.delegate.updateMany).not.toHaveBeenCalled()
  })

  it('reports create permission failure without binding the database', async () => {
    const root = await fixture()
    const db = database(null)
    vi.spyOn(fs, 'open').mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
    await expect(bindPixivInventoryRoot(db.transaction, root, new Date())).rejects.toThrow('write permission')
    expect(db.delegate.create).not.toHaveBeenCalled()
  })

  it('never overwrites the winner of concurrent exclusive creation', async () => {
    const root = await fixture()
    const outcomes = await Promise.allSettled([createPixivRootMarker(root), createPixivRootMarker(root)])
    const identity = await readPixivRootMarker(root)
    expect(identity).toBeTruthy()
    for (const outcome of outcomes) if (outcome.status === 'fulfilled') expect(outcome.value).toBe(identity)
    expect(await createPixivRootMarker(root)).toBe(identity)
  })

  it('rejects path changes even with manual confirmation and rejects mid-execution UUID changes', async () => {
    const root = await fixture()
    const db = database({ ...legacy(root), rootPathHash: '0'.repeat(64) })
    await expect(bindPixivInventoryRoot(db.transaction, root, new Date(), true)).rejects.toThrow('path differs')
    const identity = await createPixivRootMarker(root)
    await expect(
      assertPixivRootUnchanged({ ...root, rootIdentity: identity, deviceId: root.deviceId + 1n })
    ).rejects.toThrow('changed during execution')
    await fs.writeFile(
      path.join(root.absolutePath, '.pixishelf-root'),
      JSON.stringify({ version: 1, id: randomUUID() })
    )
    await expect(assertPixivRootUnchanged({ ...root, rootIdentity: identity })).rejects.toThrow('UUID changed')
  })

  it('rejects a lost inventory CAS without replacing its persistent marker', async () => {
    const root = await fixture()
    const db = database(legacy(root))
    db.delegate.updateMany.mockResolvedValueOnce({ count: 0 })
    await expect(bindPixivInventoryRoot(db.transaction, root, new Date())).rejects.toThrow(
      'changed during root binding'
    )
    expect(await readPixivRootMarker(root)).toBeTruthy()
  })
})
