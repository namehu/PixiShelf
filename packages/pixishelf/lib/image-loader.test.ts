import { describe, expect, it } from 'vitest'
import imgproxyLoader from '@/lib/image-loader'

describe('imgproxyLoader', () => {
  it('outputs jpg for webp and gif sources', () => {
    expect(imgproxyLoader({ src: '/1000/static.webp', width: 640, quality: 80 })).toBe(
      'http://localhost:5431/_/rs:fit:640:0/q:80/sm:1/plain/local://%2F1000%2Fstatic.webp@jpg'
    )
    expect(imgproxyLoader({ src: '/1000/animated.gif', width: 640, quality: 80 })).toBe(
      'http://localhost:5431/_/rs:fit:640:0/q:80/sm:1/plain/local://%2F1000%2Fanimated.gif@jpg'
    )
  })

  it('keeps ordinary images on webp output', () => {
    expect(imgproxyLoader({ src: '/1000/image.jpg', width: 640, quality: 80 })).toBe(
      'http://localhost:5431/_/rs:fit:640:0/q:80/sm:1/plain/local://%2F1000%2Fimage.jpg@webp'
    )
  })
})
