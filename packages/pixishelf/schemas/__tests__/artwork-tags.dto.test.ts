import { describe, expect, it } from 'vitest'
import { ArtworkUpdateTagsSchema } from '../artwork-tags.dto'

describe('artwork tag editing input', () => {
  it('trims names and deduplicates each submitted delta once at the boundary', () => {
    expect(
      ArtworkUpdateTagsSchema.parse({
        artworkId: 1,
        addTagIds: [2, 2],
        removeTagIds: [3, 3],
        newTagNames: [' 新标签 ', '新标签', 'New', 'new']
      })
    ).toEqual({ artworkId: 1, addTagIds: [2], removeTagIds: [3], newTagNames: ['新标签', 'New', 'new'] })
  })

  it.each([
    { artworkId: 0 },
    { artworkId: 1.2 },
    { artworkId: 1, addTagIds: [-1] },
    { artworkId: 1, removeTagIds: [2_147_483_648] },
    { artworkId: 1, newTagNames: ['  '] },
    { artworkId: 1, addTagIds: [2], removeTagIds: [2] }
  ])('rejects invalid input without entering the service: %j', (input) => {
    expect(ArtworkUpdateTagsSchema.safeParse(input).success).toBe(false)
  })
})
