import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { ImageManagerThumbnailList } from '../thumbnail-list'
import type { ImageListItem } from '../../types'

vi.mock('../columns', () => ({
  ImageMediaActions: () => <div data-testid="image-media-actions" />,
  ImageVideoMetadataEntry: () => <div data-testid="image-video-metadata" />
}))

vi.mock('../../lazy-image', () => ({
  LazyImage: ({ alt, className }: any) => <div data-testid="lazy-image" aria-label={alt} className={className} />
}))

vi.mock('next/image', () => ({
  default: ({ fill, priority, ...props }: any) => (
    <img {...props} data-fill={fill ? 'true' : undefined} data-priority={priority ? 'true' : undefined} />
  )
}))

function image(overrides: Partial<ImageListItem>): ImageListItem {
  return {
    id: 1,
    path: '/artist/work/1_p0.jpg',
    sortOrder: 0,
    width: 1200,
    height: 800,
    size: 1024,
    ...overrides
  }
}

describe('ImageManagerThumbnailList', () => {
  test('renders thumbnails as a multi-column square grid with gap 5', () => {
    render(
      <ImageManagerThumbnailList
        imageList={[image({ id: 1 }), image({ id: 2, path: '/artist/work/1_p1.jpg', sortOrder: 1 })]}
        refreshKey={1}
        reprobingImageId={null}
        videoOptimizationJobsByImageId={{}}
        startingVideoOptimizationImageId={null}
        onPreviewIndexChange={vi.fn()}
        onOpenVideoMetadata={vi.fn()}
        onDownload={vi.fn()}
        onOpenChapterDialog={vi.fn()}
        onDownloadChapters={vi.fn()}
        onDeleteChapter={vi.fn()}
        onReprobeVideo={vi.fn()}
        onStartVideoOptimization={vi.fn()}
        onCancelVideoOptimization={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByTestId('image-manager-thumbnail-grid').className).toContain('grid')
    expect(screen.getByTestId('image-manager-thumbnail-grid').className).toContain('gap-5')
    expect(screen.getAllByTestId('image-manager-thumbnail-card')).toHaveLength(2)
    expect(screen.getAllByTestId('image-manager-thumbnail-media')[0]!.className).toContain('aspect-square')
  })

  test('renders a static video poster first and only mounts the player after clicking play', () => {
    const { container } = render(
      <ImageManagerThumbnailList
        imageList={[
          image({
            id: 10,
            path: '/artist/work/video.mp4',
            mediaType: 'video',
            posterUrl: '/_video-posters/10-cover.webp?v=1'
          })
        ]}
        refreshKey={2}
        reprobingImageId={null}
        videoOptimizationJobsByImageId={{}}
        startingVideoOptimizationImageId={null}
        onPreviewIndexChange={vi.fn()}
        onOpenVideoMetadata={vi.fn()}
        onDownload={vi.fn()}
        onOpenChapterDialog={vi.fn()}
        onDownloadChapters={vi.fn()}
        onDeleteChapter={vi.fn()}
        onReprobeVideo={vi.fn()}
        onStartVideoOptimization={vi.fn()}
        onCancelVideoOptimization={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(container.querySelector('video')).toBeNull()
    expect(container.querySelector('img')?.getAttribute('src')).toContain('/_video-posters/10-cover.webp')

    fireEvent.click(screen.getByTestId('video-thumbnail-play'))

    expect(container.querySelector('video')).not.toBeNull()
    expect(screen.queryByTestId('video-thumbnail-play')).toBeNull()
  })

  test('opens an image preview through a named native button', () => {
    const onPreviewIndexChange = vi.fn()
    render(
      <ImageManagerThumbnailList
        imageList={[image({ id: 3, path: '/artist/work/preview.jpg' })]}
        refreshKey={1}
        reprobingImageId={null}
        videoOptimizationJobsByImageId={{}}
        startingVideoOptimizationImageId={null}
        onPreviewIndexChange={onPreviewIndexChange}
        onOpenVideoMetadata={vi.fn()}
        onDownload={vi.fn()}
        onOpenChapterDialog={vi.fn()}
        onDownloadChapters={vi.fn()}
        onDeleteChapter={vi.fn()}
        onReprobeVideo={vi.fn()}
        onStartVideoOptimization={vi.fn()}
        onCancelVideoOptimization={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '预览 preview.jpg' }))
    expect(onPreviewIndexChange).toHaveBeenCalledWith(0)
  })
})
