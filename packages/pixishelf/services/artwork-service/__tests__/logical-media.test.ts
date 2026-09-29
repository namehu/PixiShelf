import { describe, expect, it } from 'vitest'
import { groupLogicalMedia } from '../logical-media'

describe('groupLogicalMedia', () => {
  it('maps the complete sequence and preserves APNG membership when a matching video appears', () => {
    const media = [
      { id: 1, path: '/art/a.apng', mediaType: 'ANIMATION' },
      { id: 2, path: '/art/b.jpg', mediaType: 'IMAGE' },
      { id: 3, path: '/art/a.webm', mediaType: 'VIDEO' }
    ]
    expect(groupLogicalMedia(media).map(({ item, members }) => ({ id: item.id, members: members.map(({ id }) => id) }))).toEqual([
      { id: 2, members: [2] },
      { id: 3, members: [3, 1] }
    ])
  })
})
