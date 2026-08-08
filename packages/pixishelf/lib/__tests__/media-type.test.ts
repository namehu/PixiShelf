import { describe, expect, it } from 'vitest'
import { inferMediaTypeFromPath, needsAnimationContentScan } from '../media-type'

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

  it.each(['/work/image.webp', '/work/image.gif', '/work/image.png', '/work/image.apng'])(
    'queues ambiguous animation format %s for content scanning',
    (mediaPath) => {
      expect(needsAnimationContentScan(mediaPath)).toBe(true)
    }
  )

  it('does not queue unambiguous formats for animation scanning', () => {
    expect(needsAnimationContentScan('/work/image.jpg')).toBe(false)
    expect(needsAnimationContentScan('/work/video.webm')).toBe(false)
  })
})
