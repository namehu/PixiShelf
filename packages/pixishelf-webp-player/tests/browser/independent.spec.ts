import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
// Inject inert container data into a synthetic fixture; no private media is used.
function withChunk(kind: string, middle: boolean, size = 3, fixture = 'independent.webp') {
  const original = readFileSync(new URL(`../fixtures/${fixture}`, import.meta.url))
  const chunk = Buffer.alloc(8 + size + (size % 2))
  chunk.write(kind)
  chunk.writeUInt32LE(size, 4)
  const offset = middle ? 44 + 6 * (8 + original.readUInt32LE(48)) : original.length
  const result = Buffer.concat([original.subarray(0, offset), chunk, original.subarray(offset)])
  result.writeUInt32LE(result.length - 8, 4)
  return result
}
const run = (page: import('@playwright/test').Page, script: string) => page.evaluate(script)
test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

test('independent frames use four credits, pause in place, preserve last frame and EOF', async ({ page }) => {
  await run(page, 'window.start("/tests/fixtures/independent.webp",undefined,false,null,{})')
  await expect.poll(() => run(page, 'window.player.getSnapshot().frameIndex')).toBeGreaterThanOrEqual(0)
  await run(page, 'window.player.pause()')
  const snapshot = await run(page, 'window.player.getSnapshot()')
  await page.waitForTimeout(150)
  expect(await run(page, 'window.player.getSnapshot()')).toMatchObject({
    positionMs: (snapshot as { positionMs: number }).positionMs,
    status: 'paused'
  })
  await run(page, 'window.player.play()')
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('ended')
  expect(await run(page, 'window.player.getSnapshot().frameIndex')).toBe(11)
  expect(await run(page, 'window.player.getSnapshot().presentedMs')).toBe(480)
  expect(await run(page, 'window.player.getDiagnostics().pipeline')).toBe('independent')
  expect(await run(page, 'window.events.filter(e=>e.type==="ended").length')).toBe(1)
})
test('independent file loop count and first/last pictures are retained', async ({ page }) => {
  await run(page, 'window.start("/tests/fixtures/independent-loop.webp",undefined,true,null,{})')
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('ended')
  expect(await run(page, 'window.player.getSnapshot()')).toMatchObject({
    cycleIndex: 1,
    frameIndex: 3,
    presentedMs: 320,
    positionMs: 160
  })
})
for (const unknownPrefix of [false, true]) {
  test(`late dependency replays pixels without refetch or duplicate output (unknown prefix: ${unknownPrefix})`, async ({
    page
  }) => {
    if (unknownPrefix) {
      await page.route('**/independent-mixed.webp', (route) =>
        route.fulfill({
          contentType: 'image/webp',
          body: withChunk('TEST', true, 3, 'independent-mixed.webp')
        })
      )
    }
    let requests = 0
    page.on('request', (req) => {
      if (req.url().includes('independent-mixed.webp')) requests++
    })
    const result = await page.evaluate(async () => {
      async function decode(sequential: boolean) {
        return new Promise<{ index: number; pixels: number[] }[]>((resolve, reject) => {
          const worker = new Worker('/assets/worker.mjs', { type: 'module' }),
            frames: { index: number; pixels: number[] }[] = []
          let credits = 2
          const timer = setTimeout(() => {
            worker.terminate()
            reject(Error('timeout'))
          }, 10000)
          worker.onmessage = ({ data }) => {
            if (data.type === 'pipeline' && credits === 2) {
              credits = 4
              worker.postMessage({ type: 'pull' })
              worker.postMessage({ type: 'pull' })
            }
            if (data.type === 'frame') {
              frames.push({ index: data.frame.index, pixels: Array.from(new Uint8Array(data.frame.pixels)) })
              worker.postMessage({ type: 'pull', recycled: data.frame.pixels }, [data.frame.pixels])
            }
            if (data.type === 'drained') {
              clearTimeout(timer)
              worker.terminate()
              resolve(frames)
            }
            if (data.type === 'error') {
              clearTimeout(timer)
              worker.terminate()
              reject(Error(JSON.stringify(data)))
            }
          }
          worker.postMessage({
            type: 'start',
            source: { url: '/tests/fixtures/independent-mixed.webp', resourceKey: 'test' },
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
        })
      }
      return { normal: await decode(true), fast: await decode(false) }
    })
    expect(requests).toBe(2) // One fetch for each independent decode attempt; no fallback fetch.
    expect(result.fast).toEqual(result.normal)
    expect(result.fast.map((f) => f.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8])
  })
}
test('truncated independent input never ends successfully', async ({ page }) => {
  await run(page, 'window.start("/tests/fixtures/independent-truncated.webp",undefined,false,null,{}).catch(()=>{})')
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('error')
  expect(await run(page, 'window.events.some(e=>e.type==="ended")')).toBe(false)
})
test('budget gate preserves sequential decoding', async ({ page }) => {
  await run(
    page,
    'window.start("/tests/fixtures/independent.webp",{maxInputBytes:1024*1024,maxHeapBytes:128*1024**2,maxManagedBytes:180*1024**2,maxPixels:4000000},false,null,{})'
  )
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('ended')
  expect(await run(page, 'window.player.getDiagnostics().pipeline')).toBeUndefined()
})
test('slow independent decode drops work before decoding while keeping first and final frames', async ({ page }) => {
  await page.route('**/assets/worker.mjs', async (route) => {
    const response = await route.fetch()
    await route.fulfill({
      response,
      body: (await response.text()).replace('./independent-worker.mjs', './independent-worker.mjs?testDelay=80')
    })
  })
  await run(page, 'window.start("/tests/fixtures/independent-fast.webp",undefined,false,null,{})')
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('ended')
  const report = (await run(page, 'window.player.getDiagnostics()')) as {
    decodeOmittedFrames: number
    playbackWallMs: number
    decodedFrames: number
  }
  expect(report.decodeOmittedFrames).toBeGreaterThan(0)
  expect(report.decodedFrames).toBeLessThan(120)
  expect(report.playbackWallMs).toBeLessThan(2400)
  expect(await run(page, 'window.player.getSnapshot().frameIndex')).toBe(119)
  expect(await run(page, 'window.player.getSnapshot().presentedMs')).toBe(1920)
})
test('independent input starts before EOF and waits without chasing a network stall', async ({ page }) => {
  await run(page, 'window.start("/tests/fixtures/independent.webp?gate",undefined,false,null,{})')
  await expect.poll(() => run(page, 'window.player.getSnapshot().frameIndex')).toBe(0)
  expect(await run(page, 'window.player.getSnapshot().inputComplete')).toBe(false)
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('buffering')
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('ended')
  expect(await run(page, 'window.player.getSnapshot().frameIndex')).toBe(11)
})
test('blocked decode child transparently returns to the sequential decoder', async ({ page }) => {
  await page.route('**/assets/worker.mjs', async (route) => {
    const response = await route.fetch()
    await route.fulfill({
      response,
      body: (await response.text()).replace('./independent-worker.mjs', './independent-worker.mjs?testFailure=1')
    })
  })
  await run(page, 'window.start("/tests/fixtures/independent.webp",undefined,false,null,{})')
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('ended')
  expect(await run(page, 'window.player.getDiagnostics().pipeline')).toBe('sequential')
})
test('player continues after a mid-stream dependency without restarting its first frame', async ({ page }) => {
  await run(page, 'window.start("/tests/fixtures/independent-mixed.webp",undefined,false,null,{})')
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('ended')
  expect(await run(page, 'window.player.getDiagnostics().pipeline')).toBe('sequential')
  expect(await run(page, 'window.events.filter(e=>e.type==="first-frame").length')).toBe(1)
  expect(await run(page, 'window.player.getSnapshot().frameIndex')).toBe(8)
})
test('a child failure during dependency fallback cannot leave replay waiting forever', async ({ page }) => {
  await page.route('**/assets/worker.mjs', async (route) => {
    const response = await route.fetch()
    await route.fulfill({
      response,
      body: (await response.text()).replace('./independent-worker.mjs', './independent-worker.mjs?testErrorIndex=2')
    })
  })
  await run(page, 'window.start("/tests/fixtures/independent-mixed.webp",undefined,false,null,{})')
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('ended')
  expect(await run(page, 'window.player.getSnapshot().frameIndex')).toBe(8)
  expect(await run(page, 'window.events.filter(e=>e.type==="first-frame").length')).toBe(1)
})
test('a late drawing callback does not turn bounded parser lookahead into network buffering', async ({ page }) => {
  await page.addInitScript(() => {
    const raf = requestAnimationFrame.bind(window)
    let ticks = 0
    window.requestAnimationFrame = (callback) =>
      raf((time) => {
        if (++ticks === 4) setTimeout(() => callback(time), 400)
        else callback(time)
      })
  })
  await page.reload()
  await run(page, 'window.start("/tests/fixtures/independent-fast.webp",undefined,false,null,{})')
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('ended')
  expect(await run(page, 'window.player.getDiagnostics().playbackWallMs')).toBeLessThan(2150)
  expect(await run(page, 'window.player.getDiagnostics().decodeOmittedFrames')).toBeGreaterThan(0)
  expect(await run(page, 'window.player.getSnapshot().frameIndex')).toBe(119)
})

for (const [name, middle, size] of [
  ['middle', true, 3],
  ['end', false, 3],
  ['large', true, 2 * 1024 * 1024 + 1]
] as const) {
  test(`unknown ${name} chunk preserves the fast path and final frame`, async ({ page }) => {
    await page.route('**/unknown.webp', (route) =>
      route.fulfill({ contentType: 'image/webp', body: withChunk('TEST', middle, size) })
    )
    await run(page, 'window.start("/unknown.webp",undefined,false,null,{})')
    await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('ended')
    expect(await run(page, 'window.player.getDiagnostics().pipeline')).toBe('independent')
    expect(await run(page, 'window.player.getSnapshot().frameIndex')).toBe(11)
    expect(await run(page, 'window.player.getSnapshot().presentedMs')).toBe(480)
  })
}
for (const issue of ['truncated', 'padding', 'size', 'trailing'] as const) {
  test(`unknown chunk ${issue} does not report a valid EOF`, async ({ page }) => {
    let bytes = withChunk('TEST', false)
    if (issue === 'truncated') bytes = bytes.subarray(0, bytes.length - 2)
    if (issue === 'padding') bytes[bytes.length - 1] = 1
    if (issue === 'size') bytes.writeUInt32LE(0xffffffff, bytes.length - 8)
    if (issue === 'trailing') bytes = Buffer.concat([bytes, Buffer.from([0])])
    await page.route('**/unknown.webp', (route) => route.fulfill({ contentType: 'image/webp', body: bytes }))
    await run(page, 'window.start("/unknown.webp",undefined,false,null,{}).catch(()=>{})')
    await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('error')
    expect(await run(page, 'window.events.some(e=>e.type==="ended")')).toBe(false)
  })
}
for (const [kind, size] of [
  ['ICCP', 3],
  ['EXIF', 3],
  ['XMP ', 3],
  ['ANIM', 5],
  ['ANIM', 6],
  ['ANIM', 7]
] as const) {
  test(`ignored ${kind} (${size}) agrees with sequential WASM without fallback`, async ({ page }) => {
    const middle = withChunk(kind, true, size)
    const tail = Buffer.alloc(8 + size + (size % 2))
    tail.write(kind)
    tail.writeUInt32LE(size, 4)
    const bytes = Buffer.concat([middle, tail])
    bytes.writeUInt32LE(bytes.length - 8, 4)
    await page.route('**/ignored.webp', (route) => route.fulfill({ contentType: 'image/webp', body: bytes }))
    const result = await page.evaluate(async () => {
      async function decode(sequential: boolean) {
        return new Promise<{ index: number; pixels: number[] }[]>((resolve, reject) => {
          const worker = new Worker('/assets/worker.mjs', { type: 'module' }),
            frames: { index: number; pixels: number[] }[] = []
          let credits = 2
          const timer = setTimeout(() => {
            worker.terminate()
            reject(Error('timeout'))
          }, 10000)
          worker.onmessage = ({ data }) => {
            if (data.type === 'pipeline' && data.mode !== 'independent' && !sequential) {
              reject(Error('unexpected fallback'))
              worker.terminate()
              clearTimeout(timer)
            }
            if (data.type === 'pipeline' && credits === 2) {
              credits = 4
              worker.postMessage({ type: 'pull' })
              worker.postMessage({ type: 'pull' })
            }
            if (data.type === 'frame') {
              frames.push({ index: data.frame.index, pixels: Array.from(new Uint8Array(data.frame.pixels)) })
              worker.postMessage({ type: 'pull', recycled: data.frame.pixels }, [data.frame.pixels])
            }
            if (data.type === 'drained') {
              clearTimeout(timer)
              worker.terminate()
              resolve(frames)
            }
            if (data.type === 'error') {
              clearTimeout(timer)
              worker.terminate()
              reject(Error(JSON.stringify(data)))
            }
          }
          worker.postMessage({
            type: 'start',
            source: { url: '/ignored.webp', resourceKey: 'test' },
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
        })
      }
      return { normal: await decode(true), fast: await decode(false) }
    })
    expect(result.fast).toEqual(result.normal)
    expect(result.fast).toHaveLength(12)
  })
}
for (const [kind, size] of [
  ['ALPH', 3],
  ['VP8 ', 10],
  ['VP8L', 5],
  ['VP8X', 10],
  ['ANIM', 4]
] as const) {
  test(`invalid trailing ${kind} reports error without fallback or ended`, async ({ page }) => {
    await page.route('**/invalid.webp', (route) =>
      route.fulfill({ contentType: 'image/webp', body: withChunk(kind, false, size) })
    )
    await run(page, 'window.start("/invalid.webp",undefined,false,null,{}).catch(()=>{})')
    await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('error')
    expect(await run(page, 'window.events.some(e=>e.type==="ended")')).toBe(false)
    expect(await run(page, 'window.player.getDiagnostics().pipeline')).toBe('independent')
    expect(await run(page, 'window.player.getDiagnostics().fallbackReason')).toBeUndefined()
  })
}
for (const [kind, flag] of [
  ['ICCP', 32],
  ['EXIF', 8],
  ['XMP ', 4]
] as const) {
  test(`declared ${kind} still rejects the independent header`, async ({ page }) => {
    const bytes = withChunk(kind, true)
    bytes[20]! |= flag
    await page.route('**/declared.webp', (route) => route.fulfill({ contentType: 'image/webp', body: bytes }))
    await run(
      page,
      `
      window.pipelineMessages = [];
      const OriginalWorker = window.Worker;
      window.Worker = class extends OriginalWorker {
        constructor(...args) {
          super(...args);
          this.addEventListener('message', ({data}) => {
            if (data.type === 'pipeline') window.pipelineMessages.push(data);
          });
        }
      };
    `
    )
    await run(page, 'window.start("/declared.webp",undefined,false,null,{}).catch(()=>{})')
    // Initial eligibility rejection enters the sequential decoder directly; it
    // does not emit the pipeline event used for an already-active fast path.
    await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe(kind === 'XMP ' ? 'ended' : 'error')
    expect(await run(page, 'window.pipelineMessages')).toEqual([])
    if (kind === 'XMP ') {
      expect(await run(page, 'window.player.getSnapshot().frameIndex')).toBe(11)
      expect(await run(page, 'window.events.filter(e=>e.type==="ended").length')).toBe(1)
      expect(await run(page, 'window.events.some(e=>e.type==="error")')).toBe(false)
    } else {
      expect(await run(page, 'window.events.find(e=>e.type==="error").error.code')).toBe('metadata')
      expect(await run(page, 'window.events.some(e=>e.type==="ended")')).toBe(false)
      expect(await run(page, 'window.events.some(e=>e.type==="first-frame")')).toBe(false)
    }
  })
}
