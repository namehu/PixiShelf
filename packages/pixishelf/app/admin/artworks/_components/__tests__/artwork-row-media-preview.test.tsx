import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtworkRowMediaPreview } from '../artwork-row-media-preview'

const mocks = vi.hoisted(() => ({
  query: {
    data: null as any,
    isLoading: false,
    refetch: vi.fn()
  },
  uploadOptions: null as any
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

vi.mock('../../_hooks/use-artwork-media-upload', () => ({
  useArtworkMediaUpload: (options: any) => {
    mocks.uploadOptions = options
    return {
      isDragging: false,
      dragZone: null,
      dragHandlers: {},
      addDialog: {
        open: false,
        onOpenChange: vi.fn(),
        onSubmit: vi.fn(),
        isSubmitting: false,
        progress: 0,
        defaultOrder: 1,
        initialFile: null
      },
      replaceDialog: {
        open: false,
        onOpenChange: vi.fn(),
        artworkId: options.artwork.id,
        artwork: options.artwork,
        onSuccess: options.onSuccess
      }
    }
  }
}))

vi.mock('../add-image-dialog', () => ({
  AddImageDialog: () => <div data-testid="add-image-dialog" />
}))

vi.mock('../image-replace-dialog', () => ({
  ImageReplaceDialog: () => <div data-testid="image-replace-dialog" />
}))

function artworkWithImages(count: number) {
  return {
    id: 42,
    title: '测试作品',
    externalId: 'work-42',
    images: Array.from({ length: count }, (_, index) => ({
      id: index + 1,
      path: `/artist/work/image-${index + 1}.jpg`,
      sortOrder: index + 1,
      width: 800,
      height: 600,
      size: 1024
    }))
  }
}

describe('ArtworkRowMediaPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.query.data = artworkWithImages(0)
    mocks.query.isLoading = false
    mocks.uploadOptions = null
  })

  it('renders an actionable drop target for an artwork without media', () => {
    render(<ArtworkRowMediaPreview artworkId={42} />)

    expect(screen.getByTestId('artwork-row-media-drop-target')).toBeTruthy()
    expect(screen.getByText('该作品没有媒体，可将文件拖到此处新增或替换')).toBeTruthy()
  })

  it('keeps the compact preview capped at ten media items', () => {
    mocks.query.data = artworkWithImages(12)
    render(<ArtworkRowMediaPreview artworkId={42} />)

    expect(screen.getByText('前 10 张媒体')).toBeTruthy()
    expect(screen.getAllByRole('img')).toHaveLength(10)
    expect(screen.queryByAltText('image-11.jpg')).toBeNull()
  })

  it('refetches the expanded preview and reloads the parent table after success', () => {
    const onSuccess = vi.fn()
    render(<ArtworkRowMediaPreview artworkId={42} onSuccess={onSuccess} />)

    act(() => {
      mocks.uploadOptions.onSuccess()
    })

    expect(mocks.query.refetch).toHaveBeenCalledOnce()
    expect(onSuccess).toHaveBeenCalledOnce()
  })
})
