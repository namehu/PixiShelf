import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { compareFileNamesNaturally } from '@/utils/artwork/natural-file-name-order'

function getFileName(mediaPath: string) {
  return mediaPath.replace(/\\/g, '/').split('/').pop() || mediaPath
}

export function sortMediaNaturally(images: ArtworkImageResponseDto[]) {
  return [...images].sort((left, right) => {
    const fileNameResult = compareFileNamesNaturally(getFileName(left.path), getFileName(right.path))
    if (fileNameResult !== 0) return fileNameResult

    const pathResult = compareFileNamesNaturally(left.path, right.path)
    return pathResult !== 0 ? pathResult : left.id - right.id
  })
}

export function getNaturalOrderRanks(images: ArtworkImageResponseDto[]) {
  return new Map(sortMediaNaturally(images).map((image, index) => [image.id, index]))
}

export function countNaturalOrderMismatches(images: ArtworkImageResponseDto[]) {
  const ranks = getNaturalOrderRanks(images)
  return images.reduce((count, image, index) => count + (ranks.get(image.id) === index ? 0 : 1), 0)
}

export function moveMediaItem(images: ArtworkImageResponseDto[], fromIndex: number, toIndex: number) {
  if (fromIndex === toIndex || fromIndex < 0 || fromIndex >= images.length) return images

  const targetIndex = Math.min(Math.max(toIndex, 0), images.length - 1)
  const next = [...images]
  const [item] = next.splice(fromIndex, 1)
  if (!item) return images
  next.splice(targetIndex, 0, item)
  return next
}

export function swapMediaItems(images: ArtworkImageResponseDto[], leftIndex: number, rightIndex: number) {
  if (leftIndex === rightIndex || !images[leftIndex] || !images[rightIndex]) return images
  const next = [...images]
  ;[next[leftIndex], next[rightIndex]] = [next[rightIndex]!, next[leftIndex]!]
  return next
}

export function haveSameMediaOrder(left: ArtworkImageResponseDto[], right: ArtworkImageResponseDto[]) {
  return left.length === right.length && left.every((image, index) => image.id === right[index]?.id)
}
