import { useEffect, useState, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArchivePreviewPageDto } from '@/services/archive-preview/archive-preview-types'
import { SourcePreviewReader, updateSourcePreviewVisibility } from '../source-preview-reader'

const mocks = vi.hoisted(() => ({
  page: vi.fn(),
  reload: vi.fn(),
  slideNext: vi.fn(),
  slideTo: vi.fn()
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archivePreview: {
      page: { mutationOptions: () => ({ mutationFn: mocks.page }) },
      reload: { mutationOptions: () => ({ mutationFn: mocks.reload }) }
    }
  })
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: ({ mutationFn }: { mutationFn: (input: unknown) => Promise<unknown> }) => {
    const [isPending, setPending] = useState(false)
    return {
      isPending,
      mutateAsync: async (input: unknown) => {
        setPending(true)
        try {
          return await mutationFn(input)
        } finally {
          setPending(false)
        }
      }
    }
  }
}))

vi.mock('../controlled-auto-browse-controls', () => ({
  ControlledAutoBrowseControls: (props: {
    mode: 'scroll' | 'slideshow'
    state: { status: string }
    onStart: (mode: 'scroll' | 'slideshow') => void
  }) => (
    <div data-testid={`auto-controls-${props.mode}`} data-status={props.state.status}>
      <button type="button" onClick={() => props.onStart(props.mode)}>
        启动{props.mode}
      </button>
    </div>
  )
}))

vi.mock('../vertical-media-preview-core', () => ({
  VerticalMediaPreviewCore: (props: {
    items: ArchivePreviewPageDto['items']
    initialIndex: number
    open: boolean
    onClose: (index: number) => void
    onControllerChange?: (controller: { slideNext: () => void; slidePrev: () => void; slideTo: (index: number) => void }) => void
    bottomChrome?: (context: { portalContainer: null }) => ReactNode
    renderSlide: (item: ArchivePreviewPageDto['items'][number], context: { eager: boolean; active: boolean; index: number }) => ReactNode
  }) => {
    useEffect(() => {
      props.onControllerChange?.({ slideNext: mocks.slideNext, slidePrev: vi.fn(), slideTo: mocks.slideTo })
      return () => props.onControllerChange?.(null as never)
    }, [props.onControllerChange])
    return props.open ? (
      <div data-testid="source-preview-swiper">
        {props.items.map((item, index) => (
          <div key={item.ordinal}>{props.renderSlide(item, { eager: true, active: index === props.initialIndex, index })}</div>
        ))}
        {props.bottomChrome?.({ portalContainer: null })}
        <button type="button" onClick={() => props.onClose(props.initialIndex)}>
          关闭测试预览
        </button>
      </div>
    ) : null
  }
}))

