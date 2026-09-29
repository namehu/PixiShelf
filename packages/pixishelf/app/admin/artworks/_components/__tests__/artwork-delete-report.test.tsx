import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtworkDeleteReportDrawer } from '../artwork-delete-report'
import { countArtworkDeleteEntries, type ArtworkDeleteReport } from '@/schemas/artwork-delete.dto'

const mocks = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: mocks.error } }))
let report: ArtworkDeleteReport
beforeEach(() => {
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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('deletion report drawer', () => {
  it('shows partial execution and marks sensitive titles, paths and errors', () => {
    render(<ArtworkDeleteReportDrawer report={report} open onOpenChange={vi.fn()} />)
    expect(screen.getByRole('dialog').textContent).toContain('删除总结')
    expect(screen.getByRole('status').textContent).toContain('部分完成')
    expect(screen.getByText('local-imports/artist/work/1.jpg').hasAttribute('data-privacy-sensitive')).toBe(true)
    expect(screen.getByText('文件删除失败（EACCES）').hasAttribute('data-privacy-sensitive')).toBe(true)
    expect(screen.getByText('测试作品 · 作品 #42').hasAttribute('data-privacy-sensitive')).toBe(true)
  })
  it('searches and paginates all entries without truncating the report', () => {
    report.entries = Array.from({ length: 105 }, (_, index) => ({
      path: `artist/work/${String(index).padStart(3, '0')}.jpg`,
      kind: 'MEDIA',
      status: 'DELETED',
      reason: 'registered'
    }))
    render(<ArtworkDeleteReportDrawer report={report} open onOpenChange={vi.fn()} />)
    expect(screen.getByText('artist/work/000.jpg')).toBeTruthy()
    expect(screen.queryByText('artist/work/050.jpg')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '下一页' }))
    expect(screen.getByText('artist/work/050.jpg')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('搜索路径'), { target: { value: '104.jpg' } })
    expect(screen.getByText('artist/work/104.jpg')).toBeTruthy()
    expect(screen.getByText('共 1 项 · 第 1 / 1 页')).toBeTruthy()
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
    fireEvent.click(screen.getByRole('button', { name: '下载完整总结' }))
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
    expect(screen.getByRole('status').textContent).toContain('已删除媒体 0')
    expect(screen.getByRole('link', { name: '查看回收任务' }).getAttribute('href')).toBe('/admin/tasks?jobId=job-1')
  })
  it('closes and can reopen the same retained report', () => {
    const onOpenChange = vi.fn()
    const view = render(<ArtworkDeleteReportDrawer report={report} open onOpenChange={onOpenChange} />)
    fireEvent.click(screen.getByRole('button', { name: '关闭总结' }))
    expect(onOpenChange).toHaveBeenCalledWith(false)
    view.rerender(<ArtworkDeleteReportDrawer report={report} open={false} onOpenChange={onOpenChange} />)
    view.rerender(<ArtworkDeleteReportDrawer report={report} open onOpenChange={onOpenChange} />)
    expect(screen.getByText('local-imports/artist/work/1.jpg')).toBeTruthy()
  })
})
