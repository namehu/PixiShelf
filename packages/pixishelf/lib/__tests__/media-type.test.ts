import { describe, expect, it } from 'vitest'
import { inferMediaTypeFromPath } from '../media-type'

describe('inferMediaTypeFromPath', () => {
  it.each([
    ['/artist/work/video.WEBM', 'VIDEO'],
    ['/artist/work/video.mp4?version=2', 'VIDEO'],
    ['/artist/work/animation.apng', 'ANIMATION'],
    ['/artist/work/animation.GIF', 'ANIMATION'],
    ['/artist/work/page.webp', 'IMAGE'],
    ['/artist/work/page.jpg', 'IMAGE'],
    ['/artist/work/archive.bin', 'UNKNOWN']
  ])('classifies %s as %s', (mediaPath, expected) => {
    expect(inferMediaTypeFromPath(mediaPath)).toBe(expected)
  })
})
