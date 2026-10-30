import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { NuqsTestingAdapter } from 'nuqs/adapters/testing'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'
import ArtistDetailPage from '../detail'
import type { GalleryFilterSheet } from '@/components/artwork/gallery-filter-sheet'
import type InfiniteArtworkList from '@/components/artwork/infinite-artwork-list'
import type { SearchBox } from '@/app/artworks/_components/search-box'
import { artworkQuerySnapshotSchema } from '@/schemas/artwork-quick-filter.dto'

const state = vi.hoisted(() => ({
  sheet: null as ComponentProps<typeof GalleryFilterSheet> | null,
  list: null as ComponentProps<typeof InfiniteArtworkList> | null,
  search: null as ComponentProps<typeof SearchBox> | null
}))
vi.mock('@/hooks/use-safe-back', () => ({ useSafeBack: () => vi.fn() }))
vi.mock('@/lib/trpc', () => ({ useTRPCClient: () => ({}) }))
vi.mock('../head-info', () => ({
  default: ({ immersiveHref }: { immersiveHref: string }) => <a href={immersiveHref}>沉浸浏览</a>
}))
vi.mock('@/components/artwork/gallery-filter-sheet', () => ({
  GalleryFilterSheet: (props: ComponentProps<typeof GalleryFilterSheet>) => {
    state.sheet = props
    return null
  }
}))
vi.mock('@/components/artwork/infinite-artwork-list', () => ({
  default: (props: ComponentProps<typeof InfiniteArtworkList>) => {
    state.list = props
    return <p>{props.emptyMessage}</p>
  }
}))
vi.mock('@/app/artworks/_components/search-box', () => ({
  SearchBox: (props: ComponentProps<typeof SearchBox>) => {
    state.search = props
    return <input aria-label="搜索" value={props.value} onChange={(event) => props.onSearch?.(event.target.value)} />
  }
}))
afterEach(cleanup)
const artist = { name: '固定艺术家' } as ComponentProps<typeof ArtistDetailPage>['artist']

describe('artist detail additional filters', () => {
  it('applies complete filters, explains self exclusion, and clears without losing route scope', async () => {
    let committed = new URLSearchParams()
    render(
      <NuqsTestingAdapter hasMemory searchParams="artistId=99&search=old&ratingLevels=4&excludeArtistIds=12" onUrlUpdate={({ searchParams }) => { committed = searchParams }}>
        <ArtistDetailPage artist={artist} id="12" />
      </NuqsTestingAdapter>
    )
    expect(state.list).toMatchObject({ artistId: '12', ratingLevels: [4], excludeArtistIds: [12] })
    expect(state.sheet).toMatchObject({
      scope: { kind: 'artist', artistId: 12 },
      fixedArtist: { value: '12', label: artist.name }
    })
    expect(screen.getByText(/当前艺术家已被排除/)).toBeTruthy()
    expect(state.search?.hideArtistSuggestions).toBe(true)
    const href = new URL((screen.getByRole('link', { name: '沉浸浏览' }) as HTMLAnchorElement).href)
    expect(href.searchParams.get('scopeArtistId')).toBe('12')
    expect(href.searchParams.get('mediaType')).toBe('all')
    expect(href.searchParams.get('excludeArtistIds')).toBe('12')
    act(() =>
      state.sheet!.onApplySnapshot(
        artworkQuerySnapshotSchema.parse({
          search: 'preset',
          artist: [{ value: '99', label: 'Other' }],
          tags: [{ value: '7', label: 'Tag' }],
          ratingLevels: [2, 4],
          readingStatus: 'UNREAD',
          hasAudio: 'yes',
          createdStartDate: '2026-01-01'
        })
      )
    )
    await waitFor(() =>
      expect(state.list).toMatchObject({
        searchQuery: 'preset',
        artistId: '12',
        tagIds: [7],
        ratingLevels: [2, 4],
        readingStatus: 'UNREAD',
        hasAudio: 'yes',
        createdStartDate: '2026-01-01'
      })
    )
    await waitFor(() => expect(committed.get('search')).toBe('preset'))
    fireEvent.click(screen.getByRole('button', { name: '清空筛选' }))
    await waitFor(() => expect(committed.get('search')).toBeNull())
    await waitFor(() =>
      expect(state.list).toMatchObject({
        artistId: '12',
        searchQuery: '',
        tagIds: [],
        ratingLevels: [],
        excludeArtistIds: []
      })
    )
    expect(state.list?.queryGeneration).toBeGreaterThan(0)
  })
  it('applies keyword and tag suggestions within the fixed artist', async () => {
    render(
      <NuqsTestingAdapter hasMemory>
        <ArtistDetailPage artist={artist} id="12" />
      </NuqsTestingAdapter>
    )
    fireEvent.change(screen.getByLabelText('搜索'), { target: { value: 'new keyword' } })
    await waitFor(() => expect(state.list?.searchQuery).toBe('new keyword'))
    act(() =>
      state.search!.onSuggestionClick!({
        type: 'tag',
        value: 'tag-query',
        label: '标签译名',
        metadata: { id: 7 }
      } as never)
    )
    await waitFor(() => expect(state.list).toMatchObject({ artistId: '12', searchQuery: '', tagIds: [7] }))
    expect(state.sheet?.currentTags).toEqual([{ value: '7', label: '标签译名' }])
  })
})
