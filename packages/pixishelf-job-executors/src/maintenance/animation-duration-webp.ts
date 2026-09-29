export const ANIMATION_DURATION_TIMING_POLICY_VERSION = 1
export const ANIMATION_DURATION_READ_LIMIT = 64 * 1024 * 1024
export const ANIMATION_DURATION_CHUNK_LIMIT = 100_000
export const ANIMATION_DURATION_CACHE_BYTES = 4 * 1024

export type AnimationDurationProbeFailureCode =
  | 'INVALID_WEBP'
  | 'TRUNCATED_WEBP'
  | 'WEBP_READ_BUDGET_EXCEEDED'
  | 'WEBP_CHUNK_LIMIT_EXCEEDED'
  | 'UNSUPPORTED_WEBP_ANIMATION'

export class AnimationDurationProbeError extends Error {
  constructor(readonly code: AnimationDurationProbeFailureCode, message: string) {
    super(message)
    this.name = 'AnimationDurationProbeError'
  }
}

export interface AnimationDurationReader {
  size: number
  read(position: number, length: number): Promise<Buffer>
}

export interface WebpDurationResult {
  status: 'READY' | 'NOT_APPLICABLE'
  format: 'WEBP'
  durationMs: number | null
  frameCount: number | null
  loopCount: number | null
  readBytes: number
  readOperations: number
  chunks: number
}

