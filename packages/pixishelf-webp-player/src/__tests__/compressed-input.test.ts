import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { CompressedInputCache, CACHE_BLOCK } from '../compressed-input'
import { openPortInput } from '../port-input'
import { playerLimits } from '../types'

const prefix = readFileSync(new URL('../../tests/fixtures/independent.webp', import.meta.url)).subarray(0, 44)
let calls: string[], clock: number
const pools: CompressedInputCache[] = []
const limits = playerLimits(true)
const url = (id: string) => `http://localhost/api/v1/images/${id}.webp?v=one`
function pool() {
  const p = new CompressedInputCache(() => clock)
  pools.push(p)
  return p
}
function source(
  size: number,
  options: { chunk?: number; status?: number; length?: boolean; truncate?: number; dimensions?: [number, number] } = {}
) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (key: string) => {
      calls.push(key)
      let position = 0
      const header = Uint8Array.from(prefix)
      new DataView(header.buffer).setUint32(4, size - 8, true)
      if (options.dimensions) {
        for (const [i, dimension] of options.dimensions.entries()) {
          const value = dimension - 1
          header.set([value & 255, (value >>> 8) & 255, value >>> 16], 24 + i * 3)
        }
      }
      const response = new Response(
        new ReadableStream({
          pull(controller) {
            if (position === size - (options.truncate ?? 0)) {
              controller.close()
              return
            }
            const n = Math.min(options.chunk ?? CACHE_BLOCK, size - (options.truncate ?? 0) - position)
            const bytes = new Uint8Array(n).fill(19)
            for (let i = position; i < Math.min(position + n, header.length); i++) bytes[i - position] = header[i]!
            position += n
            controller.enqueue(bytes)
          }
        }),
        { status: options.status ?? 200, headers: options.length === false ? {} : { 'content-length': String(size) } }
      )
      Object.defineProperty(response, 'url', { value: key })
      return response
    })
  )
}
async function consume(p: CompressedInputCache, id: string, validate = true) {
  const lease = p.connect(url(id), limits, () => {})
  const { reader, limits: actual } = await openPortInput(lease.port)
  let bytes = 0,
    checksum = 0
  while (true) {
    const item = await reader.read()
    if (item.done) break
    bytes += item.value.length
    for (const b of item.value) checksum = (checksum + b) >>> 0
  }
  if (validate) lease.validate()
  lease.release()
  return { bytes, checksum, actual }
}
beforeEach(() => {
  calls = []
  clock = 0
  vi.stubGlobal('location', { href: 'http://localhost/', origin: 'http://localhost' })
})
afterEach(() => {
  pools.splice(0).forEach((p) => p.clear())
  vi.unstubAllGlobals()
})

