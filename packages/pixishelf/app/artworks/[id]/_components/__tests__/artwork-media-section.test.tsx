import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtworkMediaSection } from '../artwork-media-section'
import { ArtworkMediaViewProvider } from '../artwork-media-view-context'

const mocks = vi.hoisted(() => ({
  requests: [] as Array<{
    variables: { source: { externalRefId: string } }
    options: {
      onSuccess: (result: unknown) => void
      onError: () => void
      onSettled: () => void
    }
  }>,
  sources: [] as Array<{ externalRefId: string; providerKey: string; label: string }>,
  localMounts: 0,
  localUnmounts: 0
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: mocks.sources }),
  useMutation: () => ({
    mutate: (variables: never, options: never) => mocks.requests.push({ variables, options })
  })
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archivePreview: {
      sources: { queryOptions: () => ({}) },
      open: { mutationOptions: () => ({}) }
    }
  })
}))

vi.mock('@/components/source-preview/source-preview-reader', () => ({
  SourcePreviewReader: ({ previewId }: { previewId: string }) => <div data-testid="source-reader">{previewId}</div>
}))

vi.mock('../artwork-images', async () => {
  const React = await import('react')
  return {
    default: () => {
      React.useEffect(() => {
        mocks.localMounts += 1
        return () => {
          mocks.localUnmounts += 1
        }
      }, [])
      return <div data-testid="local-images">本地图片列表</div>
    }
  }
})

function renderSection() {
  return render(
    <ArtworkMediaViewProvider>
      <ArtworkMediaSection images={[]} artworkId={7} />
    </ArtworkMediaViewProvider>
  )
}

function opened(previewId: string) {
  return {
    previewId,
    title: previewId,
    total: 1,
    page: 0,
    items: [{ ordinal: 0, url: 'https://ehgt.org/thumb.jpg', width: 100, height: 100 }],
    nextPage: null
  }
}

function selectTab(name: string) {
  const tab = screen.getByRole('tab', { name })
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false })
  fireEvent.click(tab)
}

describe('ArtworkMediaSection', () => {
  beforeEach(() => {
    mocks.requests.length = 0
    mocks.sources = []
    mocks.localMounts = 0
    mocks.localUnmounts = 0
  })

  afterEach(cleanup)

  it('keeps the local viewer mounted when the source query arrives', () => {
    const view = renderSection()
    expect(mocks.localMounts).toBe(1)

    mocks.sources = [{ externalRefId: 'source-a', providerKey: 'e-hentai', label: '#101' }]
    view.rerender(
      <ArtworkMediaViewProvider>
        <ArtworkMediaSection images={[]} artworkId={7} />
      </ArtworkMediaViewProvider>
    )

    expect(screen.getByRole('tab', { name: '原站预览' })).toBeTruthy()
    expect(mocks.localMounts).toBe(1)
    expect(mocks.localUnmounts).toBe(0)
  })

  it('ignores an older source response after a newer source was chosen', () => {
    mocks.sources = [
      { externalRefId: 'source-a', providerKey: 'e-hentai', label: '#101' },
      { externalRefId: 'source-b', providerKey: 'e-hentai', label: '#102' }
    ]
    renderSection()
    selectTab('原站预览')
    fireEvent.click(screen.getByRole('button', { name: '#101' }))
    fireEvent.click(screen.getByRole('button', { name: '#102' }))

    act(() => {
      mocks.requests[1]!.options.onSuccess(opened('preview-b'))
      mocks.requests[1]!.options.onSettled()
    })
    expect(screen.getByTestId('source-reader').textContent).toBe('preview-b')

    act(() => {
      mocks.requests[0]!.options.onSuccess(opened('preview-a'))
      mocks.requests[0]!.options.onSettled()
    })
    expect(screen.getByTestId('source-reader').textContent).toBe('preview-b')
  })

  it('ignores a pending source response after returning to local images', () => {
    mocks.sources = [{ externalRefId: 'source-a', providerKey: 'e-hentai', label: '#101' }]
    renderSection()
    selectTab('原站预览')
    selectTab('本地图片')

    act(() => {
      mocks.requests[0]!.options.onSuccess(opened('preview-a'))
      mocks.requests[0]!.options.onSettled()
    })
    expect(screen.queryByTestId('source-reader')).toBeNull()
    expect(screen.getByTestId('local-images')).toBeTruthy()
  })
})
