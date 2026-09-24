import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import type { ReadingContextDto, ReadingReportInput } from '@pixishelf/db/reading-contract'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'
import { ReadingCollector } from '@/lib/reading/reading-collector'
import AdaptiveMediaPreview from '../adaptive-media-preview'
import ArtworkPreviewPage from '../../../preview/page'

const previewState = vi.hoisted(() => ({ reading: null as unknown, images: [] as unknown[] }))

vi.mock('next/image', () => ({
  default: ({ src, alt, onLoad, onError }: {
    src: string
    alt: string
    onLoad?: React.ReactEventHandler<HTMLImageElement>
    onError?: React.ReactEventHandler<HTMLImageElement>
  }) => <img src={src} alt={alt} onLoad={onLoad} onError={onError} /> // oxlint-disable-line nextjs/no-img-element
}))
vi.mock('@/components/source-preview/vertical-media-preview-core', () => ({
  VerticalMediaPreviewCore: ({ items, renderSlide }: {
    items: unknown[]
    renderSlide: (item: unknown, context: { index: number; active: boolean; eager: boolean }) => React.ReactNode
  }) => <div>{items.map((item, index) => <div key={index}>{renderSlide(item, { index, active: index === 0, eager: true })}</div>)}</div>
}))
vi.mock('../use-artwork-animation', () => ({
  useArtworkAnimation: () => ({ playing: false, playOnce: false, stopManual: vi.fn(), onPlayingChange: vi.fn() })
}))
vi.mock('../use-artwork-slideshow', () => ({ useArtworkSlideshow: () => undefined }))
vi.mock('swiper/react', () => ({
  Swiper: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SwiperSlide: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))
vi.mock('nuqs', () => ({
  parseAsInteger: { withDefault: () => ({}) },
  useQueryState: (key: string) => [key === 'artworkId' ? 1 : 0, vi.fn()]
}))
vi.mock('@/lib/trpc', () => ({ useTRPC: () => ({ artwork: { getById: { queryOptions: () => ({}) } } }) }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { images: previewState.images }, isLoading: false })
}))
vi.mock('@/components/auth/auth-provider', () => ({}))
vi.mock('@/lib/reading/reading-provider', () => ({ useArtworkReading: () => previewState.reading }))
vi.mock('@/store/use-artwork-store', () => ({ useArtworkStore: (selector: (state: { clearImages: () => void }) => unknown) =>
  selector({ clearImages: () => undefined }) }))
vi.mock('@/hooks/use-safe-back', () => ({ useSafeBack: () => vi.fn() }))

const media = (id: number): ArtworkImageResponseDto => ({
  id,
  artworkId: 1,
  path: `/media-${id}.jpg`,
  width: 1200,
  height: 1800,
  size: 1024,
  sortOrder: id - 1,
  createdAt: '2026-01-01 00:00:00',
  updatedAt: '2026-01-01 00:00:00',
  webpAnimationStatus: null,
  animationMetadata: null,
  chaptersPath: null,
  chaptersCount: 0,
  chaptersDuration: null,
  chaptersUpdatedAt: null,
  chaptersHash: null,
  mediaType: 'image',
  hasChapters: false,
  chaptersUrl: null
})

const images = [media(1), media(2)]
const context: ReadingContextDto = {
  artworkId: 1,
  mediaRevision: 1,
  media: images.map((item, index) => ({ mediaId: item.id, memberMediaIds: [item.id], index })),
  summary: {
    artworkId: 1, viewCount: 0, seenCount: 0, totalCount: 2, status: 'UNREAD',
    lastViewedAt: null, lastActiveAt: null, lastMediaId: null, lastMediaIndex: null
  },
  resume: null
}

function createReading() {
  const report = vi.fn(async (input: ReadingReportInput) => {
    expect(input.expectedUserId).toBe('user-1')
    return { mediaRevision: 1, summary: context.summary }
  })
  const collector = new ReadingCollector({ report })
  collector.setAccount('user-1')
  collector.setContext(context, 'user-1')
  const clearSurface = vi.fn((surfaceId: string) => collector.clearSurface(surfaceId))
  const reading = {
    observe: (surfaceId: string, observation: Parameters<ReadingCollector['observe']>[1]) =>
      collector.observe(surfaceId, { ...observation, artworkId: 1 }),
    clearSurface,
    observationEpoch: 0,
    invalidated: false,
    reopen: vi.fn()
  } as unknown as ArtworkReadingHandle
  return { collector, report, clearSurface, reading }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'))
  previewState.images = images
})

afterEach(() => {
  cleanup()
  previewState.reading = null
  vi.useRealTimers()
})

async function assertNeighborDoesNotResetDwell(
  activeAlt: string,
  neighborAlt: string,
  collector: ReadingCollector,
  report: ReturnType<typeof vi.fn>,
  clearSurface: ReturnType<typeof vi.fn>
) {
  fireEvent.load(screen.getByAltText(activeAlt))
  const clearsAfterReady = clearSurface.mock.calls.length
  await act(async () => { await vi.advanceTimersByTimeAsync(250) })
  fireEvent.load(screen.getByAltText(neighborAlt))
  expect(clearSurface).toHaveBeenCalledTimes(clearsAfterReady)
  await act(async () => { await vi.advanceTimersByTimeAsync(250) })
  await collector.flush()
  expect(report).toHaveBeenCalledTimes(1)
  expect(report.mock.calls[0]?.[0].events).toMatchObject([{ type: 'VIEW', mediaId: 1 }])
  collector.dispose()
}

describe('reading dwell while neighboring media preloads', () => {
  it('keeps the original preview observation alive', async () => {
    const { collector, report, clearSurface, reading } = createReading()
    previewState.reading = reading
    render(<ArtworkPreviewPage />)
    await assertNeighborDoesNotResetDwell('Preview 0', 'Preview 1', collector, report, clearSurface)
  })

  it('keeps the adaptive preview observation alive', async () => {
    const { collector, report, clearSurface, reading } = createReading()
    render(<AdaptiveMediaPreview images={images} initialIndex={0} open onClose={vi.fn()} reading={reading} />)
    await assertNeighborDoesNotResetDwell('作品媒体 1', '作品媒体 2', collector, report, clearSurface)
  })
})
