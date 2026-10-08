// Experimental eligibility gate: opaque full-canvas VP8 frames only.
// Reject everything requiring compositing or color-profile interpretation.
export function parseFullFrames(buffer, maxPixels = 4_000_000) {
  const bytes = new Uint8Array(buffer),
    view = new DataView(buffer)
  const four = (p) => String.fromCharCode(...bytes.subarray(p, p + 4))
  const u24 = (p) => bytes[p] + bytes[p + 1] * 256 + bytes[p + 2] * 65536
  const invalid = () => {
    throw new Error('Unsupported experimental WebP layout')
  }
  if (bytes.length < 30 || four(0) !== 'RIFF' || four(8) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length)
    invalid()
  let width = 0,
    height = 0,
    animation = false
  const frames = []
  for (let p = 12; p < bytes.length; ) {
    if (p + 8 > bytes.length) invalid()
    const size = view.getUint32(p + 4, true),
      end = p + 8 + size,
      next = end + (size % 2)
    if (next > bytes.length || (size % 2 && bytes[end] !== 0)) invalid()
    const tag = four(p),
      start = p + 8
    if (tag === 'VP8X') {
      if (
        p !== 12 ||
        size !== 10 ||
        (bytes[start] & ~16) !== 2 ||
        bytes[start + 1] ||
        bytes[start + 2] ||
        bytes[start + 3]
      )
        invalid()
      width = u24(start + 4) + 1
      height = u24(start + 7) + 1
      if (width * height > maxPixels) invalid()
    } else if (tag === 'ANIM') {
      if (!width || animation || frames.length || size !== 6) invalid()
      animation = true
    } else if (tag === 'ANMF') {
      if (
        !animation ||
        size < 34 ||
        u24(start) ||
        u24(start + 3) ||
        u24(start + 6) + 1 !== width ||
        u24(start + 9) + 1 !== height ||
        bytes[start + 15] !== 2
      )
        invalid()
      const payload = start + 16,
        vp8Size = view.getUint32(payload + 4, true)
      if (four(payload) !== 'VP8 ' || payload + 8 + vp8Size + (vp8Size % 2) !== end || vp8Size < 10) invalid()
      const vp8 = payload + 8
      if (
        bytes[vp8] & 1 ||
        bytes[vp8 + 3] !== 0x9d ||
        bytes[vp8 + 4] !== 1 ||
        bytes[vp8 + 5] !== 0x2a ||
        (view.getUint16(vp8 + 6, true) & 0x3fff) !== width ||
        (view.getUint16(vp8 + 8, true) & 0x3fff) !== height
      )
        invalid()
      const duration = u24(start + 12)
      frames.push({ offset: payload, length: end - payload, durationMs: duration <= 10 ? 100 : duration })
    } else invalid()
    p = next
  }
  if (!frames.length) invalid()
  return { width, height, frames }
}
export function frameBlob(buffer, frame) {
  const header = new Uint8Array(12)
  header.set([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])
  new DataView(header.buffer).setUint32(4, frame.length + 4, true)
  return new Blob([header, new Uint8Array(buffer, frame.offset, frame.length)], { type: 'image/webp' })
}

/** Synchronous compressed-byte wrapper; no Blob task or native image decode. */
export function frameBytes(buffer, frame) {
  const bytes = new Uint8Array(12 + frame.length)
  bytes.set([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80])
  new DataView(bytes.buffer).setUint32(4, frame.length + 4, true)
  bytes.set(new Uint8Array(buffer, frame.offset, frame.length), 12)
  return bytes.buffer
}
