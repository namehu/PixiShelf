import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
const run = (page: import('@playwright/test').Page, script: string) => page.evaluate(script)
test.beforeEach(async ({ page }) => {
  await page.goto('/')
})
test('renders multiple frames before EOF, buffers, then ends exactly once', async ({ page }) => {
  await run(page, 'window.start()')
  await expect.poll(() => run(page, 'window.player.getSnapshot().frameIndex')).toBe(1)
  expect(await run(page, 'window.player.getSnapshot().inputComplete')).toBe(false)
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('buffering')
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('ended')
  expect(await run(page, 'window.events.filter(e=>e.type==="ended").length')).toBe(1)
  expect(await run(page, 'window.player.getSnapshot().frameIndex')).toBe(3)
})
test('pauses the displayed frame and resumes without replay or background completion', async ({ page }) => {
  await run(page, 'window.start()')
  await expect.poll(() => run(page, 'window.player.getSnapshot().frameIndex')).toBe(0)
  await run(page, 'window.player.pause()')
  const index = await run(page, 'window.player.getSnapshot().frameIndex')
  await page.waitForTimeout(2100)
  expect(await run(page, 'window.player.getSnapshot().frameIndex')).toBe(index)
  expect(await run(page, 'window.player.getSnapshot().status')).toBe('paused')
  await run(page, 'window.player.play()')
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('ended')
})

test('reports partial displayed-frame progress, freezes on pause, and waits for EOF despite short metadata', async ({ page }) => {
  await run(page, 'window.start("/tests/fixtures/composite.webp?gate",undefined,false,100)')
  await expect.poll(() => run(page, 'window.player.getSnapshot().frameIndex')).toBe(0)
  await page.waitForTimeout(150)
  const beforePause = await run(page, 'window.player.getSnapshot().positionMs') as number
  expect(beforePause).toBeGreaterThan(0)
  expect(await run(page, 'window.player.getSnapshot().durationMs')).toBe(100)
  await run(page, 'window.player.pause()')
  const frozen = await run(page, 'window.player.getSnapshot().positionMs')
  await page.waitForTimeout(200)
  expect(await run(page, 'window.player.getSnapshot().positionMs')).toBe(frozen)
  expect(await run(page, 'window.events.some(e=>e.type==="ended")')).toBe(false)
  await run(page, 'window.player.play()')
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('ended')
  const progressTimes = (await run(page, 'window.events.filter(e=>e.type==="progress").map(e=>e.at)')) as number[]
  expect(progressTimes.length).toBeGreaterThan(0)
  expect(await run(page, 'window.events.filter(e=>e.type==="ended").length')).toBe(1)
})
test('truncated input reports an error, never completion', async ({ page }) => {
  await run(page, 'window.start("/tests/fixtures/truncated.webp").catch(()=>{})')
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('error')
  expect(await run(page, 'window.events.some(e=>e.type==="ended")')).toBe(false)
})
test('metadata requests a compatibility fallback before painting', async ({ page }) => {
  await run(page, 'window.start("/tests/fixtures/metadata.webp").catch(()=>{})')
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('error')
  expect(await run(page, 'window.events.find(e=>e.type==="error").error')).toMatchObject({
    code: 'metadata',
    recoverableByLegacy: true
  })
})
test('normalizes a short frame and completes the one-frame animation', async ({ page }) => {
  await run(page, 'window.start("/tests/fixtures/short.webp")')
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('ended')
  expect(await run(page, 'window.player.getSnapshot().presentedMs')).toBe(100)
})
test('enforces actual decoded canvas dimensions before displaying a frame', async ({ page }) => {
  await run(
    page,
    'window.start("/tests/fixtures/composite.webp",{maxInputBytes:1048576,maxPixels:1,maxHeapBytes:134217728,maxManagedBytes:201326592}).catch(()=>{})'
  )
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('error')
  expect(await run(page, 'window.events.find(e=>e.type==="error").error')).toMatchObject({
    code: 'pixel-limit',
    recoverableByLegacy: true
  })
  expect(await run(page, 'window.events.some(e=>e.type==="first-frame")')).toBe(false)
})

