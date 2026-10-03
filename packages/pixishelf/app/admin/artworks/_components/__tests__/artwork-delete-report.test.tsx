import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtworkDeleteReportDrawer } from '../artwork-delete-report'
import { countArtworkDeleteEntries, type ArtworkDeleteReport } from '@/schemas/artwork-delete.dto'

const mocks = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: mocks.error } }))
const originalScrollTo = HTMLElement.prototype.scrollTo
let report: ArtworkDeleteReport
beforeEach(() => {
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
  report = {
    reportId: 'report-1',
    artwork: { id: 42, title: '测试作品', createdVia: 'LOCAL_DIRECTORY', directory: 'local-imports/artist/work' },
    startedAt: '2026-09-15T00:00:00.000Z',
    finishedAt: '2026-09-15T00:00:01.000Z',
    mode: 'DIRECT_DELETE',
    outcome: 'PARTIAL',
    entries: [
      { path: 'local-imports/artist/work/1.jpg', kind: 'MEDIA', status: 'DELETED', reason: '数据库登记的作品媒体' },
      { path: 'local-imports/artist/work/notes.txt', kind: 'OTHER', status: 'RETAINED', reason: '未知文件保留' },
      {
        path: 'local-imports/artist/work/2.jpg',
        kind: 'MEDIA',
        status: 'FAILED',
        reason: '文件删除失败',
        code: 'EACCES'
      }
    ],
    database: { artwork: 'DELETED', media: 'DELETED', deletedMediaCount: 2, relatedRecords: [] },
    counts: countArtworkDeleteEntries([]),
    inspectionComplete: true,
    warnings: ['部分原文件未删除'],
    archive: null
  }
  report.counts = countArtworkDeleteEntries(report.entries)
})
afterEach(() => {
  cleanup()
  HTMLElement.prototype.scrollTo = originalScrollTo
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('deletion report drawer', () => {
  it('shows partial execution and marks sensitive titles, paths and errors', () => {
    render(<ArtworkDeleteReportDrawer report={report} open onOpenChange={vi.fn()} />)
    expect(screen.getByRole('dialog').textContent).toContain('删除总结')
    expect(screen.getByRole('status').textContent).toContain('部分完成')
    expect(screen.getByText('1.jpg').hasAttribute('data-privacy-sensitive')).toBe(true)
    expect(screen.getByText('文件删除失败（EACCES）').hasAttribute('data-privacy-sensitive')).toBe(true)
    expect(screen.getByText('测试作品 · 作品 #42').hasAttribute('data-privacy-sensitive')).toBe(true)
  })
  it('virtualizes all entries and searches beyond the mounted rows', async () => {
    report.entries = Array.from({ length: 2000 }, (_, index) => ({
      path: `artist/work/${String(index).padStart(4, '0')}.jpg`,
      kind: 'MEDIA',
      status: 'DELETED',
      reason: 'registered'
    }))
    render(<ArtworkDeleteReportDrawer report={report} open onOpenChange={vi.fn()} />)
    expect(await screen.findByText('artist/work/0000.jpg')).toBeTruthy()
    expect(screen.getAllByRole('listitem').length).toBeLessThan(32)
    expect(screen.queryByRole('button', { name: '下一页' })).toBeNull()
    const scroll = screen.getByLabelText('文件与目录明细')
    scroll.scrollTop = 2000 * 52 - 640
    fireEvent.scroll(scroll)
    expect(await screen.findByText('artist/work/1999.jpg')).toBeTruthy()
    expect(screen.getAllByRole('listitem').length).toBeLessThan(32)
    fireEvent.change(screen.getByLabelText('搜索路径'), { target: { value: '1999.jpg' } })
    expect(await screen.findByText('artist/work/1999.jpg')).toBeTruthy()
    expect(screen.getByText('1 项 · 下载含完整路径')).toBeTruthy()
  })
  it('keeps secondary details collapsed and shows file reasons on demand', async () => {
    render(<ArtworkDeleteReportDrawer report={report} open onOpenChange={vi.fn()} />)
    expect(screen.queryByText('报告编号：report-1')).toBeNull()
    expect(screen.queryByText('部分原文件未删除')).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('作品记录已删除')
    fireEvent.click(screen.getByRole('button', { name: '文件详情 local-imports/artist/work/notes.txt' }))
    expect(await screen.findByText('未知文件保留')).toBeTruthy()
    fireEvent.keyDown(screen.getByText('未知文件保留'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '报告详情' }))
    expect(await screen.findByText('报告编号：report-1')).toBeTruthy()
    expect(screen.getByText('部分原文件未删除')).toBeTruthy()
    expect(screen.getByLabelText('数据库结果')).toBeTruthy()
  })
  it('keeps incomplete inspection and retained records visible', () => {
    report.inspectionComplete = false
    report.database.artwork = 'NOT_ATTEMPTED'
    render(<ArtworkDeleteReportDrawer report={report} open onOpenChange={vi.fn()} />)
    expect(screen.getByRole('alert').textContent).toContain('目录未完整检查')
    expect(screen.getByRole('status').textContent).toContain('作品记录未删除')
  })
  it('exports every entry even when the visible list is filtered', async () => {
    const create = vi.fn<(blob: Blob) => string>().mockReturnValue('blob:test')
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = create
        static revokeObjectURL = vi.fn()
      }
    )
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<ArtworkDeleteReportDrawer report={report} open onOpenChange={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('搜索路径'), { target: { value: 'notes.txt' } })
    fireEvent.click(screen.getByRole('button', { name: '下载总结' }))
    expect(click).toHaveBeenCalledOnce()
    const blob = create.mock.calls[0]?.[0] as Blob | undefined
    const reader = new FileReader()
    reader.readAsText(blob!)
    await waitFor(() => expect(reader.readyState).toBe(FileReader.DONE))
    expect(reader.result).toContain('1.jpg')
    expect(reader.result).toContain('notes.txt')
    expect(reader.result).toContain('2.jpg')
    vi.unstubAllGlobals()
  })
  it('shows queued archive state without claiming files were removed', () => {
    report.mode = 'ARCHIVE_TRASH'
    report.outcome = 'QUEUED'
    report.entries = []
    report.counts = countArtworkDeleteEntries([])
    report.archive = { jobId: 'job-1', lifecycleState: 'TRASHING', reused: false }
    report.warnings = ['本次请求未执行文件移动或物理删除。']
    render(<ArtworkDeleteReportDrawer report={report} open onOpenChange={vi.fn()} />)
    expect(screen.getByRole('status').textContent).toContain('回收请求已提交')
    expect(screen.queryByText(/已删文件/)).toBeNull()
    expect(screen.getByRole('link', { name: '查看回收任务' }).getAttribute('href')).toBe('/admin/tasks?jobId=job-1')
  })
  it('closes and can reopen the same retained report', () => {
    const onOpenChange = vi.fn()
    const view = render(<ArtworkDeleteReportDrawer report={report} open onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getAllByRole('button', { name: '关闭' })[0]!)
    expect(onOpenChange).toHaveBeenCalledWith(false)
    view.rerender(<ArtworkDeleteReportDrawer report={report} open={false} onOpenChange={onOpenChange} />)
    view.rerender(<ArtworkDeleteReportDrawer report={report} open onOpenChange={onOpenChange} />)
    expect(screen.getByText('1.jpg')).toBeTruthy()
  })
})
