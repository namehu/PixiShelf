import { test, expect } from '@playwright/test'
import { readFileSync } from 'node:fs'
import type { PlayerSnapshot } from '../../src/types'
interface RunResult {
  pixels: number[]
  snapshot: PlayerSnapshot
  cache: { hits: number; entries: number }
  inputAtFirst: boolean
  diagnostics: { pipeline: string }
}

const setup = `
const {WebpPlayer,CompressedInputCache,PlaybackPressure,playerLimits}=await import('/dist/index.js');
window.cache=new CompressedInputCache(); window.pressure=new PlaybackPressure();
window.runCached=async (url,settings={})=>{
 window.player?.destroy();
 const canvas=document.querySelector('canvas');
 const player=new WebpPlayer(canvas,{workerUrl:'/assets/worker.mjs',decoderUrl:'/assets/decoder.mjs',
   inputCache:window.cache,pressure:window.pressure,limits:playerLimits(true),diagnostics:{},...settings});
 window.player=player;
 const before=performance.now();let first=null, inputAtFirst=null,paused=false;
 const ended=new Promise((resolve,reject)=>player.subscribe(e=>{
  if(e.type==='first-frame'){first=performance.now()-before;inputAtFirst=player.getSnapshot().inputComplete}
  if(e.type==='error')reject(Error(e.error.code));
  if(e.type==='ended')resolve({first,inputAtFirst,snapshot:player.getSnapshot(),cache:window.cache.getSnapshot(),
    diagnostics:player.getDiagnostics(),pixels:Array.from(canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data)});
 }));
 player.load({url,resourceKey:url,loop:settings.loop}).catch(()=>{}); player.play();return ended;
};`
test('real Worker/WASM replays and revisits exact pixels with no duplicate media GET', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(`(async()=>{${setup}})()`)
  const requests: string[] = []
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/images/')) requests.push(r.url())
  })
  const run = (id: string) => page.evaluate<RunResult>(`window.runCached('/api/v1/images/independent.webp?v=${id}')`)
  const first = await run('a')
  await run('b')
  await run('c')
  const replay = await run('a')
  expect(replay.pixels).toEqual(first.pixels)
  expect(replay.snapshot.status).toBe('ended')
  expect(replay.cache.hits).toBe(1)
  expect(requests).toHaveLength(3)
  await page.evaluate('window.cache.clear()')
})
test('streaming first frame precedes EOF, pause retains cursor, cached source honors finite loops', async ({
  page
}) => {
  await page.goto('/')
  await page.evaluate(`(async()=>{${setup}})()`)
  await page.evaluate(`void (window.pending=window.runCached('/api/v1/images/independent.webp?v=stream&gate&loops=2'))`)
  await expect.poll(() => page.evaluate('window.player.getSnapshot().frameIndex')).not.toBeNull()
  expect(await page.evaluate('window.player.getSnapshot().inputComplete')).toBe(false)
  await page.evaluate('window.player.pause()')
  const before = await page.evaluate('window.player.getSnapshot().positionMs')
  await page.waitForTimeout(100)
  expect(await page.evaluate('window.player.getSnapshot().positionMs')).toBe(before)
  await page.evaluate('window.player.play()')
  const result = await page.evaluate<RunResult>('window.pending')
  expect(result.inputAtFirst).toBe(false)
  expect(result.cache.entries).toBe(1)
  const looped = await page.evaluate<RunResult>(
    `window.runCached('/api/v1/images/independent.webp?v=stream&gate&loops=2',{loop:true})`
  )
  expect(looped.snapshot.cycleIndex).toBeGreaterThan(0)
  expect(looped.cache.hits).toBe(1)
  await page.evaluate('window.cache.clear()')
})
test('midstream dependency fallback shares the reader; truncation never enters completed cache', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(`(async()=>{${setup}})()`)
  let requests = 0
  page.on('request', (r) => {
    if (r.url().includes('/api/v1/images/')) requests++
  })
  const first = await page.evaluate<RunResult>(`window.runCached('/api/v1/images/independent-mixed.webp?v=a')`)
  const second = await page.evaluate<RunResult>(`window.runCached('/api/v1/images/independent-mixed.webp?v=a')`)
  expect(first.diagnostics.pipeline).toBe('sequential')
  expect(second.pixels).toEqual(first.pixels)
  expect(requests).toBe(1)
  const error = await page.evaluate<string>(
    `window.runCached('/api/v1/images/independent-truncated.webp?v=a').then(()=>null,e=>e.message)`
  )
  expect(error).toBe('invalid')
  expect(await page.evaluate('window.cache.getSnapshot().entries')).toBe(0)
  await page.evaluate('window.cache.clear()')
})
test('scope revocation during a pending read stops playback and stale bytes cannot be committed', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(`(async()=>{${setup}})()`)
  await page.evaluate(`void window.runCached('/api/v1/images/independent.webp?v=cancel&gate').catch(()=>{});`)
  await expect.poll(() => page.evaluate('window.player.getSnapshot().frameIndex')).not.toBeNull()
  await page.evaluate('window.cache.clear()')
  expect(await page.evaluate('window.player.getSnapshot().status')).toBe('destroyed')
  await page.waitForTimeout(2600)
  expect(await page.evaluate('window.cache.getSnapshot().reservedBytes')).toBe(0)
})