test('rejects an actual streamed RIFF larger than the file limit', async ({ page }) => {
  await run(
    page,
    'window.start("/tests/fixtures/composite.webp?gate",{maxInputBytes:200,maxPixels:8000000,maxHeapBytes:805306368,maxManagedBytes:905969664}).catch(()=>{})'
  )
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('error')
  expect(await run(page, 'window.events.find(e=>e.type==="error").error')).toMatchObject({
    code: 'file-limit',
    recoverableByLegacy: true
  })
  expect(await run(page, 'window.events.some(e=>e.type==="first-frame")')).toBe(false)
})

for (const [profile, padding, maxInputBytes, maxPixels, maxHeapBytes, maxManagedBytes] of [
  ['narrow', 33, 128 * 2 ** 20, 4_000_000, 384 * 2 ** 20, 432 * 2 ** 20],
  ['wide', 65, 256 * 2 ** 20, 8_000_000, 768 * 2 ** 20, 864 * 2 ** 20]
] as const) {
  test(`${profile} profile decodes valid chunked HTTP WebP beyond the old file limit`, async ({ page }) => {
    test.setTimeout(120000)
    await run(
      page,
      `window.start('/tests/fixtures/composite.webp?padMiB=${padding}',{maxInputBytes:${maxInputBytes},maxPixels:${maxPixels},maxHeapBytes:${maxHeapBytes},maxManagedBytes:${maxManagedBytes}})`
    )
    await expect.poll(() => run(page, 'window.player.getSnapshot().status'), { timeout: 110000 }).toBe('ended')
    expect(await run(page, 'window.player.getSnapshot().receivedBytes')).toBe(266 + 8 + padding * 2 ** 20)
    expect(await run(page, 'window.player.getSnapshot().inputComplete')).toBe(true)
  })
}

for (const [profile, padding, maxInputBytes, maxPixels, maxHeapBytes, maxManagedBytes] of [
  ['narrow', 129, 128 * 2 ** 20, 4_000_000, 384 * 2 ** 20, 432 * 2 ** 20],
  ['wide', 257, 256 * 2 ** 20, 8_000_000, 768 * 2 ** 20, 864 * 2 ** 20]
] as const) {
  test(`${profile} profile rejects a streamed RIFF beyond its new hard limit`, async ({ page }) => {
    await run(
      page,
      `window.start('/tests/fixtures/composite.webp?padMiB=${padding}',{maxInputBytes:${maxInputBytes},maxPixels:${maxPixels},maxHeapBytes:${maxHeapBytes},maxManagedBytes:${maxManagedBytes}}).catch(()=>{})`
    )
    await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('error')
    expect(await run(page, 'window.events.find(e=>e.type==="error").error.code')).toBe('file-limit')
    expect(await run(page, 'window.events.some(e=>e.type==="first-frame")')).toBe(false)
  })
}
test('destroy during initialization cannot resurrect the old player', async ({ page }) => {
  await run(page, 'void window.start().catch(()=>{}); window.player.destroy()')
  await page.waitForTimeout(300)
  expect(await run(page, 'window.player.getSnapshot().status')).toBe('destroyed')
  expect(await run(page, 'window.events.some(e=>e.type==="first-frame" || e.type==="ended")')).toBe(false)
})
test('50 load/destroy cycles leave no active workers or stale completion', async ({ page }) => {
  await run(
    page,
    `window.activeWorkers=0;const Original=window.Worker;window.Worker=class extends Original{constructor(...a){super(...a);window.activeWorkers++;this.alive=true}terminate(){if(this.alive){window.activeWorkers--;this.alive=false}super.terminate()}}`
  )
  for (let i = 0; i < 50; i++) {
    await run(page, 'window.start().catch(()=>{})')
    await run(page, 'window.player.destroy()')
  }
  expect(await run(page, 'window.activeWorkers')).toBe(0)
  expect(await run(page, 'window.player.getSnapshot().status')).toBe('destroyed')
})
test('1080p 24fps benchmark stays within the playback duration gate', async ({ page }) => {
  const elapsed = await run(
    page,
    `(async()=>{const start=performance.now();await window.start('/tests/fixtures/benchmark.webp');await new Promise((resolve,reject)=>window.player.subscribe(e=>{if(e.type==='ended')resolve();if(e.type==='error')reject(new Error(e.error.code))}));return performance.now()-start})()`
  )
  expect(elapsed).toBeLessThan(11000)
  console.log(
    JSON.stringify({ benchmark: '1080p-24fps', elapsedMs: elapsed, browser: page.context().browser()?.version() })
  )
})

