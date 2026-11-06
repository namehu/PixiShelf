import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchiveQualityPanel } from '../archive-quality-panel'

const { state, mutate, refresh, detailsOptions } = vi.hoisted(() => ({
  state: { data: {} as Record<string, unknown>, details: {} as Record<string, unknown> },
  mutate: vi.fn(),
  refresh: vi.fn(),
  detailsOptions: vi.fn()
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archive: {
      getOriginalUpgrade: { queryOptions: () => ({}) },
      getQualityDetails: {
        queryOptions: (input: unknown, options: unknown) => {
          detailsOptions(input, options)
          return { kind: 'details' }
        }
      },
      upgradeOriginal: { mutationOptions: (value: unknown) => value }
    }
  })
}))
vi.mock('@tanstack/react-query', () => ({
  keepPreviousData: (data: unknown) => data,
  useQuery: (options: { kind?: string }) => ({
    data: options.kind === 'details' ? state.details : state.data,
    refetch: vi.fn(),
    isFetching: false,
    isPending: false
  }),
  useMutation: () => ({ mutate, isPending: false })
}))
const initial = {
  revisionId: 'revision',
  canUpgrade: true,
  active: false,
  taskId: null,
  intakeItemId: null,
  blockedReason: null,
  error: null,
  qualityTaskId: 'published-task',
  sourceSizeBytes: 1_116_691_497,
  quality: {
    status: 'DISPLAY',
    originalCount: 0,
    displayCount: 20,
    unknownCount: 0,
    verifiedAt: '2026-11-05T00:00:00Z'
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  state.data = { ...initial }
  state.details = {
    revisionId: 'revision',
    reason: null,
    unresolvedPageCount: 0,
    total: 1,
    pages: [{ index: 2, quality: 'UNKNOWN', reason: 'NO_FINAL_SUCCESSFUL_ATTEMPT' }],
    nextOffset: null
  }
})
afterEach(cleanup)

function openDisclosure(label = '保存的图片') {
  const details = screen.getByText(label).closest('details')!
  details.open = true
  fireEvent(details, new Event('toggle'))
}

