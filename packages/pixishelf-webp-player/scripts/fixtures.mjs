import sharp from 'sharp'
import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
process.chdir(fileURLToPath(new URL('../', import.meta.url)))
const u24 = (buffer, offset, n) => {
  buffer[offset] = n & 255
  buffer[offset + 1] = (n >> 8) & 255
  buffer[offset + 2] = (n >> 16) & 255
}
const chunk = (kind, bytes) => {
  const h = Buffer.alloc(8)
  h.write(kind)
  h.writeUInt32LE(bytes.length, 4)
  return Buffer.concat([h, bytes, ...(bytes.length % 2 ? [Buffer.alloc(1)] : [])])
}
async function frame(width, height, color, { x = 0, y = 0, duration = 150, flags = 0, lossless = true } = {}) {
  const image = await sharp({ create: { width, height, channels: 4, background: color } })
    .webp({ lossless })
    .toBuffer()
  const parts = []
  for (let i = 12; i < image.length; ) {
    const length = image.readUInt32LE(i + 4),
      end = i + 8 + length + (length % 2)
    if (['VP8 ', 'VP8L', 'ALPH'].includes(image.toString('ascii', i, i + 4))) parts.push(image.subarray(i, end))
    i = end
  }
  const h = Buffer.alloc(16)
  u24(h, 0, x / 2)
  u24(h, 3, y / 2)
  u24(h, 6, width - 1)
  u24(h, 9, height - 1)
  u24(h, 12, duration)
  h[15] = flags
  return chunk('ANMF', Buffer.concat([h, ...parts]))
}
function animation(width, height, frames, extraFlags = 0) {
  const extended = Buffer.alloc(10)
  extended[0] = 0x12 | extraFlags
  u24(extended, 4, width - 1)
  u24(extended, 7, height - 1)
  const body = Buffer.concat([Buffer.from('WEBP'), chunk('VP8X', extended), chunk('ANIM', Buffer.alloc(6)), ...frames])
  const h = Buffer.alloc(8)
  h.write('RIFF')
  h.writeUInt32LE(body.length, 4)
  return Buffer.concat([h, body])
}
await mkdir('tests/fixtures', { recursive: true })
const frames = [
  await frame(8, 8, { r: 255, g: 0, b: 0, alpha: 1 }),
  await frame(4, 4, { r: 0, g: 255, b: 0, alpha: 0.5 }, { x: 2, y: 2, flags: 1 }),
  await frame(3, 3, { r: 0, g: 0, b: 255, alpha: 1 }, { x: 4, y: 4, flags: 2, duration: 400 }),
  await frame(8, 8, { r: 255, g: 255, b: 0, alpha: 1 }, { duration: 300, lossless: false })
]
const sample = animation(8, 8, frames)
await writeFile('tests/fixtures/composite.webp', sample)
await writeFile('tests/fixtures/truncated.webp', sample.subarray(0, sample.length - 7))
await writeFile(
  'tests/fixtures/short.webp',
  animation(8, 8, [await frame(8, 8, { r: 5, g: 50, b: 100, alpha: 1 }, { duration: 0 })])
)
const metadata = animation(8, 8, frames, 0x08)
await writeFile('tests/fixtures/metadata.webp', metadata)
// First two frames arrive immediately; the server withholds the rest of the RIFF.
await writeFile(
  'tests/fixtures/manifest.json',
  JSON.stringify({ gateOffset: 44 + frames[0].length + frames[1].length, frames: 4 }, null, 2) + '\n'
)
const benchmark = []
for (let i = 0; i < 240; i++)
  benchmark.push(
    await frame(
      1920,
      1080,
      { r: (i * 31) % 256, g: (i * 67) % 256, b: (i * 11) % 256, alpha: 1 },
      { duration: i % 3 === 0 ? 42 : 41, lossless: false }
    )
  )
await writeFile('tests/fixtures/benchmark.webp', animation(1920, 1080, benchmark))
