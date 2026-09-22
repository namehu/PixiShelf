import { describe, expect, it } from 'vitest'
import { createSingleLoopWebp } from '../single-loop-webp'
import { webpFixture } from './webp-fixture'

async function readBlob(blob: Blob) {
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = reject
    reader.readAsArrayBuffer(blob)
  })
}

describe('single-loop WebP playback copy', () => {
  it.each([0, 7])('sums variable frame times and replaces loop count %i without changing the input', async (loop) => {
    const input = webpFixture([40, 120, 2300], loop)
    const original = input.slice(0)
    const result = createSingleLoopWebp(input)
    expect(result.durationMs).toBe(2460)
    expect(result.blob.type).toBe('image/webp')
    const copy = await readBlob(result.blob)
    expect(new DataView(copy).getUint16(54, true)).toBe(1)
    expect(new Uint8Array(input)).toEqual(new Uint8Array(original))
  })

  it('normalizes implementation-defined short frame delays in both the data and total', async () => {
    const result = createSingleLoopWebp(webpFixture([0, 10, 11]))
    expect(result.durationMs).toBe(211)
    const copy = await readBlob(result.blob)
    expect(new Uint8Array(copy)[76]).toBe(100)
    expect(createSingleLoopWebp(copy).durationMs).toBe(211)
  })

  it('rejects truncated containers, oversized chunks, static images and missing frames', () => {
    const valid = webpFixture([50])
    expect(() => createSingleLoopWebp(valid.slice(0, -1))).toThrow()
    const malformed = valid.slice(0)
    new DataView(malformed).setUint32(16, 0xffffffff, true)
    expect(() => createSingleLoopWebp(malformed)).toThrow()
    const staticImage = valid.slice(0)
    new Uint8Array(staticImage)[20] = 0
    expect(() => createSingleLoopWebp(staticImage)).toThrow()
    expect(() => createSingleLoopWebp(webpFixture([]))).toThrow()
    expect(() => createSingleLoopWebp(new ArrayBuffer(10))).toThrow()
  })
})
