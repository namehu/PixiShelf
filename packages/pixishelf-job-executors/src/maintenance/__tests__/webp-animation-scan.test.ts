import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ANIMATION_INITIALIZE_BATCH_SIZE,
  ANIMATION_SCAN_BATCH_SIZE,
  scanWebpAnimations,
  WebpAnimationScanConfigurationError
} from '../webp-animation-scan.js'
import type { RunMaintenanceMutation } from '../types.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('webp animation scan maintenance', () => {
  it('wraps an unavailable scan root without exposing its absolute path', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'pixishelf-private-scan-root-'))
    roots.push(parent)
    const unavailableRoot = path.join(parent, 'does-not-exist')

    const failure = scanWebpAnimations({
      database: {} as never,
      mutate: vi.fn() as never,
      signal: new AbortController().signal,
      progress: vi.fn(),
      scanRoot: unavailableRoot
    })

    await expect(failure).rejects.toBeInstanceOf(WebpAnimationScanConfigurationError)
    await expect(failure).rejects.toMatchObject({
      code: 'SCAN_ROOT_UNAVAILABLE',
      message: 'Configured animation scan root is unavailable'
    })
    await failure.catch((error: Error) => {
      expect(error.message).not.toContain(unavailableRoot)
    })
  })

  it('initializes and processes bounded pages with fenced idempotent status writes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-animation-'))
    roots.push(root)
    await mkdir(path.join(root, 'images'), { recursive: true })
    await writeFile(path.join(root, 'images', 'one.webp'), 'fixture')
    await writeFile(path.join(root, 'images', 'two.gif'), 'fixture')
    let initializeRead = false
    let scanRead = false
    const findMany = vi.fn(async ({ where }: { where: { webpAnimationStatus: number | null } }) => {
      if (where.webpAnimationStatus === null) {
        if (initializeRead) return []
        initializeRead = true
        return [{ id: 1 }, { id: 2 }]
      }
      if (scanRead) return []
      scanRead = true
      return [
        { id: 1, path: 'images/one.webp' },
        { id: 2, path: 'images/two.gif' }
      ]
    })
    const updateMany = vi.fn(async ({ where }: { where: { id: { in: number[] } } }) => ({ count: where.id.in.length }))
    const result = await scanWebpAnimations({
      database: {
        image: { findMany, count: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0) }
      } as never,
      mutate: (async (operation) => operation({ image: { updateMany } } as never)) satisfies RunMaintenanceMutation,
      signal: new AbortController().signal,
      progress: vi.fn(),
      scanRoot: root,
      detectAnimated: vi.fn(async (_absolutePath, mediaPath) => mediaPath.endsWith('.gif'))
    })

    expect(result).toMatchObject({ initialized: 2, processed: 2, animated: 1, static: 1, remainingPending: 0 })
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: ANIMATION_INITIALIZE_BATCH_SIZE }))
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ take: ANIMATION_SCAN_BATCH_SIZE }))
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ webpAnimationStatus: 0 }) })
    )
  })

  it('does not commit a detected batch after cancellation wins', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-animation-'))
    roots.push(root)
    await writeFile(path.join(root, 'one.webp'), 'fixture')
    const controller = new AbortController()
    let initializeReads = 0
    let scanReads = 0
    const findMany = vi.fn(async ({ where }: { where: { webpAnimationStatus: number | null } }) => {
      if (where.webpAnimationStatus === null) return initializeReads++ === 0 ? [] : []
      return scanReads++ === 0 ? [{ id: 1, path: 'one.webp' }] : []
    })
    const updateMany = vi.fn()
    await expect(
      scanWebpAnimations({
        database: { image: { findMany, count: vi.fn().mockResolvedValue(1) } } as never,
        mutate: (async (operation) => operation({ image: { updateMany } } as never)) satisfies RunMaintenanceMutation,
        signal: controller.signal,
        progress: vi.fn(),
        scanRoot: root,
        detectAnimated: vi.fn(async () => {
          controller.abort(new Error('cancel requested'))
          return true
        })
      })
    ).rejects.toThrow('cancel requested')
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('reports stable failure codes without leaking absolute paths or raw filesystem errors', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-animation-private-'))
    roots.push(root)
    await writeFile(path.join(root, 'broken.webp'), 'fixture')
    let initialized = false
    let scanned = false
    const findMany = vi.fn(async ({ where }: { where: { webpAnimationStatus: number | null } }) => {
      if (where.webpAnimationStatus === null) {
        if (initialized) return []
        initialized = true
        return []
      }
      if (scanned) return []
      scanned = true
      return [
        { id: 7, path: 'broken.webp' },
        { id: 8, path: 'C:\\private\\scan-root\\broken.webp' }
      ]
    })

    const result = await scanWebpAnimations({
      database: {
        image: { findMany, count: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(2) }
      } as never,
      mutate: vi.fn() as never,
      signal: new AbortController().signal,
      progress: vi.fn(),
      scanRoot: root,
      detectAnimated: vi.fn(async () => {
        throw new Error(`decoder exposed ${root}/broken.webp and secret token`)
      })
    })

    expect(result.failedSamples).toEqual([
      {
        id: 7,
        path: 'broken.webp',
        errorCode: 'ANIMATION_PROBE_FAILED',
        error: 'Animation detection failed'
      },
      {
        id: 8,
        path: 'image:8',
        errorCode: expect.any(String),
        error: expect.any(String)
      }
    ])
    expect(JSON.stringify(result.failedSamples)).not.toContain(root)
    expect(JSON.stringify(result.failedSamples)).not.toContain('private/scan-root')
    expect(JSON.stringify(result.failedSamples)).not.toContain('secret token')
  })
})
