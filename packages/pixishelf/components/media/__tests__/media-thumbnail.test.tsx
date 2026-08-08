import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MediaThumbnail from '@/components/media/MediaThumbnail'

vi.mock('next/image', () => ({
  default: ({ fill, priority, ...props }: any) => (
    <img {...props} data-fill={fill ? 'true' : undefined} data-priority={priority ? 'true' : undefined} />
  )
}))

afterEach(cleanup)

describe('MediaThumbnail', () => {
  it('renders a generated poster for video media', () => {
    render(
      <MediaThumbnail
        media={{ path: '/artist/work/video.mp4', mediaType: 'video', posterUrl: '/_video-posters/1.webp' }}
        alt="video cover"
        width={100}
        height={100}
      />
    )

    expect(screen.getByRole('img', { name: 'video cover' }).getAttribute('src')).toBe('/_video-posters/1.webp')
  })

  it('renders a placeholder instead of the original video when the poster is missing', () => {
    const { container } = render(
      <MediaThumbnail
        media={{ path: '/artist/work/video.mp4', mediaType: 'video', posterUrl: null }}
        alt="video cover"
        width={100}
        height={100}
      />
    )

    expect(screen.getByTestId('media-thumbnail-placeholder').textContent).toContain('封面待生成')
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('video')).toBeNull()
  })
})