class IntersectionObserverMock {
  static instances: IntersectionObserverMock[] = []
  active = true
  private readonly callback: IntersectionObserverCallback
  private target: Element | null = null
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    IntersectionObserverMock.instances.push(this)
  }
  observe(target: Element) {
    this.target = target
  }
  unobserve() {}
  takeRecords() {
    return []
  }
  disconnect() {
    this.active = false
  }
  trigger() {
    this.callback(
      [{ isIntersecting: true, intersectionRatio: 1, target: this.target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    )
  }
}

function page(
  number: number,
  ordinals: number[],
  options: { title?: string; total?: number | null; nextPage?: number | null } = {}
): ArchivePreviewPageDto {
  return {
    title: options.title ?? '私密来源标题',
    total: options.total === undefined ? 4 : options.total,
    page: number,
    nextPage: options.nextPage === undefined ? null : options.nextPage,
    items: ordinals.map((ordinal) => ({
      ordinal,
      url: `https://thumb.example.test/${ordinal}.jpg`,
      width: 300,
      height: 450
    }))
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('SourcePreviewReader', () => {
  beforeEach(() => {
    localStorage.clear()
    mocks.page.mockReset()
    mocks.reload.mockReset()
    mocks.slideNext.mockReset()
    mocks.slideTo.mockReset()
    IntersectionObserverMock.instances = []
    vi.stubGlobal('IntersectionObserver', IntersectionObserverMock)
    vi.stubGlobal('ResizeObserver', class { observe() {}; disconnect() {} })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
    window.scrollTo = vi.fn()
    window.scrollBy = vi.fn()
    Element.prototype.scrollIntoView = vi.fn()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('fetches page zero without initial data and exposes only the protected original redirect', async () => {
    mocks.page.mockResolvedValue(page(0, [0], { total: null }))
    render(<SourcePreviewReader previewId="opaque_123" />)

    await screen.findByAltText('来源缩略图 1')
    expect(mocks.page).toHaveBeenCalledWith({ previewId: 'opaque_123', page: 0 })
    expect(window.scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'auto' })
    expect(screen.getByText('已载入 1 张')).toBeTruthy()
    expect(screen.getByText('私密来源标题').getAttribute('data-privacy-sensitive')).not.toBeNull()
    const image = screen.getByAltText('来源缩略图 1')
    expect(image.getAttribute('loading')).toBe('lazy')
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')
    const original = screen.getByRole('link', { name: '打开原站' })
    expect(original.getAttribute('href')).toBe('/api/archive/preview/opaque_123/source')
    expect(document.body.innerHTML).not.toContain('/g/')
  })

  it('selects the most visible item across separate observer callback batches', () => {
    const ratios = new Map<number, number>()
    expect(updateSourcePreviewVisibility(ratios, [{ ordinal: 7, ratio: 0.18, visible: true }])).toBe(7)
    expect(updateSourcePreviewVisibility(ratios, [{ ordinal: 8, ratio: 0.82, visible: true }])).toBe(8)
    expect(updateSourcePreviewVisibility(ratios, [{ ordinal: 7, ratio: 0.08, visible: true }])).toBe(8)
    expect(updateSourcePreviewVisibility(ratios, [{ ordinal: 8, ratio: 0, visible: false }])).toBe(7)
  })

  it('keeps the selected item active when a following page is appended', async () => {
    mocks.page.mockResolvedValue(page(1, [2, 3], { nextPage: null }))
    render(<SourcePreviewReader previewId="append" initialPage={page(0, [0, 1], { nextPage: 1 })} />)

    fireEvent.click(screen.getByRole('button', { name: '全屏查看第 2 张' }))
    await waitFor(() => expect(screen.getAllByAltText('来源缩略图 4').length).toBeGreaterThan(0))
    expect(mocks.page).toHaveBeenCalledWith({ previewId: 'append', page: 1 })
    expect(screen.getByRole('button', { name: '全屏查看第 2 张' }).getAttribute('data-active')).not.toBeNull()
    expect(screen.getByTestId('source-preview-swiper')).toBeTruthy()
  })

  it('locks failed pagination until the explicit retry succeeds', async () => {
    mocks.page.mockRejectedValueOnce(new Error('rate limited')).mockResolvedValueOnce(page(1, [2], { total: 3 }))
    render(<SourcePreviewReader previewId="flaky" initialPage={page(0, [0, 1], { total: 3, nextPage: 1 })} />)

    act(() => IntersectionObserverMock.instances.findLast((item) => item.active)?.trigger())
    await screen.findByText('暂时无法继续读取')
    expect(mocks.page).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '全屏查看第 2 张' }))
    const fullscreenError = screen.getByTestId('source-preview-fullscreen-error')
    expect(within(fullscreenError).getByText('缩略图读取失败，请重试。')).toBeTruthy()
    expect(within(fullscreenError).getByRole('button', { name: '重试' })).toBeTruthy()

    act(() => IntersectionObserverMock.instances.findLast((item) => item.active)?.trigger())
    await act(async () => Promise.resolve())
    expect(mocks.page).toHaveBeenCalledTimes(1)

    fireEvent.click(within(fullscreenError).getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.getAllByAltText('来源缩略图 3').length).toBeGreaterThan(0))
    expect(mocks.page).toHaveBeenCalledTimes(2)
  })

  it('shows and retries an idle single-thumbnail failure without starting automatic browsing', async () => {
    render(<SourcePreviewReader previewId="single-image-error" initialPage={page(0, [0], { total: 1 })} />)

    fireEvent.click(screen.getByRole('button', { name: '全屏查看第 1 张' }))
    const imagesBeforeRetry = screen.getAllByAltText('来源缩略图 1')
    fireEvent.error(imagesBeforeRetry.at(-1)!)

    const fullscreenError = await screen.findByTestId('source-preview-fullscreen-error')
    expect(within(fullscreenError).getByText('当前缩略图加载失败，请重试。')).toBeTruthy()
    expect(screen.getByTestId('source-preview-thumbnail-error')).toBeTruthy()
    expect(screen.queryByTestId('auto-controls-slideshow')).toBeNull()

    fireEvent.click(within(fullscreenError).getByRole('button', { name: '重试' }))
    await waitFor(() => expect(screen.queryByTestId('source-preview-fullscreen-error')).toBeNull())
    const imagesAfterRetry = screen.getAllByAltText('来源缩略图 1')
    expect(imagesAfterRetry).toHaveLength(2)
    expect(imagesAfterRetry).not.toContain(imagesBeforeRetry.at(-1))
    fireEvent.load(imagesAfterRetry.at(-1)!)
    expect(screen.queryByTestId('source-preview-thumbnail-error')).toBeNull()
    expect(screen.queryByTestId('auto-controls-slideshow')).toBeNull()
  })

  it('ignores a page response from an earlier preview id', async () => {
    const old = deferred<ArchivePreviewPageDto>()
    mocks.page.mockReturnValue(old.promise)
    const { rerender } = render(<SourcePreviewReader previewId="old" />)
    await waitFor(() => expect(mocks.page).toHaveBeenCalledWith({ previewId: 'old', page: 0 }))

    rerender(<SourcePreviewReader previewId="new" initialPage={page(0, [8], { title: '新来源', total: 1 })} />)
    await screen.findByText('新来源')
    act(() => old.resolve(page(0, [0], { title: '旧来源', total: 1 })))
    await act(async () => Promise.resolve())

    expect(screen.queryByText('旧来源')).toBeNull()
    expect(screen.getByAltText('来源缩略图 9')).toBeTruthy()
  })

  it('reloads from the first page and ignores an older pending append', async () => {
    const pendingAppend = deferred<ArchivePreviewPageDto>()
    mocks.page.mockReturnValue(pendingAppend.promise)
    mocks.reload.mockResolvedValue(page(0, [0], { title: '刷新后来源', total: 1 }))
    render(<SourcePreviewReader previewId="reloadable" initialPage={page(0, [0, 1], { nextPage: 1 })} />)

    act(() => IntersectionObserverMock.instances.findLast((item) => item.active)?.trigger())
    await waitFor(() => expect(mocks.page).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: '重新读取来源' }))
    await screen.findByText('刷新后来源')
    act(() => pendingAppend.resolve(page(1, [2, 3])))
    await act(async () => Promise.resolve())

    expect(screen.queryByAltText('来源缩略图 3')).toBeNull()
    expect(screen.getByAltText('来源缩略图 1')).toBeTruthy()
  })

  it('starts a fresh append after reload instead of reusing the prior generation request', async () => {
    const oldAppend = deferred<ArchivePreviewPageDto>()
    const freshAppend = page(1, [1])
    freshAppend.items[0]!.url = 'https://thumb.example.test/fresh-1.jpg'
    mocks.page.mockReturnValueOnce(oldAppend.promise).mockResolvedValueOnce(freshAppend)
    mocks.reload.mockResolvedValue(page(0, [0], { title: '刷新代次', total: 2, nextPage: 1 }))
    render(<SourcePreviewReader previewId="reload-generation" initialPage={page(0, [0], { nextPage: 1 })} />)

    act(() => IntersectionObserverMock.instances.findLast((item) => item.active)?.trigger())
    await waitFor(() => expect(mocks.page).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: '重新读取来源' }))
    await screen.findByText('刷新代次')
    act(() => IntersectionObserverMock.instances.findLast((item) => item.active)?.trigger())

    await waitFor(() => expect(mocks.page).toHaveBeenCalledTimes(2))
    const freshImage = await screen.findByAltText('来源缩略图 2')
    expect(freshImage.getAttribute('src')).toBe('https://thumb.example.test/fresh-1.jpg')

    const staleAppend = page(1, [1])
    staleAppend.items[0]!.url = 'https://thumb.example.test/stale-1.jpg'
    act(() => oldAppend.resolve(staleAppend))
    await act(async () => Promise.resolve())
    expect(screen.getByAltText('来源缩略图 2').getAttribute('src')).toBe('https://thumb.example.test/fresh-1.jpg')
  })

  it('retries a failed reload as a fresh reload and removes pages from the prior generation', async () => {
    mocks.page.mockResolvedValue(page(1, [2, 3], { nextPage: null }))
    mocks.reload
      .mockRejectedValueOnce(new Error('reload failed'))
      .mockResolvedValueOnce(page(0, [7], { title: '重新读取成功', total: 1 }))
    render(<SourcePreviewReader previewId="reload-retry" initialPage={page(0, [0, 1], { nextPage: 1 })} />)

    act(() => IntersectionObserverMock.instances.findLast((item) => item.active)?.trigger())
    await screen.findByAltText('来源缩略图 4')
    fireEvent.click(screen.getByRole('button', { name: '重新读取来源' }))
    await screen.findByText('暂时无法继续读取')
    expect(screen.getByAltText('来源缩略图 4')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await screen.findByText('重新读取成功')
    expect(mocks.reload).toHaveBeenCalledTimes(2)
    expect(screen.queryByAltText('来源缩略图 1')).toBeNull()
    expect(screen.queryByAltText('来源缩略图 4')).toBeNull()
    expect(screen.getByAltText('来源缩略图 8')).toBeTruthy()
  })

})
