import { useState, type ComponentProps } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchiveDownloadFloater } from '../archive-download-floater'
import { ArchiveTaskCard } from '../archive-task-list'
import { ArchiveTaskToolbar } from '../archive-task-toolbar'
import { normalizeTaskFilters, type TaskFilters } from '../archive-task-filters'

vi.mock('next/link', () => ({
  default: ({ children, ...props }: ComponentProps<'a'>) => <a {...props}>{children}</a>
}))
vi.mock('@/components/source-preview/source-preview-button', () => ({ SourcePreviewButton: () => null }))
vi.mock('../archive-task-creator-dialog', () => ({
  ArchiveTaskCreatorDialog: ({ taskId, onClose }: { taskId: string; onClose: () => void }) => (
    <div role="dialog" aria-label="管理艺术家">
      <span>{taskId}</span>
      <button onClick={onClose}>关闭管理艺术家</button>
    </div>
  )
}))

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

const task = {
  id: 'task-1',
  title: '测试作品',
  providerKey: 'pixiv',
  externalId: '1234',
  status: 'RUNNING',
  systemJobStatus: 'RUNNING',
  progress: 25,
  completedItems: 1,
  failedItems: 0,
  totalItems: 4,
  createdAt: '2026-10-10T00:00:00.000Z',
  effectiveCreators: [{ id: 11, name: '已绑定艺术家' }],
  pendingCreators: [{ id: 12, name: '待生效艺术家' }]
} as unknown as ComponentProps<typeof ArchiveTaskCard>['task']

describe('archive task layout interactions', () => {
  it('opens artist details from names and keeps editing inside the task menu', async () => {
    render(
      <ArchiveTaskCard
        task={task}
        selected={false}
        pendingActions={new Set()}
        onToggle={vi.fn()}
        onViewItems={vi.fn()}
        onAction={vi.fn()}
      />
    )
    const bound = screen.getByRole('link', { name: '已绑定艺术家' })
    expect(bound.getAttribute('href')).toBe('/artists/11')
    expect(bound.querySelector('[data-privacy-sensitive]')).toBeTruthy()
    expect(screen.getByRole('link', { name: '待生效艺术家（待生效）' }).getAttribute('href')).toBe('/artists/12')
    expect(screen.queryByRole('button', { name: '管理艺术家' })).toBeNull()
    fireEvent.keyDown(screen.getByRole('button', { name: '打开任务操作菜单' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: '管理艺术家' }))
    expect(screen.getByRole('dialog', { name: '管理艺术家' }).textContent).toContain('task-1')
    fireEvent.click(screen.getByRole('button', { name: '关闭管理艺术家' }))
    expect(screen.queryByRole('dialog', { name: '管理艺术家' })).toBeNull()
  })

  it('starts collapsed and retains download controls when expanded', () => {
    const onViewItems = vi.fn()
    const onPause = vi.fn()
    const onCancel = vi.fn()
    render(
      <ArchiveDownloadFloater
        task={task}
        pausePending={false}
        cancelPending={false}
        onViewItems={onViewItems}
        onPause={onPause}
        onCancel={onCancel}
      />
    )
    expect(screen.queryByRole('region', { name: '当前归档下载' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '当前下载 25%，点击展开' }))
    expect(screen.getByRole('region', { name: '当前归档下载' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '暂停' }))
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(onPause).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: '查看全部图片' }))
    expect(onViewItems).toHaveBeenCalledOnce()
    expect(screen.queryByRole('region', { name: '当前归档下载' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '当前下载 25%，点击展开' }))
    fireEvent.click(screen.getByRole('button', { name: '收起当前下载' }))
    expect(screen.queryByRole('region', { name: '当前归档下载' })).toBeNull()
  })

  it('retains pending and stopping guards in the floating download panel', () => {
    const onPause = vi.fn()
    const onCancel = vi.fn()
    render(
      <ArchiveDownloadFloater
        task={{ ...task, systemJobStatus: 'CANCELLING' }}
        pausePending={true}
        cancelPending={true}
        onViewItems={vi.fn()}
        onPause={onPause}
        onCancel={onCancel}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '正在取消 25%，点击展开' }))
    fireEvent.click(screen.getByRole('button', { name: /暂停$/ }))
    fireEvent.click(screen.getByRole('button', { name: /正在取消$/ }))
    expect(onPause).not.toHaveBeenCalled()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('applies drafts across the portal while preserving immediate filters and reset', () => {
    const onApply = vi.fn()
    const onImmediate = vi.fn()
    const empty: TaskFilters = {
      status: 'ALL',
      kind: 'ALL',
      providerKey: '',
      submissionId: '',
      search: '',
      unboundOnly: false
    }
    function Filters() {
      const [applied, setApplied] = useState(empty)
      const [draft, setDraft] = useState(empty)
      return (
        <ArchiveTaskToolbar
          value={draft}
          appliedValue={applied}
          onChange={setDraft}
          onImmediateChange={(patch) => {
            onImmediate(patch)
            setDraft((current) => ({ ...current, ...patch }))
            setApplied((current) => ({ ...current, ...patch }))
          }}
          onSubmit={() => {
            const next = normalizeTaskFilters(draft)
            onApply(next)
            setApplied(next)
            setDraft(next)
          }}
          onReset={() => {
            setDraft(empty)
            setApplied(empty)
          }}
        />
      )
    }
    render(<Filters />)
    const toolbar = screen.getByRole('region', { name: '归档任务筛选' })
    fireEvent.change(screen.getByLabelText('标题或来源'), { target: { value: '  标题  ' } })
    expect(onApply).not.toHaveBeenCalled()
    fireEvent.click(within(toolbar).getByRole('button', { name: '更多筛选' }))
    const provider = screen.getByLabelText<HTMLInputElement>('来源站点')
    expect(provider.form?.id).toBe('archive-task-filters')
    fireEvent.change(provider, { target: { value: ' pixiv ' } })
    fireEvent.change(screen.getByLabelText('本次加入 ID'), { target: { value: ' submission-1 ' } })
    fireEvent.click(screen.getByRole('checkbox', { name: '仅看未绑定艺术家' }))
    expect(onImmediate).toHaveBeenCalledWith({ unboundOnly: true })
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))
    expect(onApply).toHaveBeenCalledWith({
      ...empty,
      providerKey: 'pixiv',
      submissionId: 'submission-1',
      search: '标题',
      unboundOnly: true
    })
    expect(screen.queryByLabelText('来源站点')).toBeNull()
    expect(screen.getByRole('button', { name: /更多筛选\s*3/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '清除' }))
    expect((screen.getByLabelText('标题或来源') as HTMLInputElement).value).toBe('')
    expect(screen.getByRole('button', { name: '筛选' }).hasAttribute('disabled')).toBe(true)
  })
})
