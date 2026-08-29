import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchivePublishedMediaPreview } from '../archive-published-media-preview'

const mocks = vi.hoisted(() => ({
  query: {
    data: null as any,
    isLoading: false,
    isError: false
  }
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => mocks.query
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    artwork: {
      getById: { queryOptions: (artworkId: number) => ({ queryKey: ['artwork', artworkId] }) }
    }
  })
}))

vi.mock('@/components/media/media-thumbnail', () => ({
  MediaThumbnail: ({ media, alt }: { media: { path: string }; alt: string }) => (
    // oxlint-disable-next-line nextjs/no-img-element
    <img src={`/thumbnail${media.path}`} alt={alt} />
  )
}))

function artworkWithImages(count: number) {
  return {
    id: 42,
    title: '已发布作品',
    images: Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      path: `/published/image-${index + 1}.jpg`,
      sortOrder: index,
      width: 800,
      height: 600,
      size: 1024
    }))
  }
}

describe('ArchivePublishedMediaPreview', () => {
  beforeEach(() => {
    mocks.query.data = artworkWithImages(12)
    mocks.query.isLoading = false
    mocks.query.isError = false
  })

  afterEach(() => cleanup())

  it('loads only the first ten current published media items', () => {
    render(<ArchivePublishedMediaPreview artworkId={42} />)

    expect(screen.getByTestId('archive-published-media-preview')).toBeTruthy()
    expect(screen.getByText('前 10 张媒体')).toBeTruthy()
    expect(screen.getAllByRole('img')).toHaveLength(10)
    expect(screen.getByAltText('image-1.jpg').getAttribute('src')).toBe('/thumbnail/published/image-1.jpg')
    expect(screen.queryByAltText('image-11.jpg')).toBeNull()
  })

  it('shows explicit loading, error, and empty states', () => {
    mocks.query.isLoading = true
    const { rerender } = render(<ArchivePublishedMediaPreview artworkId={42} />)
    expect(screen.getByText('加载已发布媒体…')).toBeTruthy()

    mocks.query.isLoading = false
    mocks.query.isError = true
    mocks.query.data = null
    rerender(<ArchivePublishedMediaPreview artworkId={42} />)
    expect(screen.getByText('已发布媒体暂时无法加载，请稍后重试。')).toBeTruthy()

    mocks.query.isError = false
    mocks.query.data = artworkWithImages(0)
    rerender(<ArchivePublishedMediaPreview artworkId={42} />)
    expect(screen.getByText('该已发布作品没有媒体')).toBeTruthy()
  })
})
