import { render, screen } from '@testing-library/react'
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
        onPreviewIndexChange={vi.fn()}
        onOpenVideoMetadata={vi.fn()}
        onDownload={vi.fn()}
        onOpenChapterDialog={vi.fn()}
        onDownloadChapters={vi.fn()}
        onDeleteChapter={vi.fn()}
        onReprobeVideo={vi.fn()}
        onDelete={vi.fn()}
      />
    )

    expect(screen.getByTestId('image-manager-thumbnail-grid').className).toContain('grid')
    expect(screen.getByTestId('image-manager-thumbnail-grid').className).toContain('gap-5')
    expect(screen.getAllByTestId('image-manager-thumbnail-card')).toHaveLength(2)
    expect(screen.getAllByTestId('image-manager-thumbnail-media')[0]!.className).toContain('aspect-square')
  })
})
