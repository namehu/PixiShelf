import { expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { independentHeader, independentFrame } from '../independent-frame'
import { MediaClock } from '../media-clock'
import { ReplayInput } from '../replay-input'
const fixture = new Uint8Array(readFileSync(new URL('../../tests/fixtures/independent.webp', import.meta.url)))
it('checks every frame, not just the first eligible frame', () => {
  const header = independentHeader(fixture.slice(0, 44))!
  const chunk = fixture.slice(44, 52),
    size = new DataView(chunk.buffer).getUint32(4, true)
  const body = fixture.slice(52, 52 + size + (size % 2))
  expect(independentFrame(header, chunk, body)?.durationMs).toBe(40)
  for (const [offset, value] of [
    [0, 1],
    [6, 2],
    [15, 0],
    [16, 0],
    [27, 0]
  ]) {
    const changed = body.slice()
    changed[offset!] = value!
    expect(independentFrame(header, chunk, changed)).toBeNull()
  }
  const short = body.slice()
  short.fill(0, 12, 15)
  expect(independentFrame(header, chunk, short)?.durationMs).toBe(100)
})
it('media time advances without frames, freezes at input horizon and excludes pauses', () => {
  const clock = new MediaClock()
  clock.start(100)
  expect(clock.tick(150, 300)).toBe(50)
  expect(clock.tick(1000, 100)).toBe(100)
  clock.tick(1100, 100)
  expect(clock.tick(1110, 500)).toBe(110)
  clock.pause(1120, 500)
  expect(clock.peek(9000, 500)).toBe(120)
  clock.resume(9000)
  expect(clock.tick(9010, 500)).toBe(130)
})
it('one-byte streamed input is retained in bounded blocks and can be replayed', async () => {
  let offset = 0
  const stream = new ReadableStream<Uint8Array>({
    pull(c) {
      if (offset === fixture.length) c.close()
      else c.enqueue(fixture.slice(offset, ++offset))
    }
  })
  const input = new ReplayInput(stream.getReader(), 4096, () => {})
  expect(await input.take(44)).toEqual(fixture.slice(0, 44))
  expect(await input.take(fixture.length - 44)).toEqual(fixture.slice(44))
  await input.eof()
  expect(input.chunks.length).toBe(1)
  input.rewind()
  expect(await input.take(fixture.length)).toEqual(fixture)
})
it('requires a real EOF and rejects trailing bytes and input limits', async () => {
  const make = (limit: number) =>
    new ReplayInput(
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(fixture)
          c.close()
        }
      }).getReader(),
      limit,
      () => {}
    )
  const input = make(4096)
  await input.take(44)
  await expect(input.eof()).rejects.toThrow('invalid')
  await expect(make(10).take(44)).rejects.toThrow('file-limit')
})
