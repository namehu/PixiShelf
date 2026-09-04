import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ANIMATION_INITIALIZE_BATCH_SIZE,
  ANIMATION_SCAN_BATCH_SIZE,
  ANIMATION_SCAN_SHARP_TIMEOUT_SECONDS,
  detectAnimatedImage,
  scanWebpAnimations,
  WebpAnimationScanConfigurationError
} from '../webp-animation-scan.js'
import { IsolatedSharpAnimationProbePool } from '../sharp-animation-probe-pool.js'
import type { RunMaintenanceMutation } from '../types.js'

const roots: string[] = []
const STATIC_GIF = Buffer.from(
  '47494638396101000100800000000000ffffff21f904000a0000002c00000000010001000002024401003b',
  'hex'
)
const ANIMATED_GIF = Buffer.from(
  '47494638396101000100800000000000ffffff21f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b',
  'hex'
)
const ANIMATED_WEBP = Buffer.from(
  'UklGRpQAAABXRUJQVlA4WAoAAAACAAAAAAAAAAAAQU5JTQYAAAD/////AABBTk1GMAAAAAAAAAAAAAAAAAAAAGQAAAJWUDggGAAAADABAJ0BKgEAAQABQCYlpAADcAD+/TZoAEFOTUYwAAAAAAAAAAAAAAAAAAAAZAAAAFZQOCAYAAAANAEAnQEqAQABAAAAJiWkAANwAP789AAA',
  'base64'
)

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  vi.clearAllMocks()
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
        image: { findMany, count: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(2).mockResolvedValueOnce(0) }
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

  it('aborts every in-flight probe and drains the pool before returning cancellation', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-animation-cancel-'))
    roots.push(root)
    const images = Array.from({ length: 3 }, (_, index) => ({ id: index + 1, path: `${index + 1}.webp` }))
    await Promise.all(images.map((image) => writeFile(path.join(root, image.path), 'fixture')))
    const controller = new AbortController()
    let scanRead = false
    let active = 0
    let drained = 0
    let announceStarted!: () => void
    const allStarted = new Promise<void>((resolve) => {
      announceStarted = resolve
    })
    const updateMany = vi.fn()
    const execution = scanWebpAnimations({
      database: {
        image: {
          count: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(3),
          findMany: vi.fn(async ({ where }: { where: { webpAnimationStatus: number | null } }) => {
            if (where.webpAnimationStatus === null) return []
            if (scanRead) return []
            scanRead = true
            return images
          })
        }
      } as never,
      mutate: (async (operation) => operation({ image: { updateMany } } as never)) satisfies RunMaintenanceMutation,
      signal: controller.signal,
      progress: vi.fn(),
      scanRoot: root,
      concurrency: 3,
      detectAnimated: vi.fn(async (_absolutePath, mediaPath, signal) => {
        active += 1
        if (active === 3) announceStarted()
        return await new Promise<boolean>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              setTimeout(
                () => {
                  active -= 1
                  drained += 1
                  reject(signal.reason)
                },
                Number.parseInt(mediaPath, 10) * 4
              )
            },
            { once: true }
          )
        })
      })
    })

    await allStarted
    controller.abort(new Error('cancel all probes'))
    await expect(execution).rejects.toThrow('cancel all probes')
    expect({ active, drained }).toEqual({ active: 0, drained: 3 })
    expect(updateMany).not.toHaveBeenCalled()
  })

  it('classifies real Sharp GIF/WebP fixtures through the isolated native pipeline', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-sharp-fixtures-'))
    roots.push(root)
    const staticGif = path.join(root, 'static.gif')
    const animatedGif = path.join(root, 'animated.gif')
    const animatedWebp = path.join(root, 'animated.webp')
    await Promise.all([
      writeFile(staticGif, STATIC_GIF),
      writeFile(animatedGif, ANIMATED_GIF),
      writeFile(animatedWebp, ANIMATED_WEBP)
    ])

    expect(ANIMATION_SCAN_SHARP_TIMEOUT_SECONDS).toBe(60)
    await expect(detectAnimatedImage(staticGif)).resolves.toBe(false)
    await expect(detectAnimatedImage(animatedGif)).resolves.toBe(true)
    await expect(detectAnimatedImage(animatedWebp)).resolves.toBe(true)
  })

  it('kills and drains an isolated probe process when cancellation fires', async () => {
    const pool = new IsolatedSharpAnimationProbePool({
      size: 1,
      hardTimeoutMs: 5_000,
      childSource: `
        process.on('disconnect', () => process.exit(0))
        process.on('message', () => undefined)
      `
    })
    const controller = new AbortController()
    try {
      const detection = pool.detect('/private/fixture.webp', controller.signal)
      await new Promise((resolve) => setTimeout(resolve, 25))
      controller.abort(new Error('probe cancelled'))
      await expect(detection).rejects.toThrow('probe cancelled')
    } finally {
      await pool.close()
    }
  })

  it('hard-kills a native probe process that does not respond before its deadline', async () => {
    const pool = new IsolatedSharpAnimationProbePool({
      size: 1,
      timeoutSeconds: ANIMATION_SCAN_SHARP_TIMEOUT_SECONDS,
      hardTimeoutMs: 25,
      childSource: `
        process.on('disconnect', () => process.exit(0))
        process.on('message', () => undefined)
      `
    })
    try {
      await expect(pool.detect('/private/fixture.webp', new AbortController().signal)).rejects.toMatchObject({
        name: 'SharpAnimationProbeTimeoutError',
        message: `Sharp animation probe exceeded ${ANIMATION_SCAN_SHARP_TIMEOUT_SECONDS} seconds`
      })
    } finally {
      await pool.close()
    }
  })

  it('settles detection and close when spawning the probe process fails before exit', async () => {
    const spawnFailure = Object.assign(new Error('spawn unavailable'), { code: 'ENOENT' })
    const child = createFakeChild({
      onSend: (_message, fake) => {
        queueMicrotask(() => {
          fake.setExitCode(-2)
          fake.process.emit('error', spawnFailure)
          fake.process.emit('close', -2, null)
        })
      },
      onKill: () => false
    })
    const pool = new IsolatedSharpAnimationProbePool({
      size: 1,
      spawnProcess: () => child.process
    })

    await expect(pool.detect('/private/fixture.webp', new AbortController().signal)).rejects.toMatchObject({
      code: 'ENOENT'
    })
    await expect(pool.close()).resolves.toBeUndefined()
  })

  it('keeps cancellation authoritative over an already queued probe result', async () => {
    const controller = new AbortController()
    const child = createFakeChild({
      onSend: (message, fake) => {
        queueMicrotask(() => {
          controller.abort(new Error('lease lost'))
          fake.process.emit('message', { type: 'result', id: (message as { id: number }).id, ok: true, pages: 2 })
          queueMicrotask(() => {
            fake.setSignalCode('SIGKILL')
            fake.process.emit('close', null, 'SIGKILL')
          })
        })
      },
      onKill: () => true
    })
    const pool = new IsolatedSharpAnimationProbePool({
      size: 1,
      spawnProcess: () => child.process
    })
    try {
      await expect(pool.detect('/private/fixture.webp', controller.signal)).rejects.toThrow('lease lost')
    } finally {
      await pool.close()
    }
  })

  it('rejects a symlink that resolves outside the configured scan root', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-animation-root-'))
    const outside = await mkdtemp(path.join(tmpdir(), 'pixishelf-animation-outside-'))
    roots.push(root, outside)
    await writeFile(path.join(outside, 'private.webp'), 'fixture')
    await symlink(path.join(outside, 'private.webp'), path.join(root, 'linked.webp'))
    let scanRead = false
    const detectAnimated = vi.fn()
    const progress = vi.fn()

    const result = await scanWebpAnimations({
      database: {
        image: {
          count: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(1),
          findMany: vi.fn(async ({ where }: { where: { webpAnimationStatus: number | null } }) => {
            if (where.webpAnimationStatus === null) return []
            if (scanRead) return []
            scanRead = true
            return [{ id: 1, path: 'linked.webp' }]
          })
        }
      } as never,
      mutate: vi.fn() as never,
      signal: new AbortController().signal,
      progress,
      scanRoot: root,
      detectAnimated
    })

    expect(result).toMatchObject({ processed: 0, failed: 1, remainingPending: 1 })
    expect(result.failedSamples[0]).toMatchObject({ errorCode: 'PATH_OUTSIDE_SCAN_ROOT' })
    expect(detectAnimated).not.toHaveBeenCalled()
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: 'COMPLETED',
        progressData: expect.objectContaining({ attemptedItems: 1, failedItems: 1, remainingItems: 1 })
      })
    )
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
        image: { findMany, count: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(2).mockResolvedValueOnce(2) }
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

  it('keeps probes inside the configured worker-pool bound and emits aggregate realtime data', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-animation-pool-'))
    roots.push(root)
    const images = Array.from({ length: 8 }, (_, index) => ({ id: index + 1, path: `${index + 1}.webp` }))
    await Promise.all(images.map((image) => writeFile(path.join(root, image.path), 'fixture')))
    let scanRead = false
    let active = 0
    let maximumActive = 0
    const progress = vi.fn()
    const result = await scanWebpAnimations({
      database: {
        image: {
          count: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(8).mockResolvedValueOnce(0),
          findMany: vi.fn(async ({ where }: { where: { webpAnimationStatus: number | null } }) => {
            if (where.webpAnimationStatus === null) return []
            if (scanRead) return []
            scanRead = true
            return images
          })
        }
      } as never,
      mutate: (async (operation) =>
        operation({
          image: { updateMany: vi.fn(async () => ({ count: 4 })) }
        } as never)) satisfies RunMaintenanceMutation,
      signal: new AbortController().signal,
      progress,
      scanRoot: root,
      concurrency: 3,
      detectAnimated: vi.fn(async (_absolutePath, mediaPath) => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        await new Promise((resolve) => setTimeout(resolve, 2))
        active -= 1
        return Number.parseInt(mediaPath, 10) % 2 === 0
      })
    })

    expect(maximumActive).toBeGreaterThan(1)
    expect(maximumActive).toBeLessThanOrEqual(3)
    expect(result).toMatchObject({ processed: 8, animated: 4, static: 4 })
    expect(progress).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: 'COMPLETED',
        progressData: expect.objectContaining({
          kind: 'animation-scan',
          attemptedItems: 8,
          activeProbes: 0,
          concurrencyLimit: 3
        })
      })
    )
  })

  it('emits one privacy-safe warning when a probe exceeds the slow-item threshold', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'pixishelf-animation-slow-'))
    roots.push(root)
    await writeFile(path.join(root, 'slow.webp'), 'fixture')
    let scanRead = false
    const progress = vi.fn()

    await scanWebpAnimations({
      database: {
        image: {
          count: vi.fn().mockResolvedValueOnce(0).mockResolvedValueOnce(1).mockResolvedValueOnce(0),
          findMany: vi.fn(async ({ where }: { where: { webpAnimationStatus: number | null } }) => {
            if (where.webpAnimationStatus === null) return []
            if (scanRead) return []
            scanRead = true
            return [{ id: 1, path: 'slow.webp' }]
          })
        }
      } as never,
      mutate: (async (operation) =>
        operation({
          image: { updateMany: vi.fn(async () => ({ count: 1 })) }
        } as never)) satisfies RunMaintenanceMutation,
      signal: new AbortController().signal,
      progress,
      scanRoot: root,
      slowItemThresholdMs: 5,
      detectAnimated: vi.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
        return true
      })
    })

    const warnings = progress.mock.calls.map(([update]) => update).filter((update) => update.level === 'WARN')
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toMatchObject({
      forcePersistence: true,
      data: { level: 'WARN', code: 'SLOW_ANIMATION_PROBE', thresholdSeconds: 0.005 }
    })
    expect(JSON.stringify(warnings)).not.toContain(root)
    expect(JSON.stringify(warnings)).not.toContain('slow.webp')
  })
})

function createFakeChild(options: {
  onSend(message: unknown, child: FakeChild): void
  onKill(signal: NodeJS.Signals): boolean
}): FakeChild {
  const process = new EventEmitter() as ChildProcess
  let exitCode: number | null = null
  let signalCode: NodeJS.Signals | null = null
  const fake: FakeChild = {
    process,
    setExitCode: (value) => {
      exitCode = value
    },
    setSignalCode: (value) => {
      signalCode = value
    }
  }
  Object.defineProperties(process, {
    exitCode: { get: () => exitCode },
    signalCode: { get: () => signalCode },
    send: { value: (message: unknown) => options.onSend(message, fake) },
    kill: { value: (signal: NodeJS.Signals) => options.onKill(signal) }
  })
  return fake
}

interface FakeChild {
  process: ChildProcess
  setExitCode(value: number | null): void
  setSignalCode(value: NodeJS.Signals | null): void
}
