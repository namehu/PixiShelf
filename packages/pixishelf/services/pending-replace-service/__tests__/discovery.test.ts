import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import {
  createManifestFingerprint,
  preparePendingReplaceBinding,
  previewPendingReplacements,
  scanPendingReplaceDirectory
} from '../discovery'
import { PENDING_REPLACE_DIRECTORY } from '@/schemas/pending-replace.dto'

const mocks = vi.hoisted(() => ({
  artworkFindMany: vi.fn(),
  artworkFindUnique: vi.fn(),
  batchCreate: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    artwork: {
      findMany: mocks.artworkFindMany,
      findUnique: mocks.artworkFindUnique
    },
    pendingReplaceBatch: { create: mocks.batchCreate }
  }
}))

const temporaryDirectories: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  mocks.artworkFindMany.mockResolvedValue([])
  mocks.artworkFindUnique.mockResolvedValue(null)
  mocks.batchCreate.mockImplementation(async ({ data }: any) => ({
    id: 'batch-1',
    ...data,
    items: data.items.create,
    systemJob: null
  }))
})

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('scanPendingReplaceDirectory', () => {
  it('naturally orders direct media and builds canonical target names', async () => {
    const scanPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-pending-replace-'))
    temporaryDirectories.push(scanPath)
    const pendingRoot = path.join(scanPath, PENDING_REPLACE_DIRECTORY)
    const sourceDirectoryName = 'work__ext-local_42'
    const sourceDirectory = path.join(pendingRoot, sourceDirectoryName)
    await fs.mkdir(path.join(sourceDirectory, 'nested'), { recursive: true })
    await fs.writeFile(path.join(sourceDirectory, 'page10.jpg'), 'ten')
    await fs.writeFile(path.join(sourceDirectory, 'page2.jpg'), 'two')
    await fs.writeFile(path.join(sourceDirectory, 'notes.txt'), 'ignored')

    const result = await scanPendingReplaceDirectory({
      scanPath,
      pendingRoot,
      sourceDirectoryName,
      externalId: 'local_42'
    })

    expect(result.media.map((media) => [media.sourceName, media.targetName])).toEqual([
      ['page2.jpg', 'local_42_p0.jpg'],
      ['page10.jpg', 'local_42_p1.jpg']
    ])
    expect(result.warnings).toContain('已忽略子目录: nested')
    expect(result.warnings).toContain('已忽略非媒体文件: notes.txt')
  })

  it('associates a chapter manifest with its video target name', async () => {
    const scanPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-pending-replace-'))
    temporaryDirectories.push(scanPath)
    const pendingRoot = path.join(scanPath, PENDING_REPLACE_DIRECTORY)
    const sourceDirectoryName = 'video__ext-77'
    const sourceDirectory = path.join(pendingRoot, sourceDirectoryName)
    await fs.mkdir(sourceDirectory, { recursive: true })
    await fs.writeFile(path.join(sourceDirectory, 'clip.mp4'), 'video')
    await fs.writeFile(path.join(sourceDirectory, 'clip.chapters.json'), '{}')

    const result = await scanPendingReplaceDirectory({
      scanPath,
      pendingRoot,
      sourceDirectoryName,
      externalId: '77'
    })

    expect(result.manifest.find((file) => file.kind === 'chapter')).toMatchObject({
      name: 'clip.chapters.json',
      relatedMediaName: 'clip.mp4',
      targetName: '77_p0.chapters.json'
    })
  })

  it('rejects reserved manifests and duplicate chapter candidates before execution', async () => {
    const scanPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-pending-replace-'))
    temporaryDirectories.push(scanPath)
    const pendingRoot = path.join(scanPath, PENDING_REPLACE_DIRECTORY)
    const sourceDirectoryName = 'video__ext-77'
    const sourceDirectory = path.join(pendingRoot, sourceDirectoryName)
    await fs.mkdir(sourceDirectory, { recursive: true })
    await fs.writeFile(path.join(sourceDirectory, 'clip.mp4'), 'video')
    await fs.writeFile(path.join(sourceDirectory, 'replace-manifest.json'), '{}')

    await expect(
      scanPendingReplaceDirectory({ scanPath, pendingRoot, sourceDirectoryName, externalId: '77' })
    ).rejects.toThrow('系统保留文件名')

    await fs.rm(path.join(sourceDirectory, 'replace-manifest.json'))
    await fs.writeFile(path.join(sourceDirectory, 'clip.chapters.json'), '{}')
    await fs.writeFile(path.join(sourceDirectory, 'clip.mp4.chapters.json'), '{}')
    await expect(
      scanPendingReplaceDirectory({ scanPath, pendingRoot, sourceDirectoryName, externalId: '77' })
    ).rejects.toThrow('多个章节清单候选')
  })
})

