import { act, cleanup, render } from '@testing-library/react'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type VideoPlayer from '@/components/players/video-player'
import { ReadingCollector } from '@/lib/reading/reading-collector'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'
import type { ReadingContextDto, ReadingReportInput } from '@pixishelf/db/reading-contract'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { ArtworkMediaSection } from '../artwork-media-section'

const mocks = vi.hoisted(() => ({
  reading: null as ArtworkReadingHandle | null,
  player: null as ComponentProps<typeof VideoPlayer> | null,
  intersection: null as ((visible: boolean) => void) | null
}))

vi.mock('next/navigation', () => ({ usePathname: () => '/artworks/7', useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/reading/reading-provider', () => ({ useArtworkReading: () => mocks.reading }))
vi.mock('@/lib/reading/artwork-reader-provider', () => ({
  useArtworkReader: () => null,
  useReaderMediaWindow: () => {}
}))
vi.mock('../artwork-summary-context', () => ({ useArtworkSummary: () => null }))
vi.mock('../artwork-detail-controls', () => ({ useArtworkDetailControls: () => null }))
vi.mock('../artwork-video-optimization-context', () => ({
  ArtworkVideoOptimizationProvider: ({ children }: { children: ReactNode }) => children,
  useArtworkVideoOptimization: () => ({ suspendPlayback: false, canManage: false })
}))
vi.mock('@/components/players/video-player', () => ({
  default: (props: ComponentProps<typeof VideoPlayer>) => {
    mocks.player = props
    return <div data-testid="video-player" />
  }
}))
vi.mock('react-intersection-observer', () => ({
  useOnInView: (callback: (visible: boolean) => void, options?: { rootMargin?: string }) => {
    if (!options?.rootMargin) mocks.intersection = callback
    return vi.fn()
  }
}))

const media = {
  id: 11, path: '/video.mp4', mediaType: 'video', updatedAt: '2026-10-30T00:00:00.000Z',
  width: 1280, height: 720, size: 100
} as ArtworkImageResponseDto

let collector: ReadingCollector
let context: ReadingContextDto
let top: number
const report = vi.fn(async (input: ReadingReportInput) => {
  expect(input.expectedUserId).toBe('reader')
  return { mediaRevision: 1, seenMediaIds: [], summary: context.summary }
})
const completed = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  top = 100
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    top, bottom: top + 360, left: 0, right: 640, width: 640, height: 360, x: 0, y: top, toJSON() {}
  }))
  window.history.replaceState({}, '', '/artworks/7?entry=direct')
  context = {
    artworkId: 7, mediaRevision: 1, seenMediaIds: [], resume: null,
    media: [{ mediaId: 11, memberMediaIds: [11], index: 0, isVideo: true }],
    summary: { artworkId: 7, mediaRevision: 1, stateVersion: 0, viewCount: 0, seenCount: 0,
      totalCount: 1, status: 'UNREAD', lastViewedAt: null, lastActiveAt: null, lastMediaId: null, lastMediaIndex: null }
  }
  collector = new ReadingCollector({ report, onCompleted: completed })
  collector.setAccount('reader')
  collector.setContext(context, 'reader')
  mocks.reading = {
    ownerUserId: 'reader', context, summary: context.summary,
    observe: (surfaceId, observation) => collector.observe(surfaceId, { ...observation, artworkId: 7 }),
    clearSurface: (surfaceId) => collector.clearSurface(surfaceId)
  } as ArtworkReadingHandle
})

afterEach(() => {
  cleanup()
  collector.dispose()
  useArtworkAutoBrowseStore.getState().initialize(7)
  report.mockClear()
  completed.mockClear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it.each([90, 100])('records a single video at position %s through the real detail layout and reading collector', async (position) => {
  render(<ArtworkMediaSection images={[media]} artworkId={7} />)
  act(() => mocks.intersection?.(true))
  act(() => mocks.player?.onReady?.())
  expect(collector.projectContext(context).summary.status).toBe('UNREAD')
  act(() => mocks.player?.onReadingProgress?.({ currentTime: 1, duration: 100, started: true, playing: true }))
  expect(collector.projectContext(context).summary).toMatchObject({ status: 'IN_PROGRESS', seenCount: 0 })
  act(() => mocks.player?.onReadingProgress?.({ currentTime: 89, duration: 100, started: true, playing: true }))
  expect(completed).not.toHaveBeenCalled()
  act(() => mocks.player?.onReadingProgress?.({ currentTime: position, duration: 100, started: true, playing: position < 100 }))
  expect(collector.projectContext(context).summary).toMatchObject({ status: 'COMPLETED', seenCount: 1 })
  expect(completed).toHaveBeenCalledTimes(1)
  act(() => mocks.player?.onReadingProgress?.({ currentTime: 0, duration: 100, started: true, playing: true }))
  expect(collector.projectContext(context).summary.status).toBe('COMPLETED')
  await collector.flush()
  expect(report.mock.lastCall?.[0].events).toMatchObject([
    { type: 'VIEW', mediaId: 11, playback: { currentTime: 1, duration: 100 } },
    { type: 'VIEW', mediaId: 11, playback: { currentTime: position, duration: 100 } }
  ])
})

it('still rejects offscreen video observations when an intersection callback is stale', async () => {
  render(<ArtworkMediaSection images={[media]} artworkId={7} />)
  act(() => mocks.intersection?.(true))
  act(() => mocks.player?.onReady?.())
  top = window.innerHeight + 100
  act(() => mocks.player?.onReadingProgress?.({ currentTime: 100, duration: 100, started: true, playing: false }))
  expect(collector.projectContext(context).summary.status).toBe('UNREAD')
  expect(completed).not.toHaveBeenCalled()
  await collector.flush()
  expect(report).not.toHaveBeenCalled()
})
