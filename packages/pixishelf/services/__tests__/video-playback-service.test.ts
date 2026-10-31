// @vitest-environment node
import { mkdir, writeFile, rm, stat, symlink } from 'node:fs/promises'
import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({
  root: `/tmp/playback-route-${Math.random().toString(36).slice(2)}`,
  handles: [] as import('node:fs/promises').FileHandle[],
  inspect: vi.fn(),
  matches: vi.fn(),
  find: vi.fn(),
  remove: vi.fn()
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      const handle = await fs.open(...args)
      mocks.handles.push(handle)
      return handle
    }
  }
})
vi.mock('@/lib/prisma', () => ({
  prisma: { mediaVideoPlayback: { findUnique: mocks.find, deleteMany: mocks.remove } }
}))
vi.mock('@pixishelf/job-executors/media-content', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@pixishelf/job-executors/media-content')>()),
  inspectVideoPlaybackSource: mocks.inspect,
  playbackMatchesSource: mocks.matches
}))
vi.mock('@/services/setting.service', () => ({ getScanPath: async () => mocks.root }))
vi.mock('@/services/archive/config', () => ({ requireArchiveStorageRoot: async () => mocks.root }))
vi.mock('@/services/derived-media-storage-paths', () => ({ VIDEO_PLAYBACK_STORAGE_ROOT: mocks.root }))
vi.mock('@/services/background-task', () => ({ enqueueJob: vi.fn() }))
vi.mock('@/services/background-task/media-job-query', () => ({ latestMediaJobs: vi.fn() }))
import { openVideoPlayback, getVideoPlaybackSource } from '../video-playback-service'
import { VideoPlaybackUnavailable } from '@pixishelf/job-executors/media-content'
const generation = '11111111-1111-4111-8111-111111111111'
beforeAll(async () => {
  await mkdir(mocks.root)
  await writeFile(`${mocks.root}/copy.mp4`, '0123456789')
  await writeFile(`${mocks.root}/original.mp4`, 'ORIGINAL')
  await writeFile(`${mocks.root}/cancel.mp4`, Buffer.alloc(2 * 1024 * 1024))
})
afterAll(() => rm(mocks.root, { recursive: true, force: true }))
beforeEach(async () => {
  vi.clearAllMocks()
  mocks.handles = []
  mocks.inspect.mockResolvedValue({
    image: { path: 'original.mp4' },
    version: 'a'.repeat(24),
    file: {
      absolutePath: `${mocks.root}/original.mp4`,
      state: await stat(`${mocks.root}/original.mp4`, { bigint: true }).then((s) => ({
        size: s.size,
        mtimeNs: s.mtimeNs,
        ctimeNs: s.ctimeNs,
        deviceId: s.dev,
        inode: s.ino
      }))
    }
  })
  mocks.matches.mockReturnValue(true)
  mocks.find.mockResolvedValue({ imageId: 1, generationId: generation, relativePath: 'copy.mp4', outputSize: 10n })
  mocks.remove.mockResolvedValue({ count: 1 })
})
afterEach(async () => {
  await vi.waitFor(() => expect(mocks.handles.every((handle) => handle.fd === -1)).toBe(true))
})
describe('playback byte delivery', () => {
  it.each([true, false])('closes the file when the HTTP request aborts (before body=%s)', async (beforeBody) => {
    mocks.find.mockResolvedValue({
      imageId: 1,
      generationId: generation,
      relativePath: 'cancel.mp4',
      outputSize: 2097152n
    })
    const abort = new AbortController()
    if (beforeBody) abort.abort()
    const response = await openVideoPlayback(1, { generation }, null, abort.signal)
    const reader = response.body!.getReader()
    if (!beforeBody) {
      expect((await reader.read()).done).toBe(false)
      abort.abort()
    }
    await expect(reader.read()).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('cancels in-flight reads when the browser switches source or seeks', async () => {
    mocks.find.mockResolvedValue({
      imageId: 1,
      generationId: generation,
      relativePath: 'cancel.mp4',
      outputSize: 2097152n
    })
    for (let attempt = 0; attempt < 10; attempt++) {
      const response = await openVideoPlayback(1, { generation }, null)
      const reader = response.body!.getReader()
      expect((await reader.read()).done).toBe(false)
      const pending = reader.read()
      await reader.cancel()
      await pending
      await expect(reader.closed).resolves.toBeUndefined()
    }
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  it.each([
    ['bytes=2-5', 206, '2345'],
    ['bytes=-3', 206, '789'],
    [null, 200, '0123456789']
  ] as const)('streams range %s', async (range, status, body) => {
    const response = await openVideoPlayback(1, { generation }, range)
    expect(response.status).toBe(status)
    expect(await response.text()).toBe(body)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('accept-ranges')).toBe('bytes')
  })
  it('rejects out-of-range bytes', async () => {
    expect((await openVideoPlayback(1, { generation }, 'bytes=99-')).status).toBe(416)
  })
  it('never changes the bytes behind an old generation URL', async () => {
    mocks.find.mockResolvedValue({ generationId: 'new-generation', relativePath: 'copy.mp4', outputSize: 10n })
    await expect(openVideoPlayback(1, { generation }, 'bytes=2-5')).rejects.toMatchObject({ reason: 'CHANGED' })
  })
  it('retires stale source binding and resolves a versioned original', async () => {
    mocks.matches.mockReturnValue(false)
    expect(await getVideoPlaybackSource(1)).toMatchObject({
      status: 'READY',
      playbackUrl: null,
      originalUrl: `/api/v1/media/1/playback?original=${'a'.repeat(24)}`
    })
    expect(mocks.remove).toHaveBeenCalledWith({ where: { imageId: 1, generationId: generation } })
  })
  it('rejects source write gates without deleting a potentially valid copy', async () => {
    mocks.inspect.mockRejectedValue(new VideoPlaybackUnavailable('WRITING'))
    expect(await getVideoPlaybackSource(1)).toEqual({ status: 'WRITING', originalUrl: null, playbackUrl: null })
    expect(mocks.remove).not.toHaveBeenCalled()
  })
  it('falls back if the output is missing', async () => {
    mocks.find.mockResolvedValue({ generationId: generation, relativePath: 'missing.mp4', outputSize: 10n })
    expect(await getVideoPlaybackSource(1)).toMatchObject({ playbackUrl: null })
    expect(mocks.remove).toHaveBeenCalledOnce()
  })
  it('streams the versioned original and rejects an intervening same-size replacement', async () => {
    const response = await openVideoPlayback(1, { original: 'a'.repeat(24) }, 'bytes=0-3')
    expect(await response.text()).toBe('ORIG')
    await writeFile(`${mocks.root}/original.mp4`, 'REPLACED')
    await expect(openVideoPlayback(1, { original: 'a'.repeat(24) }, null)).rejects.toMatchObject({ reason: 'CHANGED' })
    await writeFile(`${mocks.root}/original.mp4`, 'ORIGINAL')
  })
  it.each(['../escape.mp4', '.hidden/copy.mp4', 'outside-link.mp4'])(
    'refuses unsafe copy path %s and resolves the original',
    async (relativePath) => {
      await mkdir(`${mocks.root}/.hidden`, { recursive: true })
      await writeFile(`${mocks.root}/.hidden/copy.mp4`, '0123456789')
      if (relativePath === 'outside-link.mp4') await symlink('/etc/hosts', `${mocks.root}/outside-link.mp4`)
      mocks.find.mockResolvedValue({ generationId: generation, relativePath, outputSize: 10n })
      expect(await getVideoPlaybackSource(1)).toMatchObject({ status: 'READY', playbackUrl: null })
      expect(mocks.remove).toHaveBeenCalledOnce()
    }
  )
  it('rejects an original URL after a source version change', async () => {
    await expect(openVideoPlayback(1, { original: 'old-version' }, null)).rejects.toMatchObject({ reason: 'CHANGED' })
  })
})