/** Read only RIFF headers and animation control bytes; frame payloads are skipped by offset. */
export async function parseWebpAnimationDuration(reader: AnimationDurationReader): Promise<WebpDurationResult> {
  // Keep this function self-contained so the exact same parser can run in the
  // isolated child using its JavaScript function source.
  const failure = (code: AnimationDurationProbeFailureCode, message: string): never => {
    const error = new Error(message) as Error & { code: string }
    error.code = code
    throw error
  }
  const size = reader.size
  if (!Number.isSafeInteger(size) || size < 12) failure('TRUNCATED_WEBP', 'WebP RIFF header is truncated')
  let cacheStart = -1
  let cache: Buffer = Buffer.alloc(0)
  let readBytes = 0
  let readOperations = 0
  let chunks = 0
  const read = async (position: number, length: number): Promise<Buffer> => {
    if (!Number.isSafeInteger(position) || !Number.isSafeInteger(length) || length < 0 || position + length > size) {
      return failure('TRUNCATED_WEBP', 'WebP chunk extends beyond the file')
    }
    if (position >= cacheStart && position + length <= cacheStart + cache.length) {
      return cache.subarray(position - cacheStart, position - cacheStart + length)
    }
    const amount = Math.min(ANIMATION_DURATION_CACHE_BYTES, size - position)
    if (readBytes + amount > ANIMATION_DURATION_READ_LIMIT) {
      return failure('WEBP_READ_BUDGET_EXCEEDED', 'WebP logical read budget exceeded')
    }
    const data = await reader.read(position, amount)
    readOperations += 1
    readBytes += data.length
    if (data.length !== amount) return failure('TRUNCATED_WEBP', 'WebP file changed during read')
    cacheStart = position
    cache = data
    return cache.subarray(0, length)
  }
  const header = await read(0, 12)
  if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WEBP') {
    return failure('INVALID_WEBP', 'Expected RIFF WEBP header')
  }
  const riffEnd = header.readUInt32LE(4) + 8
  if (riffEnd > size) return failure('TRUNCATED_WEBP', 'WebP RIFF size exceeds the file')
  if (riffEnd < 20 || riffEnd % 2 !== 0) return failure('INVALID_WEBP', 'Invalid WebP RIFF size')
  let position = 12
  let hasAnimationFlag = false
  let hasAnimationControl = false
  let hasExtendedHeader = false
  let loopCount: number | null = null
  let frameCount = 0
  let durationMs = 0
  let staticImageChunk = false
  while (position < riffEnd) {
    if (++chunks > ANIMATION_DURATION_CHUNK_LIMIT) {
      return failure('WEBP_CHUNK_LIMIT_EXCEEDED', 'WebP chunk count budget exceeded')
    }
    if (position + 8 > riffEnd) return failure('TRUNCATED_WEBP', 'WebP chunk header is truncated')
    const chunk = await read(position, 8)
    const fourcc = chunk.toString('ascii', 0, 4)
    const length = chunk.readUInt32LE(4)
    const next = position + 8 + length + (length & 1)
    if (!Number.isSafeInteger(next) || next > riffEnd) {
      return failure('TRUNCATED_WEBP', 'WebP chunk payload exceeds RIFF boundary')
    }
    if (fourcc === 'VP8X') {
      if (hasExtendedHeader || position !== 12 || length !== 10) {
        return failure('INVALID_WEBP', 'Invalid WebP extended header')
      }
      hasExtendedHeader = true
      hasAnimationFlag = ((await read(position + 8, 1))[0]! & 0x02) !== 0
    } else if (fourcc === 'ANIM') {
      if (hasAnimationControl || length !== 6 || frameCount > 0) {
        return failure('INVALID_WEBP', 'Invalid WebP animation control chunk')
      }
      hasAnimationControl = true
      loopCount = (await read(position + 8, 6)).readUInt16LE(4)
    } else if (fourcc === 'ANMF') {
      if (!hasAnimationControl || length < 25) {
        return failure('INVALID_WEBP', 'Invalid WebP animation frame chunk')
      }
      const frameHeader = await read(position + 8, 16)
      const frameEnd = position + 8 + length
      let framePosition = position + 24
      let hasFrameImage = false
      while (framePosition < frameEnd) {
        if (++chunks > ANIMATION_DURATION_CHUNK_LIMIT) {
          return failure('WEBP_CHUNK_LIMIT_EXCEEDED', 'WebP chunk count budget exceeded')
        }
        if (framePosition + 8 > frameEnd) return failure('TRUNCATED_WEBP', 'WebP frame subchunk is truncated')
        const subchunk = await read(framePosition, 8)
        const subType = subchunk.toString('ascii', 0, 4)
        const subLength = subchunk.readUInt32LE(4)
        const subNext = framePosition + 8 + subLength + (subLength & 1)
        if (subNext > frameEnd) return failure('TRUNCATED_WEBP', 'WebP frame subchunk exceeds its frame')
        if (subType === 'VP8 ' || subType === 'VP8L') {
          if (hasFrameImage || subLength === 0) return failure('INVALID_WEBP', 'Invalid WebP frame image chunk')
          hasFrameImage = true
        }
        framePosition = subNext
      }
      if (!hasFrameImage) return failure('INVALID_WEBP', 'WebP frame has no image chunk')
      const rawDuration = frameHeader.readUIntLE(12, 3)
      // WebP playback policy: nonpositive and <=10 ms frame delays are 100 ms.
      durationMs += rawDuration <= 10 ? 100 : rawDuration
      if (!Number.isSafeInteger(durationMs)) {
        return failure('UNSUPPORTED_WEBP_ANIMATION', 'WebP duration exceeds the safe integer range')
      }
      frameCount += 1
    } else if (fourcc === 'VP8 ' || fourcc === 'VP8L') {
      if (staticImageChunk || length === 0) return failure('INVALID_WEBP', 'Invalid WebP static image chunk')
      staticImageChunk = true
    }
    position = next
  }
  if (hasAnimationFlag || hasAnimationControl || frameCount > 0) {
    if (!hasExtendedHeader || !hasAnimationFlag || !hasAnimationControl || frameCount === 0 || loopCount === null || staticImageChunk) {
      return failure('INVALID_WEBP', 'WebP animation chunks are inconsistent')
    }
    return { status: 'READY', format: 'WEBP', durationMs, frameCount, loopCount, readBytes, readOperations, chunks }
  }
  if (!staticImageChunk) return failure('INVALID_WEBP', 'WebP has no image chunk')
  return {
    status: 'NOT_APPLICABLE', format: 'WEBP', durationMs: null, frameCount: null, loopCount: null,
    readBytes, readOperations, chunks
  }
}
