import { useEffect, useState } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  countArtworkDeleteEntries,
  type ArtworkDeletePreview,
  type ArtworkDeleteReport
} from '@/schemas/artwork-delete.dto'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { ArtworkMediaViewProvider, useArtworkMediaView } from '../artwork-media-view-context'
import ArtworkDetailDelete from '../artwork-detail-delete'

const mocks = vi.hoisted(() => ({ preview: vi.fn(), remove: vi.fn(), safeBack: vi.fn(), invalidate: vi.fn() }))
vi.mock('@/lib/trpc', () => {
  const client = { artwork: { previewDelete: { query: mocks.preview } } }
  return {
    useTRPCClient: () => client,
    useTRPC: () => ({
      artwork: { delete: { mutationOptions: (options: object) => ({ ...options, mutationFn: mocks.remove }) } }
    })
  }
})
vi.mock('@/hooks/use-safe-back', () => ({ useSafeBack: () => mocks.safeBack }))
vi.mock('@/lib/reading/artwork-reader-provider', () => ({
  useArtworkReader: () => ({ reading: { invalidate: mocks.invalidate } })
}))

const directory = 'local-imports/artist/work'
const operationId = '50000000-0000-4000-8000-000000000001'
const mediaPath = `${directory}/one.jpg`
const sidecarPath = `${directory}/notes.txt`
const cardKey = ['artwork', 'cardList', 'random-v1', 'alice', { expectedUserId: 'alice' }]
let client: QueryClient
const originalScrollTo = HTMLElement.prototype.scrollTo

function preview(): ArtworkDeletePreview {
  return {
    operationId,
    artwork: { id: 42, title: '删除测试作品', createdVia: 'LOCAL_DIRECTORY', directory },
    mode: 'DIRECT_DELETE',
    directoryMode: 'WORK_DIRECTORY',
    canDelete: true,
    inspectionComplete: true,
    warnings: [],
    entries: [
      { path: mediaPath, kind: 'MEDIA', selection: 'REQUIRED', missing: false, reason: '登记媒体' },
      { path: sidecarPath, kind: 'OTHER', selection: 'OPTIONAL', missing: false, reason: '附属文件' }
    ]
  }
}
function report(outcome: ArtworkDeleteReport['outcome']): ArtworkDeleteReport {
  const archive = outcome === 'QUEUED'
  const entries: ArtworkDeleteReport['entries'] =
    outcome === 'FAILED'
      ? []
      : [{ path: mediaPath, kind: 'MEDIA', status: archive ? 'NOT_ATTEMPTED' : 'DELETED', reason: '登记媒体' }]
  return {
    reportId: `report-${outcome}`,
    operationId,
    artwork: { ...preview().artwork, createdVia: archive ? 'URL_ARCHIVE' : 'LOCAL_DIRECTORY' },
    mode: archive ? 'ARCHIVE_TRASH' : 'DIRECT_DELETE',
    outcome,
    entries,
    startedAt: '2026-11-03T00:00:00.000Z',
    finishedAt: '2026-11-03T00:00:01.000Z',
    database: {
      artwork: outcome === 'COMPLETED' ? 'DELETED' : 'RETAINED',
      media: outcome === 'COMPLETED' ? 'DELETED' : 'RETAINED',
      deletedMediaCount: outcome === 'COMPLETED' ? 1 : 0,
      relatedRecords: []
    },
    counts: countArtworkDeleteEntries(entries),
    inspectionComplete: true,
    warnings: [],
    archive: archive ? { jobId: 'trash-job', lifecycleState: 'TRASH_PENDING', reused: false } : null
  }
}
function Controls({ otherBlocker = false }: { otherBlocker?: boolean }) {
  const [open, setOpen] = useState(false)
  const view = useArtworkMediaView()!
  useEffect(() => {
    if (otherBlocker) view.setReaderBlocked(true, 'other')
    return () => view.setReaderBlocked(false, 'other')
  }, [otherBlocker, view.setReaderBlocked])
  return (
    <>
      <button onClick={() => setOpen(true)}>打开删除</button>
      <output data-testid="reader-blocked">{String(view.readerBlocked)}</output>
      <ArtworkDetailDelete artworkId={42} open={open} onOpenChange={setOpen} />
    </>
  )
}
async function setup(otherBlocker = false) {
  render(
    <QueryClientProvider client={client}>
      <ArtworkMediaViewProvider>
        <Controls otherBlocker={otherBlocker} />
      </ArtworkMediaViewProvider>
    </QueryClientProvider>
  )
  expect(mocks.preview).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '打开删除' }))
  await screen.findByText('删除测试作品 · 作品 #42')
  await waitFor(() => expect(screen.getByTestId('reader-blocked').textContent).toBe('true'))
}
beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  client.setQueryData(cardKey, { pages: [{ items: [{ id: 42 }, { id: 7 }], nextCursor: 2 }], pageParams: [1] })
  mocks.preview.mockResolvedValue(preview())
  mocks.remove.mockResolvedValue(report('COMPLETED'))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(640)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(900)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(640)
  HTMLElement.prototype.scrollTo = vi.fn()
})
afterEach(() => {
  cleanup()
  client.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  HTMLElement.prototype.scrollTo = originalScrollTo
})

