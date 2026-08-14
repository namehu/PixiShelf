import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createChapterManifestHash, type VideoChapterManifest } from '../chapter-manifest.js'
import { generateVideoChapterPreviews } from '../chapter-preview.js'
import type { VideoProcessingDatabase, VideoProcessingTransaction } from '../types.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(removeTestRoot))
})

describe('chapter preview central executor core', () => {
  it('uses bounded pages for INCREMENTAL mode', async () => {
    const root = await createRoot()
    const manifest = chapterManifest()
    const hash = createChapterManifestHash(manifest)
    await Promise.all([
      writeManifestAndPreview(root, 1, 'one.json', manifest, hash),
      writeManifestAndPreview(root, 2, 'two.json', manifest, hash)
    ])
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([video(1, 'one.json', hash)])
      .mockResolvedValueOnce([video(2, 'two.json', hash)])
      .mockResolvedValueOnce([])
    const transaction = transactionMock()
    const database = { image: { findMany } } as unknown as VideoProcessingDatabase

    const result = await generateVideoChapterPreviews({
      jobId: 'chapter-job',
      attempt: 1,
      mode: 'INCREMENTAL',
      database,
      config: { scanRoot: root.scan, chapterPreviewRoot: root.previews, ffmpegThreads: 1, chapterPageSize: 1 },
      processRunner: vi.fn(),
      signal: new AbortController().signal,
      progress: vi.fn(),
      mutate: (operation) => operation(transaction)
    })

    expect(result.failed).toBe(0)
    expect(result.reused).toBe(2)
    expect(findMany).toHaveBeenCalledTimes(3)
    expect(findMany.mock.calls.every(([query]) => query.take === 1)).toBe(true)
    expect(findMany.mock.calls.every(([query]) => query.select.chapterPreviews.take === 1_001)).toBe(true)
  })

  it('turns FULL-mode stale references into GC intents without scanning directories', async () => {
    const root = await createRoot()
    const gcUpsert = vi.fn().mockResolvedValue({})
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 })
    const database = {
      image: { findMany: vi.fn().mockResolvedValue([]) },
      mediaChapterPreview: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([{ id: 'preview-1', previewPath: '1/old/0.webp' }])
          .mockResolvedValueOnce([])
      }
    } as unknown as VideoProcessingDatabase
    const transaction = transactionMock({ gcUpsert, deleteMany })

    const result = await generateVideoChapterPreviews({
      jobId: 'chapter-job',
      attempt: 1,
      mode: 'FULL',
      database,
      config: { scanRoot: root.scan, chapterPreviewRoot: root.previews, ffmpegThreads: 1 },
      processRunner: vi.fn(),
      signal: new AbortController().signal,
      progress: vi.fn(),
      mutate: (operation) => operation(transaction)
    })

    expect(result).toMatchObject({ gcEntriesCreated: 1, orphanedFilesDeleted: 0, deferredCleanup: true })
    expect(gcUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ relativePath: '1/old/0.webp', reason: 'CHAPTER_MANIFEST_REMOVED' })
      })
    )
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['preview-1'] } } })
  })

  it('does not skip a matching manifest when the expected WebP is missing', async () => {
    const root = await createRoot()
    const manifest = chapterManifest()
    const hash = createChapterManifestHash(manifest)
    await fs.writeFile(path.join(root.scan, 'one.json'), JSON.stringify(manifest))
    await fs.writeFile(path.join(root.scan, '1.mp4'), 'source-video')
    const database = {
      image: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([video(1, 'one.json', hash)])
          .mockResolvedValueOnce([])
      }
    } as unknown as VideoProcessingDatabase
    const transaction = transactionMock()
    const processRunner = vi.fn(async (request: { args: readonly string[] }) => {
      const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } })
        .webp()
        .toBuffer()
      await fs.writeFile(request.args.at(-1)!, webp)
      return { stdout: '', stderr: '' }
    })
    const percentages: number[] = []

    const result = await generateVideoChapterPreviews({
      jobId: 'chapter-job',
      systemJobId: 'chapter-job',
      attempt: 2,
      mode: 'INCREMENTAL',
      database,
      config: { scanRoot: root.scan, chapterPreviewRoot: root.previews, ffmpegThreads: 1 },
      processRunner,
      signal: new AbortController().signal,
      progress: async (update) => {
        percentages.push(update.percentage)
      },
      mutate: (operation) => operation(transaction)
    })

    expect(result.generated).toBe(1)
    expect(processRunner).toHaveBeenCalledOnce()
    expect(processRunner.mock.calls[0]![0].args.at(-1)).toMatch(/\.tmp\.webp$/)
    expect(percentages.every((value, index) => index === 0 || value >= percentages[index - 1]!)).toBe(true)
  })

  it('does not skip when a completed row points at a non-canonical preview path', async () => {
    const root = await createRoot()
    const manifest = chapterManifest()
    const hash = createChapterManifestHash(manifest)
    await writeManifestAndPreview(root, 1, 'one.json', manifest, hash)
    await fs.writeFile(path.join(root.scan, '1.mp4'), 'source-video')
    const record = video(1, 'one.json', hash)
    record.chapterPreviews[0]!.previewPath = '1/wrong-hash/0.webp'
    const database = {
      image: { findMany: vi.fn().mockResolvedValueOnce([record]).mockResolvedValueOnce([]) }
    } as unknown as VideoProcessingDatabase
    const transaction = transactionMock()
    const processRunner = successfulChapterRunner()

    const result = await generateVideoChapterPreviews({
      jobId: 'chapter-job',
      attempt: 1,
      mode: 'INCREMENTAL',
      database,
      config: { scanRoot: root.scan, chapterPreviewRoot: root.previews, ffmpegThreads: 1 },
      processRunner,
      signal: new AbortController().signal,
      progress: vi.fn(),
      mutate: (operation) => operation(transaction)
    })

    expect(result.generated).toBe(1)
    expect(processRunner).toHaveBeenCalledOnce()
  })

  it('does not whole-video skip when an extra chapter preview row must be reconciled', async () => {
    const root = await createRoot()
    const manifest = chapterManifest()
    const hash = createChapterManifestHash(manifest)
    await writeManifestAndPreview(root, 1, 'one.json', manifest, hash)
    const record = video(1, 'one.json', hash)
    record.chapterPreviews.push({
      id: 'preview-extra',
      chapterOrder: 1,
      chapterIndex: 2,
      chaptersHash: hash,
      status: 'COMPLETED',
      previewPath: `1/${hash}/1.webp`
    })
    const database = {
      image: { findMany: vi.fn().mockResolvedValueOnce([record]).mockResolvedValueOnce([]) }
    } as unknown as VideoProcessingDatabase
    const transaction = transactionMock()
    const processRunner = vi.fn()

    const result = await generateVideoChapterPreviews({
      jobId: 'chapter-job',
      attempt: 1,
      mode: 'INCREMENTAL',
      database,
      config: { scanRoot: root.scan, chapterPreviewRoot: root.previews, ffmpegThreads: 1 },
      processRunner,
      signal: new AbortController().signal,
      progress: vi.fn(),
      mutate: (operation) => operation(transaction)
    })

    expect(result.reused).toBe(1)
    expect(processRunner).not.toHaveBeenCalled()
    expect(transaction.mediaChapterPreview.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ['preview-extra'] } }
    })
  })

  it('restores the previous preview when fenced database publication fails', async () => {
    const root = await createRoot()
    const manifest = chapterManifest()
    const hash = createChapterManifestHash(manifest)
    await fs.writeFile(path.join(root.scan, 'one.json'), JSON.stringify(manifest))
    await fs.writeFile(path.join(root.scan, '1.mp4'), 'source-video')
    const expectedPath = path.join(root.previews, '1', hash, '0.webp')
    await fs.mkdir(path.dirname(expectedPath), { recursive: true })
    const oldWebp = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } })
      .webp()
      .toBuffer()
    await fs.writeFile(expectedPath, oldWebp)
    const original = await fs.readFile(expectedPath)
    const database = {
      image: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([video(1, 'one.json', hash, 'FAILED')])
          .mockResolvedValueOnce([])
      },
      mediaChapterPreview: { findMany: vi.fn().mockResolvedValue([]) }
    } as unknown as VideoProcessingDatabase
    const transaction = transactionMock()
    vi.mocked(transaction.mediaChapterPreview.update)
      .mockRejectedValueOnce(new Error('database publication failed'))
      .mockResolvedValueOnce({ id: 'preview-1' } as never)
    const processRunner = vi.fn(async (request: { args: readonly string[] }) => {
      const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } })
        .webp()
        .toBuffer()
      await fs.writeFile(request.args.at(-1)!, webp)
      return { stdout: '', stderr: '' }
    })

    const result = await generateVideoChapterPreviews({
      jobId: 'chapter-job',
      systemJobId: 'chapter-job',
      attempt: 2,
      mode: 'FULL',
      database,
      config: { scanRoot: root.scan, chapterPreviewRoot: root.previews, ffmpegThreads: 1 },
      processRunner,
      signal: new AbortController().signal,
      progress: vi.fn(),
      mutate: (operation) => operation(transaction)
    })

    expect(result.failed).toBe(1)
    expect(await fs.readFile(expectedPath)).toEqual(original)
    await expect(fs.access(`${expectedPath}.job-chapter-job-a2.backup.webp`)).rejects.toThrow()
  })

  it('restores the previous preview when the fenced mutation final recheck fails after its callback', async () => {
    const root = await createRoot()
    const manifest = chapterManifest()
    const hash = createChapterManifestHash(manifest)
    await fs.writeFile(path.join(root.scan, 'one.json'), JSON.stringify(manifest))
    await fs.writeFile(path.join(root.scan, '1.mp4'), 'source-video')
    const expectedPath = path.join(root.previews, '1', hash, '0.webp')
    await fs.mkdir(path.dirname(expectedPath), { recursive: true })
    const previous = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ff0000' } })
      .webp()
      .toBuffer()
    await fs.writeFile(expectedPath, previous)
    const transaction = transactionMock()
    const database = {
      image: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([video(1, 'one.json', hash, 'FAILED')])
          .mockResolvedValueOnce([])
      },
      mediaChapterPreview: { findMany: vi.fn().mockResolvedValue([]) }
    } as unknown as VideoProcessingDatabase
    let mutationCalls = 0

    const result = await generateVideoChapterPreviews({
      jobId: 'chapter-job',
      attempt: 2,
      mode: 'FULL',
      database,
      config: { scanRoot: root.scan, chapterPreviewRoot: root.previews, ffmpegThreads: 1 },
      processRunner: successfulChapterRunner(),
      signal: new AbortController().signal,
      progress: vi.fn(),
      mutate: async (operation) => {
        mutationCalls += 1
        const value = await operation(transaction)
        if (mutationCalls === 3) throw new Error('lease expired during mutation final recheck')
        return value
      }
    })

    expect(result.failed).toBe(1)
    expect(await fs.readFile(expectedPath)).toEqual(previous)
  })
})

