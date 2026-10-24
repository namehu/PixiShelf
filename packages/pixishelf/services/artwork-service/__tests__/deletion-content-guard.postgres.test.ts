// @vitest-environment node
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { prisma } from '@/lib/prisma'
import { previewDeleteArtwork, deleteArtwork } from '../delete-artwork'
import { previewDeleteImage, deleteImage, clearChaptersForImage } from '../image-manager'
import { captureContentDirectory, resolveContentPath } from '../content-source-guard'
import { readDeletionIntent, type DeletionKind } from '../deletion-content-guard'
import * as manifests from '../recovery-manifest'
vi.mock('@/services/setting.service', () => ({ getScanPath: async () => root }))
vi.mock('@/lib/logger', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
const suite = process.env.QUEUE_KERNEL_TEST_DATABASE_URL ? describe : describe.skip
let root: string
let rootIdentity: string
const userId = `deletion-${randomUUID()}`
const artworkIds: number[] = []
afterEach(() => vi.restoreAllMocks())
suite('App deletion durable original intent', () => {
  beforeAll(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-deletion-')))
    process.env.ARCHIVE_STORAGE_PATH = root
    rootIdentity = (await resolveContentPath(root, '.fixture')).directory.rootIdentity
    await prisma.userBA.create({ data: { id: userId, name: 'Deletion fixture' } })
  })
  afterAll(async () => {
    await prisma.mediaContentPathWrite.deleteMany({ where: { directory: { rootIdentity } } })
    await prisma.artwork.deleteMany({ where: { id: { in: artworkIds } } })
    await prisma.mediaContentDirectoryState.deleteMany({ where: { rootIdentity } })
    await prisma.userBA.delete({ where: { id: userId } })
    await fs.rm(root, { recursive: true, force: true })
    await prisma.$disconnect()
  })
  for (const kind of ['ARTWORK', 'IMAGE', 'CHAPTERS'] as const) {
    it(`${kind}: succeeds and replays completed publication without unlink`, async () => {
      const f = await seed(kind)
      await f.run()
      expect(await prisma.mediaContentPathWrite.findFirst({ where: { sessionId: f.operationId } })).toMatchObject({
        status: 'COMPLETED'
      })
      const targetId = kind === 'ARTWORK' ? f.artwork.id : f.image.id
      const manifestStat = await fs.stat(
        path.join(root, '.pixishelf-upload-recovery', 'deletions', `${kind.toLowerCase()}-${targetId}`, 'manifest.json')
      )
      expect(manifestStat.mode & 0o777).toBe(0o600)
      const unlink = vi.spyOn(fs, 'unlink')
      await f.run()
      expect(unlink).not.toHaveBeenCalled()
      await expect(captureContentDirectory(root, f.directory)).resolves.toBeTruthy()
      if (kind === 'CHAPTERS') {
        expect(await prisma.image.findUnique({ where: { id: f.image.id } })).toMatchObject({ chaptersPath: null })
        expect(await fs.readFile(f.media, 'utf8')).toBe('media')
      } else expect(await prisma.image.findUnique({ where: { id: f.image.id } })).toBeNull()
    })
    it(`${kind}: resumes unlink failure with original scope and preserves later files`, async () => {
      const f = await seed(kind)
      failUnlink(f.chapter)
      await expect(f.run()).rejects.toThrow()
      await expect(captureContentDirectory(root, f.directory)).rejects.toThrow('WRITING')
      vi.restoreAllMocks()
      await fs.writeFile(path.join(root, f.directory, 'later.txt'), 'keep')
      expect((await f.preview()).operationId).toBe(f.operationId)
      await f.run()
      expect(await fs.readFile(path.join(root, f.directory, 'later.txt'), 'utf8')).toBe('keep')
    })
    it(`${kind}: retries database failure without repeating unlink`, async () => {
      const f = await seed(kind)
      failBusinessWrite()
      await expect(f.run()).rejects.toThrow()
      vi.restoreAllMocks()
      await expect(captureContentDirectory(root, f.directory)).rejects.toThrow('WRITING')
      const unlink = vi.spyOn(fs, 'unlink')
      await f.run()
      expect(unlink).not.toHaveBeenCalled()
    })
  }
  for (const kind of ['IMAGE', 'CHAPTERS'] as const) {
    it(`${kind}: rejects a preview after chapter reassociation before creating a manifest or gate`, async () => {
      const f = await seed(kind)
      const oldPath = `${f.directory}/video..chapters.json`
      await fs.writeFile(path.join(root, oldPath), 'original chapter')
      await prisma.image.update({
        where: { id: f.image.id },
        data: { chaptersPath: `/${oldPath}`, chaptersHash: 'original' }
      })
      const preview = await previewDeleteImage(f.image.id, kind, userId)
      await prisma.image.update({
        where: { id: f.image.id },
        data: { chaptersPath: `/${f.directory}/video.chapters.json`, chaptersHash: 'replacement' }
      })
      const run = () =>
        kind === 'IMAGE'
          ? deleteImage(f.image.id, true, userId, preview)
          : clearChaptersForImage({ imageId: f.image.id, deleteFile: true, userId, ...preview })
      await expect(run()).rejects.toThrow('重新打开删除预览')
      expect(await fs.readFile(path.join(root, oldPath), 'utf8')).toBe('original chapter')
      expect(await fs.readFile(f.chapter, 'utf8')).toBe('chapters')
      expect(await fs.readFile(f.media, 'utf8')).toBe('media')
      expect((await prisma.image.findUniqueOrThrow({ where: { id: f.image.id } })).chaptersHash).toBe('replacement')
      expect(await prisma.mediaContentPathWrite.count({ where: { sessionId: preview.operationId } })).toBe(0)
      expect(await readDeletionIntent({ scanRoot: root, userId, kind, targetId: f.image.id })).toBeNull()
    })
  }
  it('rejects changed membership even when the preview file paths are unchanged', async () => {
    const f = await seed('IMAGE')
    const preview = await previewDeleteImage(f.image.id, 'IMAGE', userId)
    await prisma.image.update({ where: { id: f.image.id }, data: { size: 6n } })
    await expect(deleteImage(f.image.id, true, userId, preview)).rejects.toThrow('重新打开删除预览')
    expect(await fs.readFile(f.media, 'utf8')).toBe('media')
    expect(await prisma.mediaContentPathWrite.count({ where: { sessionId: preview.operationId } })).toBe(0)
  })
  it('never restarts an old completed chapter operation after a newer operation', async () => {
    const f = await seed('CHAPTERS')
    await f.run()
    await fs.writeFile(f.chapter, 'second chapters')
    await prisma.image.update({
      where: { id: f.image.id },
      data: { chaptersPath: `/${f.directory}/video.chapters.json`, chaptersHash: 'second' }
    })
    const second = await previewDeleteImage(f.image.id, 'CHAPTERS', userId)
    await clearChaptersForImage({ imageId: f.image.id, deleteFile: true, userId, ...second })
    await fs.writeFile(f.chapter, 'third chapters')
    await prisma.image.update({
      where: { id: f.image.id },
      data: { chaptersPath: `/${f.directory}/video.chapters.json`, chaptersHash: 'third' }
    })
    await f.run()
    expect(await fs.readFile(f.chapter, 'utf8')).toBe('third chapters')
    expect((await prisma.image.findUniqueOrThrow({ where: { id: f.image.id } })).chaptersHash).toBe('third')
  })
  it('keeps reoccupied confirmed path and rejects account or changed selection takeover', async () => {
    const f = await seed('ARTWORK')
    failBusinessWrite()
    await expect(f.run()).rejects.toThrow()
    vi.restoreAllMocks()
    await fs.mkdir(path.dirname(f.media), { recursive: true })
    await fs.writeFile(f.media, 'new occupant')
    await expect(f.run()).rejects.toThrow()
    expect(await fs.readFile(f.media, 'utf8')).toBe('new occupant')
    await expect(previewDeleteArtwork(f.artwork.id, 'another-account')).rejects.toThrow('账户')
    const report = await deleteArtwork(
      { artworkId: f.artwork.id, operationId: f.operationId, selectedPaths: [] },
      { requestedByUserId: userId }
    )
    expect(report.outcome).not.toBe('COMPLETED')
    await expect(captureContentDirectory(root, f.directory)).rejects.toThrow('WRITING')
  })
  it('rejects changed pending identity before unlink', async () => {
    const f = await seed('IMAGE')
    failUnlink(f.media)
    await expect(f.run()).rejects.toThrow()
    vi.restoreAllMocks()
    await fs.writeFile(f.media, 'modified')
    await expect(f.run()).rejects.toThrow('身份')
    expect(await fs.readFile(f.media, 'utf8')).toBe('modified')
  })
  it('recovers missing file when unlink succeeded but its manifest acknowledgement failed', async () => {
    const f = await seed('CHAPTERS')
    const original = manifests.writeRecoveryManifest
    vi.spyOn(manifests, 'writeRecoveryManifest').mockImplementation(async (file, value: any) => {
      if (value.files.some((entry: any) => entry.identity && entry.state === 'ABSENT')) {
        throw new Error('manifest disk unavailable')
      }
      return original(file, value)
    })
    await expect(f.run()).rejects.toThrow('manifest')
    vi.restoreAllMocks()
    const pending = await readDeletionIntent({ scanRoot: root, userId, kind: 'CHAPTERS', targetId: f.image.id })
    expect(pending?.manifest.files[0]?.state).toBe('PENDING')
    await f.run()
  })
  it('recovers between durable gate and handle acknowledgement with the same token', async () => {
    const f = await seed('CHAPTERS')
    const original = manifests.writeRecoveryManifest
    vi.spyOn(manifests, 'writeRecoveryManifest').mockImplementation(async (file, value: any) => {
      if (value.authorization) throw new Error('handle acknowledgement failed')
      return original(file, value)
    })
    await expect(f.run()).rejects.toThrow('acknowledgement')
    vi.restoreAllMocks()
    const before = await prisma.mediaContentPathWrite.findFirstOrThrow({ where: { sessionId: f.operationId } })
    expect(await fs.readFile(f.chapter, 'utf8')).toBe('chapters')
    await f.run()
    const after = await prisma.mediaContentPathWrite.findUniqueOrThrow({ where: { id: before.id } })
    expect(after.writeToken).toBe(before.writeToken)
    expect(after.status).toBe('COMPLETED')
  })
  it('does no unlink or gate acquisition when first manifest persistence fails', async () => {
    const f = await seed('IMAGE')
    vi.spyOn(manifests, 'writeRecoveryManifest').mockRejectedValue(new Error('first manifest failed'))
    const unlink = vi.spyOn(fs, 'unlink')
    await expect(f.run()).rejects.toThrow('first manifest')
    expect(unlink).not.toHaveBeenCalled()
    expect(await prisma.mediaContentPathWrite.count({ where: { sessionId: f.operationId } })).toBe(0)
    vi.restoreAllMocks()
    await f.run()
  })
})
async function seed(kind: DeletionKind) {
  const directory = `local-imports/fixture/${randomUUID()}`
  await fs.mkdir(path.join(root, directory), { recursive: true })
  const artwork = await prisma.artwork.create({
    data: { title: 'Delete fixture', createdVia: 'LOCAL_DIRECTORY', storagePath: directory }
  })
  artworkIds.push(artwork.id)
  const image = await prisma.image.create({
    data: {
      artworkId: artwork.id,
      path: `/${directory}/video.mp4`,
      size: 5n,
      mediaType: 'VIDEO',
      chaptersPath: `/${directory}/video.chapters.json`,
      chaptersHash: 'fixture',
      chaptersCount: 1
    }
  })
  const media = path.join(root, directory, 'video.mp4')
  const chapter = path.join(root, directory, 'video.chapters.json')
  await fs.writeFile(media, 'media')
  await fs.writeFile(chapter, 'chapters')
  const preview = () =>
    kind === 'ARTWORK' ? previewDeleteArtwork(artwork.id, userId) : previewDeleteImage(image.id, kind, userId)
  const initial = await preview()
  const operationId = initial.operationId!
  const selectedPaths =
    kind === 'ARTWORK'
      ? (initial as Awaited<ReturnType<typeof previewDeleteArtwork>>).entries
          .filter((entry) => ['REQUIRED', 'OPTIONAL'].includes(entry.selection))
          .map((entry) => entry.path)
      : []
  const run = async () => {
    if (kind === 'ARTWORK') {
      const report = await deleteArtwork(
        { artworkId: artwork.id, operationId, selectedPaths },
        { requestedByUserId: userId }
      )
      if (report.outcome !== 'COMPLETED') throw new Error(`Artwork incomplete: ${report.warnings.join(' ')}`)
      return report
    }
    const confirmation = initial as Awaited<ReturnType<typeof previewDeleteImage>>
    if (kind === 'IMAGE') return deleteImage(image.id, true, userId, confirmation)
    return clearChaptersForImage({ imageId: image.id, deleteFile: true, userId, ...confirmation })
  }
  return { artwork, image, directory, media, chapter, preview, run, operationId }
}
function failUnlink(target: string) {
  const unlink = fs.unlink.bind(fs)
  vi.spyOn(fs, 'unlink').mockImplementation(async (file) => {
    if (String(file) === target) throw Object.assign(new Error('fixture unlink'), { code: 'EACCES' })
    return unlink(file)
  })
}
function failBusinessWrite() {
  const transaction = prisma.$transaction.bind(prisma)
  vi.spyOn(prisma, '$transaction').mockImplementation(((callback: any, options: any) =>
    transaction(
      (tx) =>
        callback(
          new Proxy(tx, {
            get(target, property) {
              if (property !== 'image') return Reflect.get(target, property)
              return new Proxy(target.image, {
                get(model, method) {
                  if (['delete', 'deleteMany', 'update'].includes(String(method))) {
                    return async () => {
                      throw new Error('fixture database publication failed')
                    }
                  }
                  return Reflect.get(model, method)
                }
              })
            }
          })
        ),
      options
    )) as typeof prisma.$transaction)
}
