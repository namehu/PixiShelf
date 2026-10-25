/** Offline pilot only. Deliberately not exported by the executor package. */
export const VISUAL_EXPERIMENT_VERSION = 'dct63-grid3-v1'
export const VISUAL_NORMALIZATION_VERSION = 'exif-srgb-white-gray96-lanczos3-v1'

export interface VisualFeature {
  width: number
  height: number
  hashes: string[]
  information: number[]
}
export interface VisualParameters {
  globalDistance: number
  localDistance: number
  agreeingRegions: number
  localGlobalCeiling: number
  minimumInformation: number
  aspectTolerance: number
}
export const VISUAL_PARAMETER_PRESETS: readonly VisualParameters[] = [
  {
    globalDistance: 8,
    localDistance: 8,
    agreeingRegions: 8,
    localGlobalCeiling: 24,
    minimumInformation: 8,
    aspectTolerance: 0.08
  },
  {
    globalDistance: 12,
    localDistance: 10,
    agreeingRegions: 7,
    localGlobalCeiling: 28,
    minimumInformation: 8,
    aspectTolerance: 0.08
  },
  {
    globalDistance: 16,
    localDistance: 12,
    agreeingRegions: 6,
    localGlobalCeiling: 32,
    minimumInformation: 8,
    aspectTolerance: 0.08
  }
]
const cosine = Array.from({ length: 8 }, (_, u) =>
  Array.from({ length: 32 }, (_, x) => Math.cos(((2 * x + 1) * u * Math.PI) / 64))
)

/** 32x32 DCT, upper 8x8 AC coefficients; DC excluded and bit 63 reserved. */
export function dctHash(pixels: Uint8Array): { hash: string; information: number } {
  if (pixels.length !== 1024) throw new Error('Expected 32x32 grayscale')
  const mean = pixels.reduce((sum, p) => sum + p, 0) / 1024
  const information = Math.sqrt(pixels.reduce((sum, p) => sum + (p - mean) ** 2, 0) / 1024)
  const horizontal = new Float64Array(32 * 8)
  for (let y = 0; y < 32; y++)
    for (let u = 0; u < 8; u++) {
      let value = 0
      for (let x = 0; x < 32; x++) value += pixels[y * 32 + x]! * cosine[u]![x]!
      horizontal[y * 8 + u] = value
    }
  const ac: number[] = []
  for (let v = 0; v < 8; v++)
    for (let u = 0; u < 8; u++) {
      if (!u && !v) continue
      let value = 0
      for (let y = 0; y < 32; y++) value += horizontal[y * 8 + u]! * cosine[v]![y]!
      ac.push(value)
    }
  const median = [...ac].sort((a, b) => a - b)[31]!
  let bits = 0n
  ac.forEach((value, i) => {
    if (value > median) bits |= 1n << BigInt(i)
  })
  return { hash: bits.toString(16).padStart(16, '0'), information }
}

export function featureFromGray96(gray: Uint8Array, width: number, height: number): VisualFeature {
  if (gray.length !== 96 * 96 || width < 1 || height < 1) throw new Error('Invalid normalized image')
  const regions = Array.from({ length: 10 }, () => new Uint8Array(1024))
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      let sum = 0
      for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) sum += gray[(y * 3 + dy) * 96 + x * 3 + dx]!
      regions[0]![y * 32 + x] = Math.round(sum / 9)
      for (let r = 0; r < 9; r++)
        regions[r + 1]![y * 32 + x] = gray[(Math.floor(r / 3) * 32 + y) * 96 + (r % 3) * 32 + x]!
    }
  const results = regions.map(dctHash)
  return { width, height, hashes: results.map((r) => r.hash), information: results.map((r) => r.information) }
}
export function hamming(a: string, b: string): number {
  let bits = BigInt(`0x${a}`) ^ BigInt(`0x${b}`)
  let count = 0
  while (bits) {
    bits &= bits - 1n
    count++
  }
  return count
}
export function compareVisual(a: VisualFeature, b: VisualFeature, p: VisualParameters, local: boolean) {
  const globalDistance = hamming(a.hashes[0]!, b.hashes[0]!)
  const agreeingRegions = a.hashes
    .slice(1)
    .reduce(
      (count, hash, i) =>
        count +
        Number(
          Math.min(a.information[i + 1]!, b.information[i + 1]!) >= p.minimumInformation &&
            hamming(hash, b.hashes[i + 1]!) <= p.localDistance
        ),
      0
    )
  const eligible =
    Math.min(a.information[0]!, b.information[0]!) >= p.minimumInformation &&
    Math.abs(Math.log(a.width / a.height / (b.width / b.height))) <= p.aspectTolerance
  return {
    matched:
      eligible &&
      (globalDistance <= p.globalDistance ||
        (local && globalDistance <= p.localGlobalCeiling && agreeingRegions >= p.agreeingRegions)),
    globalDistance,
    agreeingRegions
  }
}

/** Maximum-cardinality assignment; ambiguity remains explicit, never semantic truth. */
export function pairPages(adjacency: readonly (readonly number[])[], rightCount: number) {
  const owner = new Int32Array(rightCount).fill(-1)
  const degrees = new Uint32Array(rightCount)
  for (const targets of adjacency)
    for (const right of new Set(targets)) {
      if (!Number.isInteger(right) || right < 0 || right >= rightCount) throw new Error('Invalid page index')
      degrees[right] = degrees[right]! + 1
    }
  function assign(left: number, seen: Uint8Array): boolean {
    for (const right of adjacency[left]!) {
      if (seen[right]) continue
      seen[right] = 1
      if (owner[right] === -1 || assign(owner[right]!, seen)) {
        owner[right] = left
        return true
      }
    }
    return false
  }
  for (let left = 0; left < adjacency.length; left++) assign(left, new Uint8Array(rightCount))
  const pairs = [...owner].flatMap((left, right) => (left === -1 ? [] : [{ left, right }]))
  return {
    pairs,
    matched: pairs.length,
    leftUnmatched: adjacency.length - pairs.length,
    rightUnmatched: rightCount - pairs.length,
    ambiguousLeft: adjacency.filter((a) => new Set(a).size > 1).length,
    ambiguousRight: [...degrees].filter((d) => d > 1).length
  }
}