function successfulChapterRunner() {
  return vi.fn(async (request: { args: readonly string[] }) => {
    const webp = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#ffffff' } })
      .webp()
      .toBuffer()
    await fs.writeFile(request.args.at(-1)!, webp)
    return { stdout: '', stderr: '' }
  })
}

function video(id: number, chaptersPath: string, hash: string, status = 'COMPLETED') {
  return {
    id,
    path: `${id}.mp4`,
    chaptersPath,
    chapterPreviews: [
      {
        id: `preview-${id}`,
        chapterOrder: 0,
        chapterIndex: 1,
        chaptersHash: hash,
        status,
        previewPath: `${id}/${hash}/0.webp`
      }
    ]
  }
}

function chapterManifest(): VideoChapterManifest {
  return {
    version: 1,
    duration: 4,
    chapters: [{ index: 1, title: 'Chapter 1', start: 0, end: 4, duration: 4 }]
  }
}

async function writeManifestAndPreview(
  root: Awaited<ReturnType<typeof createRoot>>,
  imageId: number,
  manifestPath: string,
  manifest: VideoChapterManifest,
  hash: string
) {
  await fs.writeFile(path.join(root.scan, manifestPath), JSON.stringify(manifest))
  const preview = path.join(root.previews, String(imageId), hash, '0.webp')
  await fs.mkdir(path.dirname(preview), { recursive: true })
  const webp = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#ffffff' } })
    .webp()
    .toBuffer()
  await fs.writeFile(preview, webp)
}

function transactionMock(input: { gcUpsert?: ReturnType<typeof vi.fn>; deleteMany?: ReturnType<typeof vi.fn> } = {}) {
  return {
    image: { update: vi.fn().mockResolvedValue({}) },
    mediaChapterPreview: {
      upsert: vi.fn().mockResolvedValue({ id: 'preview' }),
      update: vi.fn().mockResolvedValue({ id: 'preview' }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      deleteMany: input.deleteMany ?? vi.fn().mockResolvedValue({ count: 0 })
    },
    derivedMediaGcEntry: { upsert: input.gcUpsert ?? vi.fn().mockResolvedValue({}) }
  } as unknown as VideoProcessingTransaction
}

async function createRoot() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-chapter-'))
  temporaryRoots.push(base)
  const scan = path.join(base, 'scan')
  const previews = path.join(base, 'previews')
  await Promise.all([fs.mkdir(scan), fs.mkdir(previews)])
  return { scan, previews }
}

async function removeTestRoot(root: string) {
  let lastError: unknown
  for (const delay of [0, 50, 100, 250, 500, 1_000]) {
    if (delay > 0) await new Promise<void>((resolve) => setTimeout(resolve, delay))
    try {
      await fs.rm(root, { recursive: true, force: true })
      return
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
