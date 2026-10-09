/** Conservative fast path. Every frame is checked, including after playback starts. */
export const MiB = 1024 * 1024
export const INDEPENDENT_HEAP = 128 * MiB
export const FRAME_LIMIT = 2 * MiB
export const INPUT_BLOCK_LIMIT = 8 * MiB
export interface IndependentHeader {
  width: number
  height: number
  totalBytes: number
  loops: number
}
export interface EncodedFrame {
  encoded: ArrayBuffer
  width: number
  height: number
  index: number
  cycleId: number
  cycleStartMs: number
  startMs: number
  endMs: number
  durationMs: number
}
const tag = (b: Uint8Array, p: number) => String.fromCharCode(...b.subarray(p, p + 4))
const u24 = (b: Uint8Array, p: number) => b[p]! + b[p + 1]! * 256 + b[p + 2]! * 65536
/** Classification after the initial VP8X/ANIM in an animation. Declared metadata
 * flags are rejected by independentHeader before this fast-path helper is used. */
export function independentChunkKind(chunk: Uint8Array): 'frame' | 'unknown' | 'ignored' | 'invalid' {
  if (chunk.length !== 8) throw new RangeError('Expected an eight-byte RIFF chunk header')
  const kind = tag(chunk, 0)
  if (kind === 'ANMF') return 'frame'
  if (['VP8X', 'ALPH', 'VP8 ', 'VP8L'].includes(kind)) return 'invalid'
  if (kind === 'ANIM') {
    const size = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength).getUint32(4, true)
    // Match libwebp 1.6.0 ParseVP8XChunks, which checks padded payload size.
    return size + (size % 2) >= 6 ? 'ignored' : 'invalid'
  }
  if (['ICCP', 'EXIF', 'XMP '].includes(kind)) return 'ignored'
  return 'unknown'
}
export function independentHeader(b: Uint8Array): IndependentHeader | null {
  if (b.length !== 44) return null
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (
    tag(b, 0) !== 'RIFF' ||
    tag(b, 8) !== 'WEBP' ||
    tag(b, 12) !== 'VP8X' ||
    v.getUint32(16, true) !== 10 ||
    (b[20]! & ~16) !== 2 ||
    b[21] ||
    b[22] ||
    b[23] ||
    tag(b, 30) !== 'ANIM' ||
    v.getUint32(34, true) !== 6
  )
    return null
  return {
    width: u24(b, 24) + 1,
    height: u24(b, 27) + 1,
    totalBytes: v.getUint32(4, true) + 8,
    loops: v.getUint16(42, true)
  }
}
export function independentFrame(header: IndependentHeader, chunk: Uint8Array, body: Uint8Array) {
  const v = new DataView(chunk.buffer, chunk.byteOffset, chunk.byteLength)
  const size = v.getUint32(4, true)
  if (tag(chunk, 0) !== 'ANMF' || size < 34 || body.length !== size + (size % 2) || (size % 2 && body[size] !== 0))
    return null
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength)
  if (
    u24(body, 0) ||
    u24(body, 3) ||
    u24(body, 6) + 1 !== header.width ||
    u24(body, 9) + 1 !== header.height ||
    // Opaque full-canvas VP8 overwrites every pixel even with blending enabled.
    (body[15] !== 0 && body[15] !== 2) ||
    tag(body, 16) !== 'VP8 '
  )
    return null
  const length = view.getUint32(20, true)
  if (
    length < 10 ||
    24 + length + (length % 2) !== size ||
    (length % 2 && body[24 + length] !== 0) ||
    body[24]! & 1 ||
    body[27] !== 0x9d ||
    body[28] !== 1 ||
    body[29] !== 0x2a ||
    (view.getUint16(30, true) & 0x3fff) !== header.width ||
    (view.getUint16(32, true) & 0x3fff) !== header.height
  )
    return null
  const encoded = new Uint8Array(12 + size - 16)
  encoded.set([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])
  new DataView(encoded.buffer).setUint32(4, encoded.length - 8, true)
  encoded.set(body.subarray(16, size), 12)
  const duration = u24(body, 12)
  return { encoded: encoded.buffer, durationMs: duration <= 10 ? 100 : duration }
}
