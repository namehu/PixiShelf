import { describe, expect, it } from 'vitest'
import { buildArtworkStacks } from '@/lib/reading/artwork-stacks'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { projectArtworkStacks } from '../artwork-stack-projection'

const images = Array.from({ length: 12 }, (_, index) => ({ id: index + 1, sortOrder: index } as ArtworkImageResponseDto))
const groups = buildArtworkStacks(images.map((image, index) => ({ mediaId: image.id, memberMediaIds: [image.id], index, mediaType: 'image', isAnimated: false })))
describe('stack projection', () => {
  it('keeps frozen original boundaries and shows remaining unread members', () => {
    const filtered = images.filter((image) => [2, 4, 7, 9].includes(image.id))
    const result = projectArtworkStacks(filtered, groups, new Map())
    expect(result.images.map((image) => image.id)).toEqual([2, 7, 9])
    expect(result.decorations.get(2)).toMatchObject({ mediaIds: [2, 4], activeIndex: 0, group: { mediaIds: [1, 2, 3, 4] } })
  })
  it('keeps the frame cover stable while changing the active image', () => {
    const result = projectArtworkStacks(images, groups, new Map([[groups[0]!.id, 4]]))
    expect(result.images.map((image) => image.id)).toEqual([4, 5, 9])
    expect(result.decorations.get(4)).toMatchObject({ cover: { id: 1 }, activeIndex: 3 })
  })
  it('falls back to the first remaining member after a filter without repacking groups', () => {
    const result = projectArtworkStacks(images.filter((image) => image.id !== 4), groups, new Map([[groups[0]!.id, 4]]))
    expect(result.images.map((image) => image.id)).toEqual([1, 5, 9])
    expect(result.decorations.get(1)?.group).toEqual(groups[0])
  })
})
