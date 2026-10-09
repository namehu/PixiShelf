import { test, expect, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import sharp from 'sharp'

// Generate distinct opaque frames and real ALPH/VP8 data in memory. No private
// source images or derived image fixtures are written to the repository.
const base = readFileSync(new URL('../fixtures/independent.webp', import.meta.url))
async function sample(dependency?: 'alpha' | 'local', loops = 1) {
  const parts: Buffer[] = []
  for (let index = 0; index < 10; index++) {
    const dependent = index === 7 && dependency
    const width = dependent === 'local' ? 4 : 8
    const image = await sharp({
      create: {
        width,
        height: width,
        channels: 4,
        background: { r: index * 23, g: 255 - index * 19, b: index * 11, alpha: dependent === 'alpha' ? 0.5 : 1 }
      }
    })
      .webp({ lossless: false })
      .toBuffer()
    const payload: Buffer[] = []
    for (let at = 12; at < image.length; ) {
      const size = image.readUInt32LE(at + 4),
        end = at + 8 + size + (size % 2)
      if (['ALPH', 'VP8 '].includes(image.toString('ascii', at, at + 4))) payload.push(image.subarray(at, end))
      at = end
    }
    if (dependent === 'alpha') expect(payload[0]!.toString('ascii', 0, 4)).toBe('ALPH')
    const frame = Buffer.alloc(24)
    frame.write('ANMF')
    frame.writeUInt32LE(16 + payload.reduce((n, p) => n + p.length, 0), 4)
    frame[14] = width - 1
    frame[17] = width - 1
    frame[20] = 40
    frame[23] = dependent ? 0 : index % 2 ? 2 : 0
    parts.push(frame, ...payload)
  }
  const prefix = Buffer.from(base.subarray(0, 44))
  prefix.writeUInt16LE(loops, 42)
  const result = Buffer.concat([prefix, ...parts])
  result.writeUInt32LE(result.length - 8, 4)
  return result
}
async function decode(page: Page, sequential: boolean) {
  return page.evaluate(
    async (sequential) =>
      new Promise<{
        frames: { index: number; pixels: number[]; end: number }[]
        modes: string[]
      }>((resolve, reject) => {
        const worker = new Worker('/assets/worker.mjs', { type: 'module' })
        const frames: { index: number; pixels: number[]; end: number }[] = [],
          modes: string[] = []
        const timer = setTimeout(() => finish(Error('timeout')), 10000)
        function finish(error?: Error) {
          clearTimeout(timer)
          worker.terminate()
          if (error) reject(error)
          else resolve({ frames, modes })
        }
        worker.onmessage = ({ data }) => {
          if (data.type === 'pipeline') {
            modes.push(data.mode)
            if (data.mode === 'independent') {
              worker.postMessage({ type: 'pull' })
              worker.postMessage({ type: 'pull' })
            }
          }
          if (data.type === 'frame') {
            frames.push({
              index: data.frame.index,
              pixels: Array.from(new Uint8Array(data.frame.pixels)),
              end: data.frame.endMs ?? (frames.at(-1)?.end ?? 0) + data.frame.durationMs
            })
            worker.postMessage({ type: 'pull', recycled: data.frame.pixels }, [data.frame.pixels])
          }
          if (data.type === 'drained') finish()
          if (data.type === 'error') finish(Error(JSON.stringify(data)))
        }
        worker.postMessage({
          type: 'start',
          source: { url: '/opaque-blend.webp', resourceKey: 'blend' },
          decoderUrl: location.origin + '/assets/decoder.mjs',
          sequential,
          limits: {
            maxInputBytes: 128 * 1024 ** 2,
            maxHeapBytes: 384 * 1024 ** 2,
            maxManagedBytes: 432 * 1024 ** 2,
            maxPixels: 4000000
          }
        })
        worker.postMessage({ type: 'pull' })
        worker.postMessage({ type: 'pull' })
      }),
    sequential
  )
}
for (const dependency of [undefined, 'alpha', 'local'] as const) {
  test(`opaque flags 0/2 pixels match sequential WASM, dependency: ${dependency ?? 'none'}`, async ({ page }) => {
    const bytes = await sample(dependency)
    let requests = 0
    await page.route('**/opaque-blend.webp', (route) => {
      requests++
      return route.fulfill({ contentType: 'image/webp', body: bytes })
    })
    await page.goto('/')
    const sequential = await decode(page, true),
      fast = await decode(page, false)
    expect(fast.frames).toEqual(sequential.frames)
    expect(fast.frames.map((frame) => frame.index)).toEqual(Array.from({ length: 10 }, (_, index) => index))
    expect(fast.frames.map((frame) => frame.end)).toEqual(Array.from({ length: 10 }, (_, index) => (index + 1) * 40))
    expect(fast.frames[0]!.pixels).not.toEqual(fast.frames[1]!.pixels)
    expect(fast.modes).toEqual(dependency ? ['independent', 'sequential'] : ['independent'])
    expect(requests).toBe(2) // Exactly one fetch per attempt, including fallback.
  })
}
test('opaque blend playback preserves pause, finite loops, final frame and single completion', async ({ page }) => {
  const bytes = await sample(undefined, 2)
  await page.route('**/opaque-blend.webp', (route) => route.fulfill({ contentType: 'image/webp', body: bytes }))
  await page.goto('/')
  const run = (script: string) => page.evaluate(script)
  await run('window.start("/opaque-blend.webp",undefined,true,null,{})')
  await expect.poll(() => run('window.player.getSnapshot().frameIndex')).toBeGreaterThanOrEqual(0)
  await run('window.player.pause()')
  const paused = await run('window.player.getSnapshot().positionMs')
  await page.waitForTimeout(120)
  expect(await run('window.player.getSnapshot().positionMs')).toBe(paused)
  expect(await run('window.player.getSnapshot().status')).toBe('paused')
  await run('window.player.play()')
  await expect.poll(() => run('window.player.getSnapshot().status')).toBe('ended')
  expect(await run('window.player.getSnapshot()')).toMatchObject({
    frameIndex: 9,
    cycleIndex: 1,
    positionMs: 400,
    presentedMs: 800
  })
  expect(await run('window.player.getDiagnostics().pipeline')).toBe('independent')
  expect(await run('window.events.filter(e=>e.type==="ended").length')).toBe(1)
})

test('destroyed opaque blend attempt cannot emit late frames or completion', async ({ page }) => {
  const bytes = await sample()
  await page.route('**/opaque-blend.webp', (route) => route.fulfill({ contentType: 'image/webp', body: bytes }))
  await page.route('**/assets/worker.mjs', async (route) => {
    const response = await route.fetch()
    await route.fulfill({
      response,
      body: (await response.text()).replace('./independent-worker.mjs', './independent-worker.mjs?testDelay=80')
    })
  })
  await page.goto('/')
  const run = (script: string) => page.evaluate(script)
  await run('window.start("/opaque-blend.webp",undefined,false,null,{})')
  await expect.poll(() => run('window.player.getSnapshot().frameIndex')).toBeGreaterThanOrEqual(0)
  await run('window.player.destroy()')
  const events = await run('window.events.length')
  await page.waitForTimeout(250)
  expect(await run('window.events.length')).toBe(events)
  expect(await run('window.player.getSnapshot().status')).toBe('destroyed')
  expect(await run('window.events.some(e=>e.type==="ended")')).toBe(false)
})
