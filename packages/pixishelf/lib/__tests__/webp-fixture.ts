// Container-only fixture for metadata tests; deliberately contains no encoded pixels.
export function webpFixture(durations: number[], loop = 0) {
  const chunk = (name: string, payload: Uint8Array) => {
    const result = new Uint8Array(8 + payload.length + (payload.length % 2))
    result.set([...name].map((value) => value.charCodeAt(0)))
    new DataView(result.buffer).setUint32(4, payload.length, true)
    result.set(payload, 8)
    return result
  }
  const header = new Uint8Array(10)
  header[0] = 2
  const animation = new Uint8Array(6)
  new DataView(animation.buffer).setUint16(4, loop, true)
  const chunks = [
    chunk('VP8X', header),
    chunk('JUNK', new Uint8Array(3)),
    chunk('ANIM', animation),
    ...durations.map((duration) => {
      const frame = new Uint8Array(16)
      frame[12] = duration & 255
      frame[13] = (duration >> 8) & 255
      frame[14] = (duration >> 16) & 255
      return chunk('ANMF', frame)
    })
  ]
  const result = new Uint8Array(12 + chunks.reduce((size, value) => size + value.length, 0))
  result.set([...'RIFF'].map((value) => value.charCodeAt(0)))
  new DataView(result.buffer).setUint32(4, result.length - 8, true)
  result.set(
    [...'WEBP'].map((value) => value.charCodeAt(0)),
    8
  )
  let offset = 12
  for (const value of chunks) {
    result.set(value, offset)
    offset += value.length
  }
  return result.buffer
}
