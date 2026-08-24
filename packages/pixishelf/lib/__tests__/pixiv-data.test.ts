import { describe, expect, it } from 'vitest'
import {
  buildPixivArtistAvatarUrl,
  buildPixivArtistBackgroundUrl,
  buildPixivTagImageUrl,
  isPixivDataRoot
} from '../pixiv-data'

describe('Pixiv data URLs', () => {
  it('builds explicit authenticated API URLs for artist and tag images', () => {
    expect(buildPixivArtistAvatarUrl('123', 'avatar image.jpg')).toBe('/api/pixiv-data/artists/123/avatar%20image.jpg')
    expect(buildPixivArtistBackgroundUrl('123', 'background.png')).toBe('/api/pixiv-data/artists/123/background.png')
    expect(buildPixivTagImageUrl('/cover.webp')).toBe('/api/pixiv-data/tags/cover.webp')
  })

  it('rejects missing or unsafe path segments', () => {
    expect(buildPixivArtistAvatarUrl('123', '../avatar.jpg')).toBe('')
    expect(buildPixivArtistBackgroundUrl('123/456', 'background.png')).toBe('')
    expect(buildPixivTagImageUrl('nested/cover.webp')).toBe('')
    expect(buildPixivTagImageUrl(null)).toBe('')
  })

  it('shares the allowed storage roots with the API route', () => {
    expect(isPixivDataRoot('artists')).toBe(true)
    expect(isPixivDataRoot('tags')).toBe(true)
    expect(isPixivDataRoot('other')).toBe(false)
  })
})