describe('previewPendingReplacements', () => {
  it('scans an unmarked source directory so it can be visually paired later', async () => {
    const scanPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-pending-replace-preview-'))
    temporaryDirectories.push(scanPath)
    const sourceDirectory = path.join(scanPath, PENDING_REPLACE_DIRECTORY, 'original-folder-name')
    await fs.mkdir(sourceDirectory, { recursive: true })
    await fs.writeFile(path.join(sourceDirectory, 'cover.jpg'), 'image')

    const batch = await previewPendingReplacements(scanPath)
    const item = batch.items[0]

    expect(item).toMatchObject({
      sourceDirectoryName: 'original-folder-name',
      artworkId: null,
      status: 'INVALID',
      included: false
    })
    expect(item!.newMediaSnapshot).toHaveLength(1)
    expect(item!.error).toContain('尚未绑定作品')
  })
})

describe('preparePendingReplaceBinding', () => {
  it('retargets source media and freezes the selected artwork when binding', async () => {
    const scanPath = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-pending-replace-bind-'))
    temporaryDirectories.push(scanPath)
    const sourceDirectoryName = 'original-folder-name'
    const sourceDirectory = path.join(scanPath, PENDING_REPLACE_DIRECTORY, sourceDirectoryName)
    const targetDirectory = path.join(scanPath, 'artist', 'work')
    await fs.mkdir(sourceDirectory, { recursive: true })
    await fs.mkdir(targetDirectory, { recursive: true })
    await fs.writeFile(path.join(sourceDirectory, 'new.jpg'), 'new')
    await fs.writeFile(path.join(targetDirectory, 'old.jpg'), 'old')
    mocks.artworkFindUnique.mockResolvedValue({
      id: 42,
      externalId: 'external-42',
      title: 'Target artwork',
      storagePath: '/artist/work',
      artist: { name: 'Artist', userId: 'artist' },
      images: [
        {
          path: '/artist/work/old.jpg',
          sortOrder: 0,
          width: 1,
          height: 1,
          size: BigInt(3),
          mediaType: 'IMAGE',
          chaptersPath: null
        }
      ]
    })

    const result = await preparePendingReplaceBinding({
      scanPath,
      sourceDirectoryName,
      artworkId: 42
    })

    expect(result).toMatchObject({
      artworkId: 42,
      externalId: 'external-42',
      targetDirectory: '/artist/work'
    })
    expect(result.newMediaSnapshot[0]).toMatchObject({
      sourceName: 'new.jpg',
      targetName: 'external-42_p0.jpg'
    })
    expect(result.oldMediaSnapshot[0]).toMatchObject({ path: '/artist/work/old.jpg' })
    expect(result.targetFileSnapshot[0]).toMatchObject({ name: 'old.jpg', size: 3 })
  })
})

describe('createManifestFingerprint', () => {
  it('tracks source identity without depending on target names', () => {
    const first = createManifestFingerprint([
      { name: 'a.jpg', size: 10, mtimeMs: 20, kind: 'media', targetName: 'one.jpg' }
    ])
    const renamedTarget = createManifestFingerprint([
      { name: 'a.jpg', size: 10, mtimeMs: 20, kind: 'media', targetName: 'two.jpg' }
    ])
    const changedSource = createManifestFingerprint([
      { name: 'a.jpg', size: 11, mtimeMs: 20, kind: 'media', targetName: 'one.jpg' }
    ])

    expect(renamedTarget).toBe(first)
    expect(changedSource).not.toBe(first)
  })
})