test('reduced cadence frames match full sequential WASM pixels and retain source EOF', async ({ page }) => {
  const original = readFileSync(new URL('../fixtures/independent.webp', import.meta.url))
  const pieces: Buffer[] = []
  for (let at = 44; at < original.length; ) {
    const size = original.readUInt32LE(at + 4),
      end = at + 8 + size + (size % 2)
    pieces.push(Buffer.from(original.subarray(at, end)))
    at = end
  }
  const frames = Array.from({ length: 120 }, (_, i) => {
    const f = Buffer.from(pieces[i % pieces.length]!)
    f.writeUIntLE(Math.round(((i + 1) * 1000) / 60) - Math.round((i * 1000) / 60), 20, 3)
    return f
  })
  const bytes = Buffer.concat([original.subarray(0, 44), ...frames])
  bytes.writeUInt32LE(bytes.length - 8, 4)
  await page.route('**/cadence.webp', (route) => route.fulfill({ body: bytes, contentType: 'image/webp' }))
  await page.goto('/')
  const decoded = await page.evaluate(async () => {
    const run = (sequential: boolean) =>
      new Promise<{ index: number; pixels: number[]; start?: number; presentation?: number }[]>((resolve, reject) => {
        const w = new Worker('/assets/worker.mjs', { type: 'module' }),
          frames: { index: number; pixels: number[]; start?: number; presentation?: number }[] = []
        w.onmessage = ({ data }) => {
          if (data.type === 'pipeline') {
            w.postMessage({ type: 'pull' })
            w.postMessage({ type: 'pull' })
            w.postMessage({ type: 'reduce-load' })
          }
          if (data.type === 'frame') {
            frames.push({
              index: data.frame.index,
              pixels: Array.from(new Uint8Array(data.frame.pixels)),
              start: data.frame.startMs,
              presentation: data.frame.presentationMs
            })
            w.postMessage({ type: 'pull', recycled: data.frame.pixels }, [data.frame.pixels])
          }
          if (data.type === 'drained') {
            w.terminate()
            resolve(frames)
          }
          if (data.type === 'error') {
            w.terminate()
            reject(Error(data.error.code))
          }
        }
        w.postMessage({
          type: 'start',
          source: { url: '/cadence.webp', resourceKey: 'synthetic' },
          decoderUrl: location.origin + '/assets/decoder.mjs',
          sequential,
          limits: {
            maxInputBytes: 128 * 1024 ** 2,
            maxPixels: 4000000,
            maxHeapBytes: 384 * 1024 ** 2,
            maxManagedBytes: 432 * 1024 ** 2
          }
        })
        w.postMessage({ type: 'pull' })
        w.postMessage({ type: 'pull' })
      })
    return { full: await run(true), reduced: await run(false) }
  })
  expect(decoded.full).toHaveLength(120)
  expect(decoded.reduced.length).toBeLessThan(90)
  expect(decoded.reduced[0]!.index).toBe(0)
  expect(decoded.reduced.at(-1)!.index).toBe(119)
  for (const f of decoded.reduced) {
    expect(f.pixels).toEqual(decoded.full[f.index]!.pixels)
    expect(f.start).toBe(Math.round((f.index * 1000) / 60))
    if (f.presentation !== undefined) expect(f.presentation).toBeGreaterThanOrEqual(f.start!)
  }
})
