import { describe, expect, it } from 'vitest'
import {
  ANIMATION_DURATION_CHUNK_LIMIT,
  parseWebpAnimationDuration
} from '../animation-duration-webp.ts'

function chunk(fourcc: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.write(fourcc, 0, 4, 'ascii')
  header.writeUInt32LE(payload.length, 4)
  return Buffer.concat([header, payload, ...(payload.length & 1 ? [Buffer.alloc(1)] : [])])
}

function webp(...chunks: Buffer[]): Buffer {
  const body = Buffer.concat([Buffer.from('WEBP'), ...chunks])
  const header = Buffer.alloc(8)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(body.length, 4)
  return Buffer.concat([header, body])
}

function animation(frames: number[], loopCount = 0): Buffer {
  const vp8x = Buffer.alloc(10)
  vp8x[0] = 0x02
  const anim = Buffer.alloc(6)
  anim.writeUInt16LE(loopCount, 4)
  return webp(
    chunk('VP8X', vp8x),
    chunk('ANIM', anim),
    ...frames.map((delay) => {
      const frame = Buffer.alloc(16)
      frame.writeUIntLE(delay, 12, 3)
      return chunk('ANMF', Buffer.concat([frame, chunk('VP8 ', Buffer.from([1]))]))
    })
  )
}

async function parse(buffer: Buffer) {
  const reads: Array<{ position: number; length: number }> = []
  const result = await parseWebpAnimationDuration({
    size: buffer.length,
    read: async (position, length) => {
      reads.push({ position, length })
      return buffer.subarray(position, position + length)
    }
  })
  return { result, reads }
}

describe('WebP animation duration parser', () => {
  it('sums one cycle, preserves infinite loop zero, and normalizes short frame delays', async () => {
    const { result } = await parse(animation([0, 1, 10, 11, 250], 0))
    expect(result).toMatchObject({
      status: 'READY', format: 'WEBP', durationMs: 561, frameCount: 5, loopCount: 0
    })
  })

  it('returns a persistent static result', async () => {
    const { result } = await parse(webp(chunk('VP8 ', Buffer.alloc(5))))
    expect(result).toMatchObject({ status: 'NOT_APPLICABLE', durationMs: null, frameCount: null })
  })

  it('skips compressed payload without reading it and limits the cache to 4 KiB', async () => {
    const bigPayload = Buffer.alloc(8 * 1024 * 1024)
    const file = webp(chunk('JUNK', bigPayload), chunk('VP8 ', Buffer.alloc(4)))
    const { result, reads } = await parse(file)
    expect(result.readBytes).toBeLessThan(8_192)
    expect(reads.every(({ length }) => length <= 4_096)).toBe(true)
    expect(reads.some(({ position }) => position >= 8 * 1024 * 1024)).toBe(true)
  })

  it('rejects inconsistent or truncated animation control and RIFF lengths', async () => {
    const noAnimControl = webp(chunk('ANMF', Buffer.concat([Buffer.alloc(16), chunk('VP8 ', Buffer.from([1]))])))
    await expect(parse(noAnimControl)).rejects.toMatchObject({ code: 'INVALID_WEBP' })
    const truncated = animation([40]).subarray(0, -1)
    await expect(parse(truncated)).rejects.toMatchObject({ code: 'TRUNCATED_WEBP' })
    const wrongFlag = animation([40])
    wrongFlag[20] = 0
    await expect(parse(wrongFlag)).rejects.toMatchObject({ code: 'INVALID_WEBP' })
  })

  it('bounds pathological chunk counts', async () => {
    const empty = chunk('JUNK', Buffer.alloc(0))
    const file = webp(...Array.from({ length: ANIMATION_DURATION_CHUNK_LIMIT + 1 }, () => empty))
    await expect(parse(file)).rejects.toMatchObject({ code: 'WEBP_CHUNK_LIMIT_EXCEEDED' })
  })

  it('stops at the logical read budget on a sparse virtual RIFF without loading the file', async () => {
    const stride = 8 + 4_096
    const chunkCount = 17_000
    const size = 12 + chunkCount * stride
    let requested = 0
    const reader = {
      size,
      read: async (position: number, length: number) => {
        expect(length).toBeLessThanOrEqual(4_096)
        requested += length
        const buffer = Buffer.alloc(length)
        if (position === 0) {
          buffer.write('RIFF', 0, 'ascii')
          buffer.writeUInt32LE(size - 8, 4)
          buffer.write('WEBP', 8, 'ascii')
        }
        const firstIndex = Math.max(0, Math.floor((position - 12) / stride))
        for (let index = firstIndex; index <= firstIndex + 1; index += 1) {
          const headerPosition = 12 + index * stride
          if (headerPosition < position || headerPosition + 8 > position + length) continue
          buffer.write('JUNK', headerPosition - position, 'ascii')
          buffer.writeUInt32LE(4_096, headerPosition - position + 4)
        }
        return buffer
      }
    }
    await expect(parseWebpAnimationDuration(reader)).rejects.toMatchObject({
      code: 'WEBP_READ_BUDGET_EXCEEDED'
    })
    expect(requested).toBeLessThanOrEqual(64 * 1024 * 1024)
  })

  it('rejects an animation frame with no image subchunk and RIFF with only unknown chunks', async () => {
    const file = animation([40])
    const frameImage = file.indexOf(Buffer.from('VP8 '))
    file.write('JUNK', frameImage, 'ascii')
    await expect(parse(file)).rejects.toMatchObject({ code: 'INVALID_WEBP' })
    await expect(parse(webp(chunk('JUNK', Buffer.alloc(8))))).rejects.toMatchObject({ code: 'INVALID_WEBP' })
  })
})
