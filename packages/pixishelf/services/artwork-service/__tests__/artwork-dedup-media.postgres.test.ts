// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/prisma', async () => ({
  prisma: (await import('../../../../pixishelf-db/src/__tests__/artwork-dedup-maintenance-fixture')).db
}))
import {
  db,
  seed,
  cleanupFixture,
  prefix
} from '../../../../pixishelf-db/src/__tests__/artwork-dedup-maintenance-fixture'
import {
  addImage,
  addImageWithChapters,
  associateChaptersToImage,
  clearChaptersForImage,
  updateArtworkImagesTransaction
} from '../image-manager'
import { assignManualArtworkStorage } from '../manual-storage'
import { beginMediaContentPathWrite, prepareMediaContentUploadChunk, ackMediaContentUploadChunk } from '@pixishelf/db'
import { beginContentUpload, resolveContentPath, contentAuthorization } from '../content-source-guard'
const operations: string[] = [],
  tokens: string[] = []
let tempRoot: string | undefined
let originalDirectories: { id: string; rootIdentity: string }[] = []
async function claim(f: Awaited<ReturnType<typeof seed>>) {
  const operation = await db!.artworkDedupOperation.create({
    data: {
      runId: f.run.id,
      artistId: f.artist.id,
      requestedBy: f.actor.id,
      idempotencyKey: randomUUID(),
      requestDigest: 'fixture',
      runVersion: 1,
      frozenReviewRevision: 0,
      selectionKind: 'EXPLICIT'
    }
  })
  operations.push(operation.id)
  await db!.artworkDedupClaim.createMany({
    data: f.members.flat().map((artworkId, index) => ({
      artworkId,
      operationId: operation.id,
      executionVersion: 1,
      role: index ? 'COPY' : 'KEEPER'
    }))
  })
}
describe.skipIf(!db)('App media registration durable guards', () => {
  afterAll(async () => {
    if (!db) return
    await db.artworkDedupClaim.deleteMany({ where: { operationId: { in: operations } } })
    await db.mediaContentSource.updateMany({
      where: { writeToken: { in: tokens } },
      data: { writeToken: null, writeStartedAt: null }
    })
    await db.artworkContentSource.updateMany({
      where: { writeToken: { in: tokens } },
      data: { writeToken: null, writeStartedAt: null }
    })
    await db.mediaContentPathWrite.deleteMany({ where: { writeToken: { in: tokens } } })
    if (tempRoot) {
      await db.mediaContentSource.updateMany({
        where: { image: { path: { startsWith: prefix } } },
        data: { directoryStateId: null }
      })
      await db.mediaContentDirectoryState.deleteMany({
        where: { id: { notIn: originalDirectories.map((row) => row.id) } }
      })
      for (const row of originalDirectories)
        {await db.mediaContentDirectoryState.update({ where: { id: row.id }, data: { rootIdentity: row.rootIdentity } })}
      await rm(tempRoot, { recursive: true, force: true })
    }
    await db.mediaContentSource.updateMany({
      where: { directory: { relativeDirectory: { startsWith: prefix } } },
      data: { directoryStateId: null }
    })
    await db.mediaContentDirectoryState.deleteMany({ where: { relativeDirectory: { startsWith: prefix } } })
    await cleanupFixture()
  })
  it('rejects keeper/copy media and manual path mutations in the original transaction with zero writes', async () => {
    const f = await db!.$transaction((tx) => seed(tx))
    await claim(f)
    const ids = f.members.flat()
    const before = await db!.image.findMany({ where: { artworkId: { in: ids } }, orderBy: { id: 'asc' } })
    const artworks = await db!.artwork.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } })
    for (const image of before) {
      await expect(
        addImage(image.artworkId!, {
          fileName: 'new.jpg',
          path: `${prefix}/new.jpg`,
          order: 1,
          width: 1,
          height: 1,
          size: 1
        })
      ).rejects.toMatchObject({ code: 'CONFLICT' })
      await expect(updateArtworkImagesTransaction(image.artworkId!, [])).rejects.toMatchObject({ code: 'CONFLICT' })
      await expect(
        associateChaptersToImage({
          imageId: image.id,
          chaptersPath: `${prefix}/chapter.json`,
          chaptersCount: 1,
          chaptersDuration: 1,
          chaptersHash: 'a'.repeat(64)
        })
      ).rejects.toMatchObject({ code: 'CONFLICT' })
      await expect(clearChaptersForImage({ imageId: image.id })).rejects.toMatchObject({ code: 'CONFLICT' })
      await expect(
        db!.$transaction((tx) =>
          assignManualArtworkStorage(tx, { id: image.artworkId!, artistId: null, storageKey: null })
        )
      ).rejects.toMatchObject({ code: 'CONFLICT' })
    }
    expect(await db!.image.findMany({ where: { artworkId: { in: ids } }, orderBy: { id: 'asc' } })).toEqual(before)
    expect(await db!.artwork.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } })).toEqual(artworks)
  })
  it('declares the related video at first chapter begin, rejects old unbound token reuse, and rejects late claims', async () => {
    const f = await db!.$transaction((tx) => seed(tx))
    const image = await db!.image.findFirstOrThrow({ where: { artworkId: f.members[0]![0] } })
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'dedup-media-b1-'))
    await mkdir(path.join(tempRoot, prefix))
    originalDirectories = await db!.mediaContentDirectoryState.findMany({ select: { id: true, rootIdentity: true } })
    const resolved = await resolveContentPath(tempRoot, `${prefix}/chapters.json`)
    await db!.mediaContentDirectoryState.updateMany({
      where: { logicalRoot: 'source-media:v1' },
      data: { rootIdentity: resolved.directory.rootIdentity }
    })
    const args = {
      scanRoot: tempRoot,
      absolutePath: `${prefix}/chapters.json`,
      userId: f.actor.id,
      sessionId: randomUUID(),
      writeToken: randomUUID(),
      declaredFileSize: 1,
      totalChunks: 1
    }
    tokens.push(args.writeToken)
    await beginContentUpload(args)
    const relatedImage = { imageId: image.id, artworkId: image.artworkId!, path: image.path }
    await expect(beginContentUpload({ ...args, relatedImage })).rejects.toThrow('原章节上传没有匹配的媒体声明')
    expect((await db!.mediaContentSource.findUnique({ where: { imageId: image.id } }))?.writeToken ?? null).toBeNull()
    const next = {
      ...args,
      absolutePath: `${prefix}/new-chapters.json`,
      sessionId: randomUUID(),
      writeToken: randomUUID(),
      relatedImage
    }
    tokens.push(next.writeToken)
    await beginContentUpload(next)
    expect(await db!.mediaContentSource.findUnique({ where: { imageId: image.id } })).toMatchObject({
      writeToken: next.writeToken
    })
    await expect(beginContentUpload(next)).resolves.toMatchObject({
      authorization: { handle: { writeToken: next.writeToken } }
    })
    await claim(f)
    const before = await db!.image.findUniqueOrThrow({ where: { id: image.id } })
    await expect(
      associateChaptersToImage({
        imageId: image.id,
        chaptersPath: `${prefix}/new-chapters.json`,
        chaptersCount: 1,
        chaptersDuration: 1,
        chaptersHash: 'a'.repeat(64)
      })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(await db!.image.findUniqueOrThrow({ where: { id: image.id } })).toEqual(before)
    const fresh = { ...next, absolutePath: `${prefix}/held.json`, sessionId: randomUUID(), writeToken: randomUUID() }
    tokens.push(fresh.writeToken)
    await expect(beginContentUpload(fresh)).rejects.toMatchObject({ status: 'WRITING' })
    expect(await db!.mediaContentPathWrite.count({ where: { writeToken: fresh.writeToken } })).toBe(0)
  })
  async function readyUpload(f: Awaited<ReturnType<typeof seed>>, fileName: string) {
    const sessionId = randomUUID(),
      writeToken = randomUUID(),
      requestId = randomUUID()
    tokens.push(writeToken)
    const root = await db!.mediaContentDirectoryState.findUnique({
      where: { logicalRoot_relativeDirectory: { logicalRoot: 'source-media:v1', relativeDirectory: '' } }
    })
    const directory = {
      logicalRoot: 'source-media:v1' as const,
      rootIdentity: root?.rootIdentity ?? 'fixture',
      relativeDirectory: prefix
    }
    const owner = { ownerUserId: f.actor.id, sessionId, sessionVersion: 1n, execution: null }
    const relativePath = `${prefix}/${fileName}`
    return db!.$transaction(async (tx) => {
      const begin = await beginMediaContentPathWrite(tx, {
        directory,
        scope: { kind: 'PATH', relativePath },
        owner,
        writeToken,
        upload: { declaredFileSize: 4n, totalChunks: 1 },
        parent: null,
        now: new Date()
      })
      if (begin.status !== 'READY') throw new Error(begin.status)
      const handle = begin.value
      const prepared = await prepareMediaContentUploadChunk(tx, {
        owner,
        handle,
        declaredFileSize: 4n,
        totalChunks: 1,
        requestId,
        chunkIndex: 0,
        offset: 0n,
        observedFileSize: 0n
      })
      if (prepared.status !== 'READY') throw new Error(prepared.status)
      const receipt = { requestId, chunkIndex: 0, offset: 0n, byteLength: 4n, sha256: 'a'.repeat(64) }
      const ack = await ackMediaContentUploadChunk(tx, {
        owner,
        handle,
        receipt,
        verifiedFileSize: 4n,
        now: new Date()
      })
      if (ack.status !== 'READY') throw new Error(ack.status)
      return {
        fileName,
        path: relativePath,
        order: 1,
        width: 1,
        height: 1,
        size: 4,
        uploadReceipt: {
          expectedUserId: f.actor.id,
          authorization: contentAuthorization(sessionId, ack.value.handle),
          receipt: { ...receipt, offset: '0', byteLength: '4' }
        }
      }
    })
  }
  it('rejects a READY late registration with the original receipt and zero publication writes', async () => {
    const f = await db!.$transaction((tx) => seed(tx))
    const file = await readyUpload(f, `${randomUUID()}.jpg`)
    await claim(f)
    const before = await db!.mediaContentPathWrite.findUniqueOrThrow({
      where: { writeToken: file.uploadReceipt.authorization.handle.writeToken }
    })
    const images = await db!.image.findMany({ where: { artworkId: f.members[0]![0] } })
    await expect(addImageWithChapters(f.members[0]![0]!, file, undefined, f.actor.id)).rejects.toMatchObject({
      code: 'CONFLICT'
    })
    expect(await db!.mediaContentPathWrite.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before)
    expect(before.status).toBe('READY')
    expect(await db!.image.findMany({ where: { artworkId: f.members[0]![0] } })).toEqual(images)
  })
  it('replays COMPLETED publication as a pure read even after a durable claim', async () => {
    const f = await db!.$transaction((tx) => seed(tx))
    const file = await readyUpload(f, `${randomUUID()}.jpg`)
    const image = await addImageWithChapters(f.members[0]![0]!, file, undefined, f.actor.id)
    await claim(f)
    const before = await db!.mediaContentPathWrite.findUniqueOrThrow({
      where: { writeToken: file.uploadReceipt.authorization.handle.writeToken }
    })
    const artwork = await db!.artwork.findUniqueOrThrow({ where: { id: image.artworkId! } })
    expect(before.status).toBe('COMPLETED')
    expect(await addImageWithChapters(f.members[0]![0]!, file, undefined, f.actor.id)).toEqual(image)
    expect(await db!.mediaContentPathWrite.findUniqueOrThrow({ where: { id: before.id } })).toEqual(before)
    expect(await db!.artwork.findUniqueOrThrow({ where: { id: image.artworkId! } })).toEqual(artwork)
  })
  it('keeps unclaimed chapter association and clear functional', async () => {
    const f = await db!.$transaction((tx) => seed(tx))
    const image = await db!.image.findFirstOrThrow({ where: { artworkId: f.members[0]![0] } })
    await associateChaptersToImage({
      imageId: image.id,
      chaptersPath: `${prefix}/normal.json`,
      chaptersCount: 1,
      chaptersDuration: 1,
      chaptersHash: 'a'.repeat(64)
    })
    expect(await db!.image.findUnique({ where: { id: image.id } })).toMatchObject({ chaptersCount: 1 })
    await clearChaptersForImage({ imageId: image.id })
    expect(await db!.image.findUnique({ where: { id: image.id } })).toMatchObject({
      chaptersCount: 0,
      chaptersPath: null
    })
  })
})