it('reuses exact bytes including partial final block and isolates URL versions; requires validated EOF', async () => {
  source(CACHE_BLOCK + 123, { chunk: 7 })
  const p = pool(),
    first = await consume(p, 'a'),
    second = await consume(p, 'a')
  expect(second).toEqual(first)
  expect(first.bytes).toBe(CACHE_BLOCK + 123)
  expect(calls).toHaveLength(1)
  expect(p.getSnapshot()).toMatchObject({ hits: 1, entries: 1, reservedBytes: 2 * CACHE_BLOCK })
  await consume(p, 'b', false)
  await consume(p, 'b')
  expect(calls).toHaveLength(3)
  clock = 300_001
  await consume(p, 'a')
  expect(calls).toHaveLength(4)
})
it('keeps A/B/C/A within the byte budget and evicts LRU at the entry limit', async () => {
  source(128)
  const p = pool()
  for (const id of ['a', 'b', 'c', 'a', 'd', 'e', 'f', 'g', 'h', 'i']) await consume(p, id)
  expect(calls).toHaveLength(9)
  expect(p.getSnapshot().entries).toBe(8)
  await consume(p, 'a')
  expect(calls).toHaveLength(9)
  await consume(p, 'b')
  expect(calls).toHaveLength(10)
})
it('supports 50MiB compressed input, and reserves backing bytes before constructing it', async () => {
  source(50 * 1024 ** 2, { dimensions: [1040, 1568] })
  const p = pool(),
    lease = p.connect(url('large'), limits, () => {})
  const { reader, limits: actual } = await openPortInput(lease.port)
  expect(p.getSnapshot().reservedBytes).toBe(50 * 1024 ** 2)
  expect(actual.maxManagedBytes).toBeLessThan(limits.maxManagedBytes)
  let n = 0
  while (true) {
    const item = await reader.read()
    if (item.done) break
    n += item.value.length
  }
  expect(n).toBe(50 * 1024 ** 2)
  lease.validate()
  lease.release()
  expect(p.getSnapshot().entries).toBe(1)
}, 20000)
it('evicts by actual bytes before the entry limit and includes the active decoder reservation', async () => {
  source(20 * 1024 ** 2, { dimensions: [1040, 1568] })
  const p = pool()
  for (const id of ['a', 'b', 'c', 'a', 'd', 'e']) {
    const run = await consume(p, id)
    expect(run.actual.maxManagedBytes + p.getSnapshot().reservedBytes).toBeLessThan(limits.maxManagedBytes)
    expect(p.getSnapshot().reservedBytes).toBeLessThanOrEqual(80 * 1024 ** 2)
  }
  expect(calls).toHaveLength(5)
  expect(p.getSnapshot().entries).toBe(4)
  await consume(p, 'a')
  expect(calls).toHaveLength(5)
  await consume(p, 'b')
  expect(calls).toHaveLength(6)
  // A 50MiB file at this resolution fits, but retaining a second one would exceed the managed budget.
  source(50 * 1024 ** 2, { dimensions: [1040, 1568] })
  await consume(p, 'large-a')
  await consume(p, 'large-b')
  expect(p.getSnapshot()).toMatchObject({ entries: 1, reservedBytes: 50 * 1024 ** 2 })
}, 20000)
it('bypasses unknown length/206/oversize or insufficient budget and does not retain a partial input', async () => {
  const p = pool()
  source(64 * 1024 ** 2)
  const boundary = p.connect(url('boundary'), limits, () => {})
  await openPortInput(boundary.port)
  expect(p.getSnapshot().reservedBytes).toBe(64 * 1024 ** 2)
  boundary.release()
  expect(p.getSnapshot().entries).toBe(0)
  for (const options of [{ length: false }, { status: 206 }, { truncate: 1 }]) {
    source(128, options)
    await consume(p, 'a')
    expect(p.getSnapshot().entries).toBe(0)
  }
  source(65 * 1024 ** 2)
  const lease = p.connect(url('big'), limits, () => {})
  const input = await openPortInput(lease.port)
  expect(p.getSnapshot().reservedBytes).toBe(0)
  expect(input.limits).toEqual(limits)
  lease.release()
  source(128)
  const tiny = p.connect(url('small-budget'), { ...limits, maxManagedBytes: 1000 }, () => {})
  const opened = await openPortInput(tiny.port)
  expect(opened.limits.maxManagedBytes).toBe(1000)
  expect(p.getSnapshot().entries).toBe(0)
  tiny.release()
})
it('cancel, clear and late validation cannot revive an entry; hidden discards unfinished cache', async () => {
  source(CACHE_BLOCK * 3)
  const p = pool(),
    revoked = vi.fn(),
    lease = p.connect(url('a'), limits, revoked)
  const { reader } = await openPortInput(lease.port)
  await reader.read()
  p.trim()
  expect(p.getSnapshot().entries).toBe(0)
  p.clear()
  lease.validate()
  expect(revoked).toHaveBeenCalledOnce()
  expect(p.getSnapshot().reservedBytes).toBe(0)
  lease.release()
})
it('version changes miss and authentication errors clear previously complete entries', async () => {
  source(128)
  const p = pool()
  await consume(p, 'a')
  const lease = p.connect(url('a').replace('one', 'two'), limits, () => {})
  const { reader } = await openPortInput(lease.port)
  while (!(await reader.read()).done) {
    /* drain */
  }
  lease.validate()
  lease.release()
  expect(calls).toHaveLength(2)
  source(128, { status: 403 })
  const denied = p.connect(url('denied'), limits, () => {})
  await expect(openPortInput(denied.port)).rejects.toMatchObject({ code: 'auth' })
  expect(p.getSnapshot().entries).toBe(0)
  denied.release()
})
