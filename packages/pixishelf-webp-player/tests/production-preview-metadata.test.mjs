import test from 'node:test'
import assert from 'node:assert/strict'
import { parseFullFrames, frameBlob } from '../experiments/full-frame-webp.mjs'
const chunk = (tag, payload) => {
  const b = Buffer.alloc(8 + payload.length + (payload.length % 2))
  b.write(tag)
  b.writeUInt32LE(payload.length, 4)
  payload.copy(b, 8)
  return b
}
function sample({ flags = 2, frameFlags = 2, width = 2, x = 0, duration = 17, metadata = false } = {}) {
  const ext = Buffer.alloc(10)
  ext[0] = flags
  ext.writeUIntLE(width - 1, 4, 3)
  ext.writeUIntLE(1, 7, 3)
  const frame = Buffer.alloc(16)
  frame.writeUIntLE(x, 0, 3)
  frame.writeUIntLE(1, 6, 3)
  frame.writeUIntLE(1, 9, 3)
  frame.writeUIntLE(duration, 12, 3)
  frame[15] = frameFlags
  const vp8 = Buffer.from([0, 0, 0, 0x9d, 1, 0x2a, 2, 0, 2, 0])
  const body = Buffer.concat([
    Buffer.from('WEBP'),
    chunk('VP8X', ext),
    chunk('ANIM', Buffer.alloc(6)),
    chunk('ANMF', Buffer.concat([frame, chunk('VP8 ', vp8)])),
    ...(metadata ? [chunk('ICCP', Buffer.alloc(2))] : [])
  ])
  const file = chunk('RIFF', body)
  return file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength)
}
test('extracts an independent still WebP without changing frame duration', async () => {
  const input = sample()
  const parsed = parseFullFrames(input)
  assert.equal(parsed.frames[0].durationMs, 17)
  const blob = await frameBlob(input, parsed.frames[0]).arrayBuffer()
  const b = Buffer.from(blob)
  assert.equal(b.toString('ascii', 0, 4), 'RIFF')
  assert.equal(b.readUInt32LE(4) + 8, b.length)
  assert.equal(b.toString('ascii', 8, 16), 'WEBPVP8 ')
})
test('normalizes short durations and permits unused global alpha flag', () => {
  assert.equal(parseFullFrames(sample({ duration: 10, flags: 18 })).frames[0].durationMs, 100)
})
test('rejects partial, blended, disposal, profile and pixel budget cases', () => {
  for (const options of [
    { x: 1 },
    { width: 3 },
    { frameFlags: 0 },
    { frameFlags: 3 },
    { metadata: true },
    { flags: 34 }
  ])
    assert.throws(() => parseFullFrames(sample(options)))
  assert.throws(() => parseFullFrames(sample(), 3))
})
test('rejects truncation, trailing data, huge chunk and mismatched VP8 dimensions', () => {
  const input = sample()
  assert.throws(() => parseFullFrames(input.slice(0, -1)))
  const trailing = new Uint8Array(input.byteLength + 1)
  trailing.set(new Uint8Array(input))
  assert.throws(() => parseFullFrames(trailing.buffer))
  const bad = input.slice(0)
  new DataView(bad).setUint32(48, 0xffffffff, true)
  assert.throws(() => parseFullFrames(bad))
  const dimensions = input.slice(0)
  new Uint8Array(dimensions)[dimensions.byteLength - 4] = 3
  assert.throws(() => parseFullFrames(dimensions))
})

