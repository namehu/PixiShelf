import type { ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchiveDiscoveryDetailHeader } from '../archive-discovery-detail-header'
import { ArchiveDiscoveryResultsToolbar } from '../archive-discovery-results-toolbar'
import { source as sourceFixture, completedRun as runFixture } from './archive-uploader-sources-fixtures'

type HeaderProps = ComponentProps<typeof ArchiveDiscoveryDetailHeader>

const source: HeaderProps['source'] = {
  ...sourceFixture,
  sourceKind: 'UPLOADER',
  status: 'ACTIVE',
  identityKind: 'UID',
  uidBindingState: 'BOUND',
  latestCoverage: 'CURRENT',
  historyCoverage: 'HAS_MORE',
  titleQuery: null,
  defaultCreators: [{ id: 7, name: 'Artist', kind: 'PERSON' }],
  createdAt: sourceFixture.createdAt.toISOString(),
  updatedAt: sourceFixture.updatedAt.toISOString(),
  lastScanAt: sourceFixture.lastScanAt.toISOString(),
  lastSuccessAt: sourceFixture.lastSuccessAt.toISOString()
}

const latestRun: NonNullable<HeaderProps['latestRun']> = {
  ...runFixture,
  mode: 'LATEST',
  searchIdentityKind: 'UID',
  status: 'COMPLETED',
  titleQuery: null,
  checkedCount: 12,
  matchedCount: 3,
  createdAt: runFixture.createdAt.toISOString(),
  updatedAt: runFixture.updatedAt.toISOString(),
  startedAt: runFixture.startedAt.toISOString(),
  finishedAt: runFixture.finishedAt.toISOString()
}

function headerProps(): HeaderProps {
  return {
    source,
    latestRun,
    mutationPending: false,
    scanPending: false,
    cancelPending: false,
    cancelRequested: false,
    onScanLatest: vi.fn(),
    onScanHistory: vi.fn(),
    onCancel: vi.fn(),
    onSetArchived: vi.fn(),
    onRename: vi.fn(),
    onCopy: vi.fn(),
    onEditUid: vi.fn(),
    onDelete: vi.fn(),
    onCopyUid: vi.fn(),
    onEditDefaultCreators: vi.fn(),
    onEditRules: vi.fn(),
    onCleanupCreators: vi.fn()
  }
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('discovery source controls', () => {
  it('keeps scan coverage and remote-title limits collapsed while showing source identity and recent status', () => {
    render(
      <ArchiveDiscoveryDetailHeader
        {...headerProps()}
        source={{
          ...source,
          sourceKind: 'TITLE_QUERY',
          titleQuery: { keyword: 'Gallery', matchMode: 'CONTAINS', uploaderUid: null }
        }}
      />
    )
    expect(screen.getByRole('heading', { name: 'UID 123' })).toBeTruthy()
    expect(screen.getByText(/最近扫描.*已完成/)).toBeTruthy()
    const details = screen.getByText('扫描详情').closest('details')
    expect(details?.open).toBe(false)
    expect(screen.getByText(/每批最多检查 100 条/).closest('details')).toBe(details)
    expect(screen.queryByText('待处理 1')).toBeNull()
  })

  it('keeps latest scanning immediately available and moves history scanning into its adjacent menu', async () => {
    const props = headerProps()
    render(<ArchiveDiscoveryDetailHeader {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '扫描最新' }))
    expect(props.onScanLatest).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: '扫描更早内容' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('button', { name: '更多扫描操作' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('menuitem', { name: '扫描更早内容' }))
    expect(props.onScanHistory).toHaveBeenCalledOnce()
  })

  it.each([
    ['设置固定艺术家（1）', 'onEditDefaultCreators'],
    ['编辑接纳规则', 'onEditRules'],
    ['清理历史艺术家标记', 'onCleanupCreators'],
    ['复制上传者 UID', 'onCopyUid'],
    ['高级：更正上传者账号', 'onEditUid'],
    ['删除来源', 'onDelete']
  ] as const)('opens %s through source settings', async (label, callback) => {
    const props = headerProps()
    render(<ArchiveDiscoveryDetailHeader {...props} />)
    fireEvent.keyDown(screen.getByRole('button', { name: '来源设置' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('menuitem', { name: label }))
    expect(props[callback]).toHaveBeenCalledOnce()
  })

  it('retains title-source rename and copy actions and allows disabling the source', async () => {
    const props = headerProps()
    render(
      <ArchiveDiscoveryDetailHeader
        {...props}
        source={{
          ...source,
          sourceKind: 'TITLE_QUERY',
          titleQuery: { keyword: 'Gallery', matchMode: 'CONTAINS', uploaderUid: null }
        }}
      />
    )
    for (const [label, callback] of [
      ['修改名称', props.onRename],
      ['另存条件', props.onCopy],
      ['停用来源', props.onSetArchived]
    ] as const) {
      fireEvent.keyDown(screen.getByRole('button', { name: '来源设置' }), { key: 'ArrowDown' })
      fireEvent.click(await screen.findByRole('menuitem', { name: label }))
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
      expect(callback).toHaveBeenCalledOnce()
    }
    expect(props.onSetArchived).toHaveBeenCalledWith(true)
  })

  it('keeps active scan progress and cancellation visible and locks scan and identity changes', async () => {
    const props = headerProps()
    render(
      <ArchiveDiscoveryDetailHeader
        {...props}
        activeRun={{ ...latestRun, status: 'RUNNING', finishedAt: null, itemCount: 12 }}
        source={{ ...source, uidBindingState: 'REVALIDATION_REQUIRED' }}
      />
    )
    expect(screen.getByLabelText('当前扫描进度')).toBeTruthy()
    expect(screen.getByText('扫描范围待核对')).toBeTruthy()
    expect((screen.getByRole('button', { name: '扫描最新' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '更多扫描操作' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '取消扫描' }))
    expect(props.onCancel).toHaveBeenCalledOnce()
    fireEvent.keyDown(screen.getByRole('button', { name: '来源设置' }), { key: 'ArrowDown' })
    expect((await screen.findByRole('menuitem', { name: '高级：更正上传者账号' })).hasAttribute('data-disabled')).toBe(
      true
    )
    expect(screen.getByRole('menuitem', { name: '停用来源' }).hasAttribute('data-disabled')).toBe(true)
  })
})

describe('discovery result range toolbar', () => {
  it('switches result range and display mode without a duplicate heading or intake settings', async () => {
    const onViewChange = vi.fn()
    const onResultViewChange = vi.fn()
    render(
      <ArchiveDiscoveryResultsToolbar
        view="ACTIONABLE"
        counts={{ ACTIONABLE: 3, PROCESSING: 2, ARCHIVED: 8, DELETED: 0, ATTENTION: 1, ALL: 14 }}
        resultView="list"
        onViewChange={onViewChange}
        onResultViewChange={onResultViewChange}
      />
    )
    expect(screen.getByRole('group', { name: '结果范围' })).toBeTruthy()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByRole('button', { name: /接纳设置|加入选项/ })).toBeNull()
    expect(screen.getByRole('radio', { name: '查看待处理' }).getAttribute('aria-checked')).toBe('true')
    fireEvent.click(screen.getByRole('radio', { name: '查看已归档' }))
    expect(onViewChange).toHaveBeenCalledWith('ARCHIVED')
    fireEvent.keyDown(screen.getByRole('button', { name: '显示模式：纯列表' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '使用卡片模式' }))
    expect(onResultViewChange).toHaveBeenCalledWith('cards')
  })
})
