import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PendingReplacePairingWorkspace } from '../pending-replace-pairing-workspace'
import type { BatchView } from '../batch-replace-types'

const mocks = vi.hoisted(() => ({
  bind: vi.fn(),
  unbind: vi.fn(),
  queryData: { items: [], total: 0 } as { items: any[]; total: number }
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mocks.queryData, isLoading: false }),
  useMutation: (options: { mutationKey?: string[]; onSuccess?: (result: object, variables: any) => unknown }) => ({
    mutate: (variables: any) => {
      const mutation = options.mutationKey?.[0] === 'unbind' ? mocks.unbind : mocks.bind
      mutation(variables)
      void options.onSuccess?.({}, variables)
    },
    isPending: false
  })
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    artwork: { list: { queryOptions: () => ({}) } },
    pendingReplace: {
      bind: { mutationOptions: (options: object) => ({ ...options, mutationKey: ['bind'] }) },
      unbind: { mutationOptions: (options: object) => ({ ...options, mutationKey: ['unbind'] }) }
    }
  }),
  useTRPCClient: () => ({ tag: { list: { query: vi.fn().mockResolvedValue({ items: [] }) } } })
}))

vi.mock('@/components/artwork/artwork-filter', () => ({
  ArtworkFilterPanel: () => <div>筛选器</div>,
  buildArtworkFilterPayload: (value: object) => value,
  buildEmptyArtworkFilter: () => ({}),
  MEDIA_TYPE_OPTIONS: []
}))

function createBatch(): BatchView {
  return {
    id: 'batch-1',
    status: 'PREVIEWED',
    totalItems: 1,
    readyItems: 1,
    invalidItems: 0,
    excludedItems: 0,
    succeededItems: 0,
    failedItems: 0,
    restoredItems: 0,
    backupBytes: 0,
    createdAt: new Date(),
    systemJob: null,
    items: [
      {
        id: 'item-1',
        artworkId: 42,
        externalId: 'artwork-42',
        artworkTitle: '已绑定作品',
        artistName: '作者',
        sourceDirectory: 'pending-replaces/source-a',
        sourceDirectoryName: 'source-a',
        targetDirectory: 'artist/artwork-42',
        status: 'READY',
        included: true,
        oldMediaSnapshot: [],
        newMediaSnapshot: [
          {
            sourceName: 'only-visible-when-expanded.jpg',
            targetName: 'artwork-42_p0.jpg',
            path: 'pending-replaces/source-a/only-visible-when-expanded.jpg',
            size: 10,
            width: 100,
            height: 100,
            order: 0,
            mediaType: 'image'
          }
        ],
        warnings: [],
        error: null,
        backupDirectory: null
      }
    ]
  }
}

function createUnboundBatch(): BatchView {
  const first = createBatch()
  const baseItem = first.items[0]!
  const baseMedia = baseItem.newMediaSnapshot[0]!
  const createUnboundItem = (id: string, name: string, imageName: string): BatchView['items'][number] => ({
    ...baseItem,
    id,
    artworkId: null,
    externalId: null,
    artworkTitle: null,
    artistName: null,
    targetDirectory: null,
    status: 'INVALID',
    included: false,
    sourceDirectoryName: name,
    newMediaSnapshot: [
      {
        ...baseMedia,
        sourceName: imageName,
        path: `pending-replaces/${name}/${imageName}`
      }
    ]
  })
  return {
    ...first,
    readyItems: 0,
    invalidItems: 2,
    totalItems: 2,
    items: [
      createUnboundItem('item-1', 'source-a', 'source-a.jpg'),
      createUnboundItem('item-2', 'source-b', 'source-b.jpg')
    ]
  }
}

describe('PendingReplacePairingWorkspace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.queryData = { items: [], total: 0 }
  })
  afterEach(cleanup)

  it('uses a narrow source queue and shows the active source preview', () => {
    render(<PendingReplacePairingWorkspace batch={createUnboundBatch()} disabled={false} onBound={vi.fn()} />)

    expect(screen.getByTestId('pairing-layout').className).toContain('xl:grid-cols-[17rem_minmax(0,1fr)]')
    expect(screen.getByText('source-a.jpg')).not.toBeNull()
    expect(screen.queryByText('source-b.jpg')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '选择资源目录 source-b' }))
    expect(screen.queryByText('source-a.jpg')).toBeNull()
    expect(screen.getByText('source-b.jpg')).not.toBeNull()
  })

  it('offers an explicit unbind action for a bound source', () => {
    render(<PendingReplacePairingWorkspace batch={createBatch()} disabled={false} onBound={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '解除 source-a 的绑定' }))
    expect(mocks.unbind).toHaveBeenCalledWith({ itemId: 'item-1' })
  })

  it('collapses the bound source and advances to the next unbound source', () => {
    mocks.queryData = {
      total: 1,
      items: [{ id: 42, externalId: 'artwork-42', title: '目标作品', imageCount: 0, images: [] }]
    }
    render(<PendingReplacePairingWorkspace batch={createUnboundBatch()} disabled={false} onBound={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: '绑定并继续' }))

    expect(mocks.bind).toHaveBeenCalledWith({ itemId: 'item-1', artworkId: 42 })
    expect(screen.queryByText('source-a.jpg')).toBeNull()
    expect(screen.getByText('source-b.jpg')).not.toBeNull()
    expect(screen.getByText(/为「source-b」选择作品/)).not.toBeNull()
  })
})
