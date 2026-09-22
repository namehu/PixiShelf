/** Build a temporary playback copy; never modify the archived WebP. */
export function createSingleLoopWebp(input: ArrayBuffer) {
  const bytes = new Uint8Array(input.slice(0))
  const view = new DataView(bytes.buffer)
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4))
  const invalid = () => new Error('无法读取 WebP 动画时长')
  if (bytes.length < 12 || tag(0) !== 'RIFF' || tag(8) !== 'WEBP') throw invalid()
  const end = view.getUint32(4, true) + 8
  if (end > bytes.length || end < 12) throw invalid()
  let animation = false
  let loopOffset: number | null = null
  let durationMs = 0
  let offset = 12
  while (offset < end) {
    if (offset + 8 > end) throw invalid()
    const kind = tag(offset)
    const size = view.getUint32(offset + 4, true)
    const start = offset + 8
    const next = start + size + (size % 2)
    if (next > end) throw invalid()
    if (kind === 'VP8X') {
      if (size !== 10) throw invalid()
      animation = (bytes[start]! & 2) !== 0
    } else if (kind === 'ANIM') {
      if (size !== 6 || loopOffset !== null) throw invalid()
      loopOffset = start + 4
    } else if (kind === 'ANMF') {
      if (size < 16 || loopOffset === null) throw invalid()
      const durationOffset = start + 12
      let duration = bytes[durationOffset]! | (bytes[durationOffset + 1]! << 8) | (bytes[durationOffset + 2]! << 16)
      // WebP leaves <=10ms implementation-defined. Normalize the playback copy
      // to the common browser 100ms delay so its frames and our clock agree.
      if (duration <= 10) {
        duration = 100
        bytes[durationOffset] = 100
        bytes[durationOffset + 1] = 0
        bytes[durationOffset + 2] = 0
      }
      durationMs += duration
    }
    offset = next
  }
  if (!animation || loopOffset === null || durationMs === 0) throw invalid()
  view.setUint16(loopOffset, 1, true)
  return { blob: new Blob([bytes], { type: 'image/webp' }), durationMs }
}