describe('detail artwork deletion', () => {
  it('locks submission, pauses reading, shows the completed report before returning, and removes only the deleted card', async () => {
    let finish!: (value: ArtworkDeleteReport) => void
    mocks.remove.mockImplementation(
      () =>
        new Promise<ArtworkDeleteReport>((resolve) => {
          finish = resolve
        })
    )
    const pause = vi.spyOn(useArtworkAutoBrowseStore.getState(), 'pause')
    await setup()
    expect(pause).toHaveBeenCalledWith('overlay')
    const confirm = screen.getByRole('button', { name: '确认删除' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledOnce())
    expect(mocks.remove.mock.calls[0]?.[0]).toEqual({
      artworkId: 42,
      operationId,
      selectedPaths: [mediaPath, sidecarPath]
    })
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(screen.getByRole('dialog')).toBeTruthy()
    await act(async () => finish(report('COMPLETED')))
    await screen.findByText('删除总结')
    expect(mocks.safeBack).not.toHaveBeenCalled()
    expect(mocks.invalidate).toHaveBeenCalledOnce()
    expect(client.getQueryData(cardKey)).toEqual({ pages: [{ items: [{ id: 7 }], nextCursor: 2 }], pageParams: [1] })
    expect(screen.getByTestId('reader-blocked').textContent).toBe('true')
    fireEvent.click(screen.getByText('关闭', { selector: 'button' }))
    expect(mocks.safeBack).toHaveBeenCalledOnce()
  })

  it('submits archive recycling without file choices and returns only after the QUEUED report closes even while records are retained', async () => {
    mocks.preview.mockResolvedValue({
      ...preview(),
      artwork: { ...preview().artwork, createdVia: 'URL_ARCHIVE' },
      mode: 'ARCHIVE_TRASH',
      entries: []
    })
    mocks.remove.mockResolvedValue(report('QUEUED'))
    await setup()
    expect(screen.getByText('归档整包移入回收站，保留 7 天。')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '确认移入回收站' }))
    await screen.findByText('回收请求已提交')
    expect(mocks.remove.mock.calls[0]?.[0]).toEqual({ artworkId: 42 })
    expect(screen.getByRole('link', { name: '查看回收任务' }).getAttribute('href')).toBe('/admin/tasks?jobId=trash-job')
    expect(mocks.safeBack).not.toHaveBeenCalled()
    expect(mocks.invalidate).toHaveBeenCalledOnce()
    expect(client.getQueryData(cardKey)).toMatchObject({ pages: [{ items: [{ id: 7 }] }] })
    fireEvent.click(screen.getByText('关闭', { selector: 'button' }))
    expect(mocks.safeBack).toHaveBeenCalledOnce()
  })

  it('keeps partial deletion on the detail and resumes the original frozen operation after the report closes', async () => {
    mocks.remove.mockResolvedValue(report('PARTIAL'))
    await setup()
    fireEvent.click(screen.getByRole('checkbox', { name: `选择 ${sidecarPath}` }))
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await screen.findByText('部分完成')
    expect(mocks.invalidate).toHaveBeenCalledOnce()
    expect(client.getQueryState(cardKey)?.isInvalidated).toBe(false)
    fireEvent.click(screen.getByText('关闭', { selector: 'button' }))
    expect(mocks.safeBack).not.toHaveBeenCalled()
    expect(screen.getByTestId('reader-blocked').textContent).toBe('false')
    mocks.preview.mockResolvedValue({ ...preview(), recovery: { selectedPaths: [mediaPath] } })
    fireEvent.click(screen.getByRole('button', { name: '打开删除' }))
    await screen.findByText('继续上次删除')
    const sidecar = screen.getByRole('checkbox', { name: `选择 ${sidecarPath}` }) as HTMLButtonElement
    expect(sidecar.disabled).toBe(true)
    expect(sidecar.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: '重试原删除' }))
    await waitFor(() => expect(mocks.remove).toHaveBeenCalledTimes(2))
    expect(mocks.remove.mock.calls[1]?.[0]).toEqual({ artworkId: 42, operationId, selectedPaths: [mediaPath] })
  })

  it.each(['FAILED', 'PARTIAL'] as const)(
    'leaves reading and loaded cards intact for %s without media changes',
    async (outcome) => {
      const result = report(outcome)
      result.entries =
        outcome === 'PARTIAL' ? [{ path: sidecarPath, kind: 'OTHER', status: 'DELETED', reason: '附属文件' }] : []
      result.counts = countArtworkDeleteEntries(result.entries)
      mocks.remove.mockResolvedValue(result)
      await setup()
      fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
      await screen.findByText('删除总结')
      expect(mocks.invalidate).not.toHaveBeenCalled()
      expect(client.getQueryData(cardKey)).toMatchObject({ pages: [{ items: [{ id: 42 }, { id: 7 }] }] })
      fireEvent.click(screen.getByText('关闭', { selector: 'button' }))
      expect(mocks.safeBack).not.toHaveBeenCalled()
    }
  )

  it('keeps an unknown result in the preview without retrying and preserves another reading blocker on close', async () => {
    mocks.remove.mockRejectedValue(new Error('connection lost'))
    await setup(true)
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await screen.findByText('删除结果未确认')
    expect((screen.getByRole('button', { name: '确认删除' }) as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.remove).toHaveBeenCalledOnce()
    expect(mocks.preview).toHaveBeenCalledOnce()
    expect(mocks.invalidate).not.toHaveBeenCalled()
    expect(screen.queryByText('删除总结')).toBeNull()
    expect(mocks.safeBack).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByTestId('reader-blocked').textContent).toBe('true')
  })
})
