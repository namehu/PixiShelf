// @vitest-environment node
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import sharp from 'sharp'
import { Readable } from 'node:stream'
import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { getMediaMarks, setMediaMark } from '@/services/media-mark-service'
import {
  handleMediaUploadChunk,
  getMediaUploadStatus,
  restartMediaUpload,
  type MediaUploadChunkInput
} from '../media-upload'
import { addImageWithChapters, reconcileArtworkImages, deleteImage, previewDeleteImage } from '../image-manager'
import { assertContentScan, captureContentDirectory, resolveContentPath } from '../content-source-guard'
import { uploadMediaChapterManifest } from '../media-chapter-upload'
import { resolveReplacementChildren } from '../replacement-content-guard'
import { handleImageReplaceSession } from '../image-replace-session'

vi.mock('@/services/setting.service', async (original) => ({
  ...(await original<typeof import('@/services/setting.service')>()),
  getScanPath: async () => root
}))

const enabled = Boolean(process.env.QUEUE_KERNEL_TEST_DATABASE_URL)
const suite = enabled ? describe : describe.skip
const prefix = `dedup-upload-${randomUUID()}`
const userId = `${prefix}-owner`
let root: string
let rootIdentity: string
const uploadIds: string[] = []
const artworkIds: number[] = []

suite('persistent upload claims and publication', () => {
  beforeAll(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-dedup-upload-'))
    process.env.ARCHIVE_STORAGE_PATH = root
    rootIdentity = (await resolveContentPath(root, '.fixture-identity')).directory.rootIdentity
    await prisma.userBA.create({ data: { id: userId, name: prefix } })
  })
  afterAll(async () => {
    await prisma.mediaContentPathWrite.deleteMany({ where: { parentWriteId: { in: uploadIds } } })
    await prisma.mediaContentPathWrite.deleteMany({ where: { ownerUserId: userId } })
    await prisma.artwork.deleteMany({ where: { id: { in: artworkIds } } })
    await prisma.mediaContentDirectoryState.deleteMany({ where: { rootIdentity } })
    await prisma.userBA.delete({ where: { id: userId } })
    await fs.rm(root, { recursive: true, force: true })
    await prisma.$disconnect()
  })

  it('blocks scans with no Image, keeps READY guarded, then publishes once', async () => {
    const { artwork, directory } = await seed('pause')
    const snapshot = await captureContentDirectory(root, directory)
    const first = input(directory, 'new.mp4', 'abc', { totalChunks: 2, declaredFileSize: 6 })
    const partial = await handleMediaUploadChunk(first)
    expect(partial.type).toBe('chunk')
    expect(await prisma.image.count({ where: { artworkId: artwork.id } })).toBe(0)
    await expect(captureContentDirectory(root, directory)).rejects.toThrow('WRITING')
    const final = await handleMediaUploadChunk({
      ...first,
      body: Readable.from(Buffer.from('def')),
      chunkIndex: 1,
      offset: 3,
      requestId: randomUUID(),
      authorization: partial.authorization
    })
    expect(final.type).toBe('final')
    await expect(captureContentDirectory(root, directory)).rejects.toThrow('WRITING')
    await expect(prisma.$transaction((tx) => assertContentScan(tx, [snapshot]))).rejects.toThrow()
    const media = await addImageWithChapters(artwork.id, final.meta![0]!, undefined, userId)
    const repeated = await addImageWithChapters(artwork.id, final.meta![0]!, undefined, userId)
    expect(repeated.id).toBe(media.id)
    expect(await prisma.image.count({ where: { artworkId: artwork.id } })).toBe(1)
    expect(await fs.readFile(path.join(root, directory, 'new.mp4'), 'utf8')).toBe('abcdef')
    await expect(captureContentDirectory(root, directory)).resolves.toBeTruthy()
  })

  it('does not rewrite an acknowledged chunk or let another account resume it', async () => {
    const { directory } = await seed('replay')
    const request = input(directory, 'replay.mp4', 'abc', { totalChunks: 2, declaredFileSize: 6 })
    const first = await handleMediaUploadChunk(request)
    const before = await fs.stat(path.join(root, directory, 'replay.mp4'), { bigint: true })
    const replay = await handleMediaUploadChunk({
      ...request,
      body: Readable.from(Buffer.from('BAD')),
      authorization: first.authorization
    })
    expect(replay.nextChunkIndex).toBe(1)
    expect((await fs.stat(path.join(root, directory, 'replay.mp4'), { bigint: true })).mtimeNs).toBe(before.mtimeNs)
    expect(await fs.readFile(path.join(root, directory, 'replay.mp4'), 'utf8')).toBe('abc')
    await expect(
      getMediaUploadStatus({ ...request, userId: 'other-account', expectedUserId: 'other-account' })
    ).rejects.toThrow()
    await expect(
      handleMediaUploadChunk({
        ...request,
        body: Readable.from('def'),
        authorization: first.authorization,
        requestId: randomUUID(),
        chunkIndex: 1,
        offset: 4
      })
    ).rejects.toThrow()
    expect(await fs.readFile(path.join(root, directory, 'replay.mp4'), 'utf8')).toBe('abc')
  })

  it('allows independent same-directory paths to publish despite generation changes', async () => {
    const { artwork, directory } = await seed('parallel')
    const [a, b] = await Promise.all(
      ['a', 'b'].map((name) => handleMediaUploadChunk(input(directory, `${name}.mp4`, name)))
    )
    await addImageWithChapters(artwork.id, a!.meta![0]!, undefined, userId)
    await expect(captureContentDirectory(root, directory)).rejects.toThrow('WRITING')
    await addImageWithChapters(artwork.id, b!.meta![0]!, undefined, userId)
    expect(await prisma.image.count({ where: { artworkId: artwork.id } })).toBe(2)
    await expect(captureContentDirectory(root, directory)).resolves.toBeTruthy()
  })

  it('keeps same-ID marks unavailable until overwrite publication, then retires only that media', async () => {
    const { artwork, directory } = await seed('overwrite')
    const original = await prisma.image.create({
      data: { artworkId: artwork.id, path: `/${directory}/same.mp4`, size: 3n, mediaType: 'VIDEO' }
    })
    await fs.writeFile(path.join(root, directory, 'same.mp4'), 'old')
    await setMediaMark(userId, artwork.id, original.id, 'like', true)
    const final = await handleMediaUploadChunk(input(directory, 'same.mp4', 'new'))
    expect((await getMediaMarks(userId, artwork.id, [original.id])).items[0]?.available).toBe(false)
    await expect(setMediaMark(userId, artwork.id, original.id, 'bookmark', true)).rejects.toThrow()
    const published = await addImageWithChapters(artwork.id, final.meta![0]!, undefined, userId)
    expect(published.id).toBe(original.id)
    expect(await prisma.mediaMark.findFirst({ where: { userId, artworkId: artwork.id } })).toMatchObject({
      mediaId: null,
      likedAt: expect.any(Date)
    })
  })

  it('keeps a directory claim through replacement rollback and restores original marks', async () => {
    const { artwork, directory } = await seed('rollback')
    const original = await prisma.image.create({
      data: { artworkId: artwork.id, path: `/${directory}/old.mp4`, size: 3n, mediaType: 'VIDEO' }
    })
    await fs.writeFile(path.join(root, directory, 'old.mp4'), 'old')
    await setMediaMark(userId, artwork.id, original.id, 'bookmark', true)
    const identity = { sessionId: randomUUID(), writeToken: randomUUID(), userId }
    const base = {
      scanRoot: root,
      artworkId: artwork.id,
      artwork: { externalId: null, storagePath: directory, images: [{ path: original.path }] },
      ...identity
    }
    const initialized = await handleImageReplaceSession({ ...base, action: 'init' })
    if (!('authorization' in initialized)) throw new Error('Missing replacement authorization')
    uploadIds.push(initialized.authorization.handle.writeId)
    const child = await handleMediaUploadChunk({
      ...input(directory, 'new.mp4', 'new'),
      sessionId: identity.sessionId,
      parent: initialized.authorization
    })
    expect(child.type).toBe('final')
    await expect(captureContentDirectory(root, directory)).rejects.toThrow('WRITING')
    await handleImageReplaceSession({ ...base, action: 'rollback', authorization: initialized.authorization })
    expect(await fs.readFile(path.join(root, directory, 'old.mp4'), 'utf8')).toBe('old')
    await expect(fs.stat(path.join(root, directory, 'new.mp4'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await prisma.mediaMark.findFirst({ where: { userId, artworkId: artwork.id } })).toMatchObject({
      mediaId: original.id
    })
    await expect(captureContentDirectory(root, directory)).resolves.toBeTruthy()
  })
  it('replays replacement commit, retires old references and isolates unfinished children', async () => {
    const { artwork, directory } = await seed('commit')
    const original = await prisma.image.create({
      data: { artworkId: artwork.id, path: `/${directory}/old.mp4`, size: 3n, mediaType: 'VIDEO' }
    })
    await fs.writeFile(path.join(root, directory, 'old.mp4'), 'old')
    await setMediaMark(userId, artwork.id, original.id, 'like', true)
    const identity = { sessionId: randomUUID(), writeToken: randomUUID(), userId }
    const base = {
      scanRoot: root,
      artworkId: artwork.id,
      artwork: { externalId: null, storagePath: directory, images: [{ path: original.path }] },
      ...identity
    }
    const initialized = await handleImageReplaceSession({ ...base, action: 'init' })
    if (!('authorization' in initialized)) throw new Error('Missing replacement authorization')
    uploadIds.push(initialized.authorization.handle.writeId)
    const complete = await handleMediaUploadChunk({
      ...input(directory, 'complete.mp4', 'new'),
      sessionId: identity.sessionId,
      parent: initialized.authorization
    })
    const incomplete = await handleMediaUploadChunk({
      ...input(directory, 'incomplete.mp4', 'abc', { totalChunks: 2, declaredFileSize: 6 }),
      sessionId: identity.sessionId,
      parent: initialized.authorization
    })
    // Simulate a failure after child resolution but before the parent DB transaction.
    await resolveReplacementChildren({
      scanRoot: root,
      userId,
      parent: initialized.authorization,
      publish: complete.meta!
    })
    const commit = {
      ...base,
      action: 'commit' as const,
      authorization: initialized.authorization,
      readBody: async () => ({ filesMeta: complete.meta })
    }
    await handleImageReplaceSession(commit)
    await handleImageReplaceSession(commit)
    expect(await prisma.image.count({ where: { artworkId: artwork.id } })).toBe(1)
    expect(await prisma.mediaMark.findFirst({ where: { artworkId: artwork.id, userId } })).toMatchObject({
      mediaId: null,
      likedAt: expect.any(Date)
    })
    await expect(fs.stat(path.join(root, directory, 'incomplete.mp4'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(
      await fs.readFile(
        path.join(
          root,
          '.pixishelf-upload-recovery',
          initialized.authorization.handle.writeId,
          incomplete.authorization.handle.writeId,
          'media'
        ),
        'utf8'
      )
    ).toBe('abc')
    await expect(captureContentDirectory(root, directory)).resolves.toBeTruthy()
  })

  it('keeps an interrupted byte write guarded instead of promoting actual file length', async () => {
    const { directory } = await seed('stream-failure')
    const bytes = Readable.from(
      (async function* () {
        yield Buffer.from('abc')
        throw new Error('stream failed')
      })()
    )
    const request = input(directory, 'failed.mp4', 'abcdef', { body: bytes })
    await expect(handleMediaUploadChunk(request)).rejects.toThrow('stream failed')
    const checkpoint = await getMediaUploadStatus(request)
    expect(checkpoint.status).toBe('RECOVERY_REQUIRED')
    expect(checkpoint.size).toBe(0)
    await expect(captureContentDirectory(root, directory)).rejects.toThrow('WRITING')
    if (!checkpoint.authorization) throw new Error('Missing restart authorization')
    const restart = { ...request, authorization: checkpoint.authorization }
    await expect(restartMediaUpload({ ...restart, userId: 'other', expectedUserId: 'other' })).rejects.toThrow()
    await expect(restartMediaUpload({ ...restart, writeToken: randomUUID() })).rejects.toThrow()
    await expect(restartMediaUpload({ ...restart, fileName: 'another.mp4' })).rejects.toThrow()
    const restarted = await restartMediaUpload(restart)
    await expect(restartMediaUpload(restart)).rejects.toThrow()
    await expect(handleMediaUploadChunk({ ...request, body: Readable.from('abcdef') })).rejects.toThrow('检查点授权')
    await expect(
      handleMediaUploadChunk({ ...request, body: Readable.from('abcdef'), authorization: checkpoint.authorization })
    ).rejects.toThrow()
    await expect(captureContentDirectory(root, directory)).rejects.toThrow('WRITING')
    const complete = await handleMediaUploadChunk({
      ...request,
      body: Readable.from('abcdef'),
      authorization: restarted.authorization,
      requestId: randomUUID()
    })
    expect(complete.type).toBe('final')
    expect(await fs.readFile(path.join(root, directory, 'failed.mp4'), 'utf8')).toBe('abcdef')
  })

  it('keeps a corrupt image overwrite recoverable before READY and publishes only after explicit rewrite', async () => {
    const { artwork, directory } = await seed('corrupt-image')
    const good = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#987654' } })
      .jpeg()
      .toBuffer()
    const original = await prisma.image.create({
      data: { artworkId: artwork.id, path: `/${directory}/broken.jpg`, size: BigInt(good.length), mediaType: 'IMAGE' }
    })
    await fs.writeFile(path.join(root, directory, 'broken.jpg'), good)
    await setMediaMark(userId, artwork.id, original.id, 'bookmark', true)
    const request = input(directory, 'broken.jpg', '', {
      declaredFileSize: good.length,
      body: Readable.from(Buffer.alloc(good.length))
    })
    await expect(handleMediaUploadChunk(request)).rejects.toThrow()
    const failed = await getMediaUploadStatus(request)
    expect(failed).toMatchObject({ status: 'RECOVERY_REQUIRED', nextChunkIndex: 0, size: 0 })
    await expect(captureContentDirectory(root, directory)).rejects.toThrow('WRITING')
    expect((await getMediaMarks(userId, artwork.id, [original.id])).items[0]?.available).toBe(false)
    const restarted = await restartMediaUpload({ ...request, authorization: failed.authorization! })
    const final = await handleMediaUploadChunk({
      ...request,
      requestId: randomUUID(),
      authorization: restarted.authorization,
      body: Readable.from(good)
    })
    const image = await addImageWithChapters(artwork.id, final.meta![0]!, undefined, userId)
    expect(image.id).toBe(original.id)
    await expect(captureContentDirectory(root, directory)).resolves.toBeTruthy()
    expect((await fs.readFile(path.join(root, directory, 'broken.jpg'))).equals(good)).toBe(true)
  })

  it('retains the original session for explicit rewrite after metadata I/O fails', async () => {
    const { artwork, directory } = await seed('metadata-io')
    const good = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#123456' } })
      .jpeg()
      .toBuffer()
    const request = input(directory, 'metadata-failure.jpg', '', {
      declaredFileSize: good.length,
      body: Readable.from(good)
    })
    const lstat = fs.lstat.bind(fs)
    const failure = vi.spyOn(fs, 'lstat').mockImplementation((async (...args: Parameters<typeof fs.lstat>) => {
      const result = await lstat(...args)
      if (String(args[0]).endsWith('metadata-failure.jpg') && result.isFile() && result.size > 0) {
        throw Object.assign(new Error('metadata I/O fixture'), { code: 'EIO' })
      }
      return result
    }) as typeof fs.lstat)
    try {
      await expect(handleMediaUploadChunk(request)).rejects.toThrow('metadata I/O')
    } finally {
      failure.mockRestore()
    }
    const failed = await getMediaUploadStatus(request)
    expect(failed.status).toBe('RECOVERY_REQUIRED')
    await expect(captureContentDirectory(root, directory)).rejects.toThrow('WRITING')
    const restarted = await restartMediaUpload({ ...request, authorization: failed.authorization! })
    const final = await handleMediaUploadChunk({
      ...request,
      requestId: randomUUID(),
      authorization: restarted.authorization,
      body: Readable.from(good)
    })
    await addImageWithChapters(artwork.id, final.meta![0]!, undefined, userId)
    await expect(captureContentDirectory(root, directory)).resolves.toBeTruthy()
  })

  it('uses the advanced checkpoint handle when a READY replay finds invalid metadata', async () => {
    const { artwork, directory } = await seed('ready-metadata')
    const good = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#456789' } })
      .jpeg()
      .toBuffer()
    const request = input(directory, 'ready.jpg', '', { declaredFileSize: good.length, body: Readable.from(good) })
    const ready = await handleMediaUploadChunk(request)
    await fs.writeFile(path.join(root, directory, 'ready.jpg'), Buffer.alloc(good.length))
    await expect(
      handleMediaUploadChunk({ ...request, authorization: ready.authorization, body: Readable.from(good) })
    ).rejects.toThrow()
    const failed = await getMediaUploadStatus(request)
    expect(failed.status).toBe('RECOVERY_REQUIRED')
    expect(BigInt(failed.authorization!.handle.declarationVersion)).toBeGreaterThan(
      BigInt(ready.authorization.handle.declarationVersion)
    )
    const restarted = await restartMediaUpload({ ...request, authorization: failed.authorization! })
    const final = await handleMediaUploadChunk({
      ...request,
      requestId: randomUUID(),
      authorization: restarted.authorization,
      body: Readable.from(good)
    })
    await addImageWithChapters(artwork.id, final.meta![0]!, undefined, userId)
    await expect(captureContentDirectory(root, directory)).resolves.toBeTruthy()
  })

  it('keeps surviving Image IDs and marks during a normal rescan and deletes only its claimed media', async () => {
    const { artwork, directory } = await seed('rescan-delete')
    const original = await prisma.image.create({
      data: { artworkId: artwork.id, path: `/${directory}/same.mp4`, size: 3n, mediaType: 'VIDEO' }
    })
    await fs.writeFile(path.join(root, directory, 'same.mp4'), 'old')
    await setMediaMark(userId, artwork.id, original.id, 'bookmark', true)
    const snapshot = await captureContentDirectory(root, directory)
    await prisma.$transaction(async (tx) => {
      await assertContentScan(tx, [snapshot])
      await reconcileArtworkImages(tx, artwork.id, [
        { fileName: 'same.mp4', path: original.path, size: 3, order: 0, width: 0, height: 0 }
      ])
    })
    expect(await prisma.image.findUnique({ where: { id: original.id } })).not.toBeNull()
    expect(await prisma.mediaMark.findFirst({ where: { artworkId: artwork.id, userId } })).toMatchObject({
      mediaId: original.id
    })
    await deleteImage(original.id, true, userId, await previewDeleteImage(original.id, 'IMAGE', userId))
    expect(await prisma.image.findUnique({ where: { id: original.id } })).toBeNull()
    await expect(fs.stat(path.join(root, directory, 'same.mp4'))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(captureContentDirectory(root, directory)).resolves.toBeTruthy()
  })

  it('replays a completed chapter upload without rewriting its bytes', async () => {
    const { artwork, directory } = await seed('chapter')
    const video = await prisma.image.create({
      data: { artworkId: artwork.id, path: `/${directory}/video.mp4`, mediaType: 'VIDEO', size: 3n }
    })
    await fs.writeFile(path.join(root, directory, 'video.mp4'), 'vid')
    const request = {
      scanRoot: root,
      userId,
      expectedUserId: userId,
      artworkId: artwork.id,
      imageId: video.id,
      videoPath: video.path,
      uploadSessionId: randomUUID(),
      uploadToken: randomUUID(),
      uploadRequestId: randomUUID(),
      manifestText: JSON.stringify({
        version: 1,
        duration: 10,
        chapters: [{ index: 1, title: 'Intro', start: 0, end: 10, duration: 10 }]
      })
    }
    const first = await uploadMediaChapterManifest(request)
    const before = await fs.stat(path.join(root, directory, 'video.chapters.json'), { bigint: true })
    await uploadMediaChapterManifest({ ...request, uploadAuthorization: first.uploadReceipt!.authorization })
    expect((await fs.stat(path.join(root, directory, 'video.chapters.json'), { bigint: true })).mtimeNs).toBe(
      before.mtimeNs
    )
    await expect(captureContentDirectory(root, directory)).resolves.toBeTruthy()
  })
})

async function seed(label: string) {
  const directory = `${prefix}/${label}`
  await fs.mkdir(path.join(root, directory), { recursive: true })
  const artwork = await prisma.artwork.create({ data: { title: `${prefix}-${label}`, storagePath: directory } })
  artworkIds.push(artwork.id)
  return { artwork, directory }
}
function input(
  directory: string,
  fileName: string,
  bytes: string,
  overrides: Partial<MediaUploadChunkInput> = {}
): MediaUploadChunkInput {
  return {
    scanRoot: root,
    fileName,
    targetDir: directory,
    targetRelDir: directory,
    userId,
    expectedUserId: userId,
    sessionId: randomUUID(),
    writeToken: randomUUID(),
    requestId: randomUUID(),
    chunkIndex: 0,
    totalChunks: 1,
    offset: 0,
    declaredFileSize: Buffer.byteLength(bytes),
    body: Readable.from(Buffer.from(bytes)),
    ...overrides
  }
}