test('authentication failures are errors, not compatibility fallbacks', async ({ page }) => {
  await page.route('**/denied.webp', (route) => route.fulfill({ status: 401, body: 'Unauthorized' }))
  await run(page, 'window.start("/denied.webp").catch(()=>{})')
  expect(await run(page, 'window.events.find(e=>e.type==="error").error')).toMatchObject({
    code: 'auth',
    recoverableByLegacy: false
  })
})

test('a network failure after drawing never completes or replays', async ({ page }) => {
  await run(page, 'window.start("/tests/fixtures/composite.webp?gate&disconnect")')
  await expect.poll(() => run(page, 'window.player.getSnapshot().frameIndex')).toBe(1)
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('error')
  expect(await run(page, 'window.events.some(e=>e.type==="ended")')).toBe(false)
  expect(await run(page, 'window.events.find(e=>e.type==="error").error.recoverableByLegacy')).toBe(false)
})

test('manual loops reuse one request and Worker, pause cleanly and still start before EOF', async ({ page }) => {
  let requests = 0
  page.on('request', (request) => {
    if (request.url().includes('composite.webp')) requests++
  })
  await run(
    page,
    `window.workerCount=0;const Original=window.Worker;window.Worker=class extends Original{constructor(...a){super(...a);window.workerCount++}}`
  )
  await run(page, 'window.start("/tests/fixtures/composite.webp?gate",undefined,true)')
  await expect.poll(() => run(page, 'window.player.getSnapshot().frameIndex')).toBe(1)
  expect(await run(page, 'window.player.getSnapshot().inputComplete')).toBe(false)
  await expect.poll(() => run(page, 'window.player.getSnapshot().presentedMs')).toBeGreaterThan(2500)
  await expect.poll(() => run(page, 'window.player.getSnapshot().cycleIndex')).toBeGreaterThan(0)
  expect(await run(page, 'window.events.some(e=>e.type==="ended")')).toBe(false)
  expect(requests).toBe(1)
  expect(await run(page, 'window.workerCount')).toBe(1)
  await run(page, 'window.player.pause()')
  const snapshot = await run(page, 'window.player.getSnapshot()')
  await page.waitForTimeout(350)
  expect(await run(page, 'window.player.getSnapshot()')).toEqual(snapshot)
  await run(page, 'window.player.play()')
  await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('playing')
  await run(page, 'window.player.destroy()')
  expect(await run(page, 'window.player.getSnapshot().status')).toBe('destroyed')
})

for (const loops of [1, 2]) {
  test(`manual playback honors a finite file loop count of ${loops}`, async ({ page }) => {
    const body = await readFile(new URL('../fixtures/short.webp', import.meta.url))
    body.writeUInt16LE(loops, body.indexOf('ANIM') + 12)
    await page.route('**/finite.webp', (route) => route.fulfill({ contentType: 'image/webp', body }))
    await run(page, 'window.start("/finite.webp",undefined,true)')
    await expect.poll(() => run(page, 'window.player.getSnapshot().status')).toBe('ended')
    expect(await run(page, 'window.player.getSnapshot().presentedMs')).toBe(100 * loops)
    expect(await run(page, 'window.events.filter(e=>e.type==="ended").length')).toBe(1)
  })
}
