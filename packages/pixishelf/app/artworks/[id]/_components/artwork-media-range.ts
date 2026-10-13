import type { Range } from '@tanstack/react-virtual'

/** Bound preloading by both reading distance and item count, including very short images. */
export function getArtworkMediaRange(range: Range, viewportHeight: number, getSize: (index: number) => number) {
  const start = Math.max(0, range.startIndex - 2)
  let end = range.endIndex
  let distance = 0
  const limit = Math.min(range.count - 1, range.endIndex + 12)
  while (end < limit && distance < Math.max(1, viewportHeight) * 2) {
    end += 1
    distance += Math.max(1, getSize(end))
  }
  return Array.from({ length: end - start + 1 }, (_, offset) => start + offset)
}
