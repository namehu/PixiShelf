import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { beginMediaContentSourceWrite, PrismaClient, type Prisma } from '@pixishelf/db'
import {
  fingerprintArtworkContent,
  inspectMediaContentFile,
  readMediaContentFile,
  resolveMediaContentRoots,
  type ArtworkFingerprintInput,
  type ResolvedMediaContentRoot
} from '../index.ts'

const databaseUrl = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const suite = databaseUrl ? describe.sequential : describe.skip
const db = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const prefix = 'dedup-content-' + randomUUID()
const artworkIds: number[] = []
let root: string
let binding: ResolvedMediaContentRoot
const transaction = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  db!.$transaction(fn, { timeout: 20_000, maxWait: 20_000 })

suite('durable artwork original-content evidence', () => {
  beforeAll(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), prefix)))
    binding = (await resolveMediaContentRoots({ sourceRoot: root, archiveRoot: root, expectedPixivRootIdentity: null }))
      .source
  })
  afterAll(async () => {
    if (db) {
      await db.artwork.deleteMany({ where: { id: { in: artworkIds } } })
      if (binding) {
        await db.mediaContentPathWrite.deleteMany({ where: { directory: { rootIdentity: binding.rootIdentity } } })
        await db.mediaContentDirectoryState.deleteMany({ where: { rootIdentity: binding.rootIdentity } })
      }
      await db.$disconnect()
    }
    if (root) await fs.rm(root, { recursive: true, force: true })
  })

  it('reuses 500 durable hashes after refresh and reads only the changed member', async () => {
    const artworkId = await fixture('large', 500)
    const first = ready(await run(artworkId))
    expect(first.metrics.hashedFiles).toBe(500)
    expect(first.metrics.bytesRead).toBeGreaterThan(0n)
    const cached = await db!.mediaContentFingerprint.findMany({
      where: { image: { artworkId } },
      select: { imageId: true, hashedAt: true }
    })
    const warm = ready(await run(artworkId))
    expect(warm.contentSha256).toBe(first.contentSha256)
    expect(warm.metrics).toMatchObject({ hashedFiles: 0, bytesRead: 0n, cacheHits: 500, cacheWrites: 0 })
    expect(
      await db!.mediaContentFingerprint.findMany({
        where: { image: { artworkId } },
        select: { imageId: true, hashedAt: true }
      })
    ).toEqual(cached)

    const changed = await db!.image.findFirstOrThrow({ where: { artworkId }, orderBy: { id: 'asc' } })
    await fs.writeFile(path.join(root, changed.path), 'a different original byte sequence')
    const updated = ready(await run(artworkId))
    expect(updated.metrics).toMatchObject({ hashedFiles: 1, cacheHits: 499, cacheWrites: 1 })
    expect(updated.contentSha256).not.toBe(first.contentSha256)
    const renamed = changed.path + '-renamed'
    await fs.rename(path.join(root, changed.path), path.join(root, renamed))
    await db!.image.update({ where: { id: changed.id }, data: { path: renamed } })
    const afterRename = ready(await run(artworkId))
    expect(afterRename.contentSha256).toBe(updated.contentSha256)
    expect(afterRename.membersSignature).not.toBe(updated.membersSignature)
    expect(afterRename.metrics.hashedFiles).toBe(1)

    const beforeSort = await db!.artworkContentSource.findUniqueOrThrow({ where: { artworkId } })
    await db!.image.updateMany({ where: { artworkId }, data: { sortOrder: 77 } })
    await db!.artwork.update({ where: { id: artworkId }, data: { title: 'renamed artwork' } })
    expect(await db!.artworkContentSource.findUniqueOrThrow({ where: { artworkId } })).toEqual(beforeSort)
    expect(ready(await run(artworkId)).metrics.bytesRead).toBe(0n)
  }, 60_000)

  it('forced full check reads originals again and missing media never publishes an artwork', async () => {
    const artworkId = await fixture('forced', 3)
    const first = ready(await run(artworkId))
    const forced = ready(await run(artworkId, { forceRead: true }))
    expect(forced.contentSha256).toBe(first.contentSha256)
    expect(forced.metrics).toMatchObject({ hashedFiles: 3, cacheHits: 0 })
    const incomplete = await fixture('missing', 2)
    const image = await db!.image.findFirstOrThrow({ where: { artworkId: incomplete } })
    await fs.unlink(path.join(root, image.path))
    await expect(run(incomplete)).rejects.toMatchObject({ code: 'NOT_READABLE' })
    expect(await db!.artworkContentFingerprint.findUnique({ where: { artworkId: incomplete } })).toBeNull()
  })

  it('rejects old file evidence when a controlled replacement begins after the read', async () => {
    const artworkId = await fixture('race', 1)
    const image = await db!.image.findFirstOrThrow({ where: { artworkId } })
    let injected = false
    const result = await run(artworkId, {
      reader: {
        inspect: inspectMediaContentFile,
        read: async (input) => {
          const read = await readMediaContentFile(input)
          if (!injected) {
            injected = true
            await transaction((tx) =>
              beginMediaContentSourceWrite(tx, {
                artworkIds: [],
                imageIds: [image.id],
                writeToken: randomUUID(),
                now: new Date()
              })
            )
          }
          return read
        }
      }
    })
    expect(['STALE', 'WRITING']).toContain(result.status)
    expect(await db!.artworkContentFingerprint.findUnique({ where: { artworkId } })).toBeNull()
    expect(await db!.mediaContentFingerprint.findUnique({ where: { imageId: image.id } })).toBeNull()
  })
})

async function fixture(name: string, count: number) {
  const directory = prefix + '/' + name
  await fs.mkdir(path.join(root, directory), { recursive: true })
  const artwork = await db!.artwork.create({ data: { title: prefix + '-' + name } })
  artworkIds.push(artwork.id)
  const rows = []
  for (let index = 0; index < count; index++) {
    const relative = directory + '/' + String(index).padStart(5, '0') + '.bin'
    const bytes = 'original-' + String(index % 7)
    await fs.writeFile(path.join(root, relative), bytes)
    rows.push({ artworkId: artwork.id, path: relative, size: BigInt(Buffer.byteLength(bytes)), sortOrder: index })
  }
  await db!.image.createMany({ data: rows })
  return artwork.id
}
function run(artworkId: number, options: Partial<ArtworkFingerprintInput> = {}) {
  return fingerprintArtworkContent({
    artworkId,
    forceRead: false,
    signal: new AbortController().signal,
    transaction,
    resolveMember: async (member) => ({ root: binding, relativePath: member.sourcePath }),
    reader: { inspect: inspectMediaContentFile, read: readMediaContentFile },
    ...options
  })
}
function ready(result: Awaited<ReturnType<typeof run>>) {
  expect(result.status).toBe('READY')
  if (result.status !== 'READY') throw new Error('Unexpected fingerprint result: ' + result.status)
  return result.value
}
