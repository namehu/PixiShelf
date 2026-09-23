import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { WebpPlayer } from '../player'
import type { WorkerEvent, PlayerEvent } from '../types'
class FakeWorker {
  static instances: FakeWorker[] = []
  onmessage: ((event: MessageEvent<WorkerEvent>) => void) | null = null
  onerror: (() => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() {
    FakeWorker.instances.push(this)
  }
  emit(data: WorkerEvent) {
    this.onmessage?.({ data } as MessageEvent<WorkerEvent>)
  }
}
let raf: Map<number, FrameRequestCallback>, id: number, now: number
const draw = vi.fn()
function player() {
  return new WebpPlayer(
    { width: 0, height: 0, getContext: () => ({ putImageData: draw }) } as unknown as HTMLCanvasElement,
    { workerUrl: '/worker.mjs', decoderUrl: '/decoder.mjs' }
  )
}
function tick(time: number) {
  now = time
  const callbacks = [...raf.values()]
  raf.clear()
  callbacks.forEach((fn) => fn(time))
}
const frame = (index: number, durationMs = 1000): WorkerEvent => ({
  type: 'frame',
  frame: { index, durationMs, width: 1, height: 1, pixels: new ArrayBuffer(4) }
})
beforeEach(() => {
  now = 0
  id = 0
  raf = new Map()
  draw.mockClear()
  FakeWorker.instances = []
  vi.stubGlobal('window', { innerWidth: 1000, location: { href: 'http://localhost/', origin: 'http://localhost' } })
  vi.stubGlobal('location', { href: 'http://localhost/' })
  vi.stubGlobal('Worker', FakeWorker)
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number
      ) {}
    }
  )
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    raf.set(++id, fn)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (n: number) => raf.delete(n))
  vi.spyOn(performance, 'now').mockImplementation(() => now)
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
describe('player lifecycle and scheduling', () => {
  it('keeps the remaining frame duration on pause, and completes only after validated EOF', async () => {
    const p = player(),
      events: PlayerEvent[] = []
    p.subscribe((e) => events.push(e))
    const loaded = p.load({ url: '/a.webp', resourceKey: 'a' })
    p.play()
    const w = FakeWorker.instances[0]!
    w.emit(frame(0))
    await loaded
    tick(0)
    now = 300
    p.pause()
    tick(2300)
    expect(p.getSnapshot().status).toBe('paused')
    expect(draw).toHaveBeenCalledTimes(1)
    p.play()
    tick(2999)
    expect(p.getSnapshot().status).toBe('playing')
    tick(3000)
    expect(p.getSnapshot().status).toBe('buffering')
    expect(events.some((e) => e.type === 'ended')).toBe(false)
    w.emit({ type: 'input', receivedBytes: 100, inputComplete: true })
    w.emit({ type: 'drained' })
    tick(3016)
    expect(events.filter((e) => e.type === 'ended')).toHaveLength(1)
    p.destroy()
    expect(w.terminate).toHaveBeenCalledTimes(1)
  })
  it('does not resume a paused loading attempt when frames arrive', async () => {
    const p = player(),
      loaded = p.load({ url: '/a.webp', resourceKey: 'a' })
    p.play()
    p.pause()
    FakeWorker.instances[0]!.emit(frame(0))
    await loaded
    tick(5000)
    expect(p.getSnapshot().status).toBe('paused')
    expect(draw).not.toHaveBeenCalled()
    p.destroy()
  })
  it('ignores events from a replaced resource and refuses fallback after drawing', async () => {
    const p = player(),
      old = p.load({ url: '/a.webp', resourceKey: 'a' }).catch(() => {})
    const w1 = FakeWorker.instances[0]!
    const fresh = p.load({ url: '/b.webp', resourceKey: 'b' })
    p.play()
    await old
    w1.emit(frame(99))
    tick(0)
    expect(draw).not.toHaveBeenCalled()
    const w2 = FakeWorker.instances[1]!
    w2.emit(frame(0))
    await fresh
    tick(1)
    const errors: PlayerEvent[] = []
    p.subscribe((e) => errors.push(e))
    w2.emit({ type: 'error', error: { code: 'budget', message: 'budget', recoverableByLegacy: true } })
    expect(errors.find((e) => e.type === 'error')).toMatchObject({ error: { recoverableByLegacy: false } })
    p.destroy()
  })
  it('does not emit completion for a new load triggered synchronously by an ended state observer', async () => {
    const p = player(),
      loaded = p.load({ url: '/a.webp', resourceKey: 'a' })
    p.play()
    const w = FakeWorker.instances[0]!
    w.emit(frame(0, 100))
    await loaded
    tick(0)
    let completed = 0
    p.subscribe((e) => {
      if (e.type === 'state' && e.snapshot.status === 'ended')
        void p.load({ url: '/b.webp', resourceKey: 'b' }).catch(() => {})
      if (e.type === 'ended') completed++
    })
    w.emit({ type: 'drained' })
    tick(100)
    expect(completed).toBe(0)
    expect(p.getSnapshot().status).toBe('loading')
    p.destroy()
  })
})
