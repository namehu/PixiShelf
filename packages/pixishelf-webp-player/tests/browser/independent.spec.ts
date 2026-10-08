import { test, expect } from '@playwright/test'
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
test('late dependency replays compositing state without downloading or outputting old frames again', async ({
  page
}) => {
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