describe('archive original upgrade panel', () => {
  it('keeps reading metadata compact and submits the expected revision from the disclosure', () => {
    render(<ArchiveQualityPanel artworkId={7} />)
    expect(screen.getByText('网页阅读版')).toBeTruthy()
    expect(screen.getByText('保存的图片')).toBeTruthy()
    expect(screen.queryByText('原站整部大小')).toBeNull()
    expect(screen.queryByText('20 张是网页阅读版。')).toBeNull()
    expect(screen.queryByRole('button', { name: '下载原图' })).toBeNull()
    expect(screen.queryByRole('link', { name: '查看归档任务' })).toBeNull()
    openDisclosure()
    expect(screen.getByText('原站整部大小')).toBeTruthy()
    expect(screen.getByText('1.04 GiB')).toBeTruthy()
    expect(screen.getByText('20 张是网页阅读版。')).toBeTruthy()
    expect(screen.getByText('网页阅读版是原站用于在线阅读的版本，可能经过缩小或压缩。')).toBeTruthy()
    expect(screen.getByText('图片版本依据下载和发布记录判断。')).toBeTruthy()
    expect(screen.queryByText(/原图 0 张/)).toBeNull()
    expect(detailsOptions).toHaveBeenLastCalledWith(
      { artworkId: 7, offset: 0, limit: 50 },
      expect.objectContaining({ enabled: false })
    )
    expect(screen.getByRole('link', { name: '查看归档任务' }).getAttribute('href')).toBe(
      '/admin/archive?taskId=published-task'
    )
    fireEvent.click(screen.getByRole('button', { name: '下载原图' }))
    fireEvent.click(screen.getByRole('button', { name: '下载原图' }))
    expect(mutate).toHaveBeenCalledWith({
      artworkId: 7,
      expectedRevisionId: 'revision',
      idempotencyKey: expect.any(String)
    })
    expect(mutate.mock.calls[0]).toEqual(mutate.mock.calls[1])
  })
  it('links a running upgrade and prevents another request', () => {
    state.data = { ...initial, canUpgrade: false, active: true, taskId: 'task' }
    render(<ArchiveQualityPanel artworkId={7} />)
    openDisclosure()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '原图下载任务进行中' }).disabled).toBe(true)
    expect(screen.getByText('任务成功后，原图会替换已保存的图片，阅读位置、书签和单图喜欢会保留。')).toBeTruthy()
    expect(screen.getByRole('link', { name: '查看原图任务' }).getAttribute('href')).toBe('/admin/archive?taskId=task')
  })
  it('explains unknown evidence and a blocked upgrade', () => {
    state.data = {
      ...initial,
      canUpgrade: false,
      blockedReason: '历史来源计划不完整',
      quality: { ...initial.quality, status: 'UNKNOWN', displayCount: 0, unknownCount: 20 }
    }
    render(<ArchiveQualityPanel artworkId={7} />)
    expect(screen.getByText('版本无法确认')).toBeTruthy()
    expect(screen.queryByText('当前作品缺少下载原图所需的来源记录。')).toBeNull()
    openDisclosure()
    expect(screen.getByText('当前作品缺少下载原图所需的来源记录。')).toBeTruthy()
    expect(screen.getByText('20 张已保存，但从现有下载和发布记录无法确认是否为原图。')).toBeTruthy()
    expect(screen.queryByRole('link', { name: '历史画质核验' })).toBeNull()
    openDisclosure('查看具体原因')
    expect(screen.getByRole('link', { name: '历史画质核验' }).getAttribute('href')).toBe(
      '/admin/setting?tab=system#archive-quality'
    )
    expect(screen.queryByRole('button', { name: '下载原图' })).toBeNull()
  })
  it('distinguishes missing version proof from missing images and loads grouped reasons only when requested', () => {
    state.data = {
      ...initial,
      qualityTaskId: null,
      quality: { ...initial.quality, status: 'UNKNOWN', originalCount: 8, displayCount: 195, unknownCount: 51 }
    }
    state.details = {
      ...state.details,
      total: 51,
      nextOffset: 50,
      pages: [5, 3, 2].map((index) => ({ index, quality: 'UNKNOWN', reason: 'NO_FINAL_SUCCESSFUL_ATTEMPT' }))
    }
    render(<ArchiveQualityPanel artworkId={7} />)
    expect(screen.getByText('部分版本无法确认')).toBeTruthy()
    expect(detailsOptions).toHaveBeenLastCalledWith(
      { artworkId: 7, offset: 0, limit: 50 },
      expect.objectContaining({ enabled: false })
    )
    openDisclosure()
    expect(
      screen.getByText(
        '8 张确认是原图，195 张是网页阅读版。另有 51 张已保存，但从现有下载和发布记录无法确认是否为原图。'
      )
    ).toBeTruthy()
    expect(screen.queryByText('找不到能与已保存图片对应的下载记录。')).toBeNull()
    expect(detailsOptions).toHaveBeenLastCalledWith(
      { artworkId: 7, offset: 0, limit: 50 },
      expect.objectContaining({ enabled: false })
    )
    expect(screen.queryByRole('link', { name: '查看归档任务' })).toBeNull()
    openDisclosure('查看具体原因')
    expect(screen.getAllByText('找不到能与已保存图片对应的下载记录。')).toHaveLength(1)
    expect(screen.getByText('3 张 · 第 3–4、6 页')).toBeTruthy()
    expect(screen.getByText('第 1–50 条，共 51 条')).toBeTruthy()
    expect(detailsOptions).toHaveBeenLastCalledWith(
      { artworkId: 7, offset: 0, limit: 50 },
      expect.objectContaining({ enabled: true })
    )
    state.details = {
      ...state.details,
      nextOffset: null,
      pages: [{ index: 74, quality: 'UNKNOWN', reason: 'HATH_H_XRES_WIDTH_MISMATCH' }]
    }
    fireEvent.click(screen.getByRole('button', { name: '下一批' }))
    expect(detailsOptions).toHaveBeenLastCalledWith(
      { artworkId: 7, offset: 50, limit: 50 },
      expect.objectContaining({ enabled: true })
    )
    expect(screen.queryByText('找不到能与已保存图片对应的下载记录。')).toBeNull()
    expect(screen.getByText('下载记录没有足够信息，无法确认是否与原图一致。')).toBeTruthy()
    expect(screen.queryByText(/交付|档位/)).toBeNull()
    expect(screen.getByText('第 75 页')).toBeTruthy()
    expect(screen.getByText('第 51 条，共 51 条')).toBeTruthy()
    expect(screen.getByRole<HTMLButtonElement>('button', { name: '下一批' }).disabled).toBe(true)
  })
  it('updates its displayed revision after refresh and resets the disclosure and pagination for another artwork', () => {
    const view = render(<ArchiveQualityPanel artworkId={7} />)
    openDisclosure()
    state.data = { ...initial, revisionId: 'new-revision', canUpgrade: false }
    view.rerender(<ArchiveQualityPanel artworkId={7} />)
    fireEvent.click(screen.getByRole('button', { name: '刷新查看当前版本' }))
    expect(refresh).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: '刷新查看当前版本' })).toBeNull()
    state.data = {
      ...initial,
      revisionId: 'new-revision',
      quality: { ...initial.quality, status: 'UNKNOWN', unknownCount: 60 }
    }
    state.details = { ...state.details, revisionId: 'new-revision', total: 60, nextOffset: 50 }
    view.rerender(<ArchiveQualityPanel artworkId={7} />)
    openDisclosure('查看具体原因')
    fireEvent.click(screen.getByRole('button', { name: '下一批' }))
    state.data = {
      ...initial,
      revisionId: 'another-revision',
      quality: { ...initial.quality, status: 'UNKNOWN', unknownCount: 60 }
    }
    view.rerender(<ArchiveQualityPanel artworkId={8} />)
    expect(detailsOptions).toHaveBeenLastCalledWith(
      { artworkId: 8, offset: 0, limit: 50 },
      expect.objectContaining({ enabled: false })
    )
    expect(screen.queryByText('查看具体原因')).toBeNull()
    expect(screen.queryByRole('button', { name: '刷新查看当前版本' })).toBeNull()
  })
  it('does not reuse cached page reasons from another revision', () => {
    state.data = {
      ...initial,
      revisionId: 'new-revision',
      quality: { ...initial.quality, status: 'UNKNOWN', unknownCount: 1 }
    }
    render(<ArchiveQualityPanel artworkId={7} />)
    openDisclosure()
    openDisclosure('查看具体原因')
    expect(screen.getByRole('button', { name: '刷新版本记录' })).toBeTruthy()
    expect(screen.queryByText('找不到能与已保存图片对应的下载记录。')).toBeNull()
  })
  it('describes an older archive before any version identification without implying missing files', () => {
    state.data = { ...initial, quality: { ...initial.quality, status: 'UNKNOWN', displayCount: 0, verifiedAt: null } }
    render(<ArchiveQualityPanel artworkId={7} />)
    expect(screen.getByText('尚未识别图片版本')).toBeTruthy()
    openDisclosure()
    expect(screen.getByText('图片已保存，目前还没有识别出图片版本。')).toBeTruthy()
  })
})
