import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArchiveDiscoveryBulkBar, ArchiveDiscoverySelectionBar } from '../archive-discovery-bulk-bar'
import { ArchiveIntakeOptionsDialog, DEFAULT_ARCHIVE_INTAKE_OPTIONS } from '../archive-intake-options'

afterEach(cleanup)

describe('discovery selection actions', () => {
  it('hides the bar until an item is selected', () => {
    render(
      <ArchiveDiscoverySelectionBar
        selectedCount={0}
        pending={false}
        onClear={vi.fn()}
        primaryAction={<button>加入收件箱</button>}
      />
    )
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('keeps eligible primary and secondary counts visible and moves other actions into the menu', async () => {
    const ignore = vi.fn()
    const bind = vi.fn()
    render(
      <ArchiveDiscoveryBulkBar
        selectedCount={5}
        addCount={2}
        deferCount={3}
        ignoreCount={3}
        kind="catalog"
        pending={false}
        onClear={vi.fn()}
        onAdd={vi.fn()}
        onDefer={vi.fn()}
        onIgnore={ignore}
        onBind={bind}
        options={<span>自动下载 · 原图 · 全部</span>}
      />
    )
    expect(screen.getByText('已选择 5 项')).toBeTruthy()
    expect(screen.getByRole('button', { name: '加入收件箱' }).textContent).toBe('加入收件箱（2）')
    expect(screen.getByRole('button', { name: '稍后决定' }).textContent).toBe('稍后决定（3）')
    expect(screen.getByText('自动下载 · 原图 · 全部')).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: '忽略' })).toBeNull()

    fireEvent.keyDown(screen.getByRole('button', { name: '更多操作' }), { key: 'ArrowDown' })
    const ignoreItem = await screen.findByRole('menuitem', { name: '忽略' })
    expect(ignoreItem.textContent).toBe('忽略（3）')
    expect(screen.getByRole('menuitem', { name: '绑定艺术家（5）' })).toBeTruthy()
    fireEvent.click(ignoreItem)
    expect(ignore).toHaveBeenCalledOnce()
    expect(bind).not.toHaveBeenCalled()
  })

  it('explains an empty eligible selection and disables actions during a request', () => {
    const view = render(
      <ArchiveDiscoveryBulkBar
        selectedCount={2}
        addCount={0}
        kind="catalog"
        pending={false}
        onClear={vi.fn()}
        onAdd={vi.fn()}
        onDefer={vi.fn()}
        onIgnore={vi.fn()}
      />
    )
    expect((screen.getByRole('button', { name: '加入收件箱' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText('所选项目暂无可加入项')).toBeTruthy()

    view.rerender(
      <ArchiveDiscoveryBulkBar
        selectedCount={2}
        kind="catalog"
        pending
        onClear={vi.fn()}
        onAdd={vi.fn()}
        onDefer={vi.fn()}
        onIgnore={vi.fn()}
      />
    )
    for (const name of ['清除选择', '更多操作', '稍后决定', '加入收件箱']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true)
    }
  })

  it('restores ignored selections with their selected count', () => {
    const restore = vi.fn()
    render(
      <ArchiveDiscoveryBulkBar selectedCount={4} kind="ignored" pending={false} onClear={vi.fn()} onRestore={restore} />
    )
    const button = screen.getByRole('button', { name: '恢复' })
    expect(button.textContent).toBe('恢复（4）')
    fireEvent.click(button)
    expect(restore).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: '更多操作' })).toBeNull()
  })

  it('runs the mobile secondary action from the menu and closes it', async () => {
    const defer = vi.fn()
    render(
      <ArchiveDiscoveryBulkBar
        selectedCount={100}
        kind="catalog"
        pending={false}
        onClear={vi.fn()}
        onAdd={vi.fn()}
        onDefer={defer}
      />
    )
    fireEvent.keyDown(screen.getByRole('button', { name: '更多操作' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('menuitem', { name: '稍后决定' }))
    expect(defer).toHaveBeenCalledOnce()
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

it('keeps the intake summary textual in selection presentation and edits the same options', () => {
  function Options() {
    const [value, setValue] = useState(DEFAULT_ARCHIVE_INTAKE_OPTIONS)
    return <ArchiveIntakeOptionsDialog value={value} onChange={setValue} presentation="selection" />
  }
  render(<Options />)
  const summary = screen.getByText('自动下载 · 展示图 · 全部')
  expect(summary.className).not.toContain('hidden')
  fireEvent.click(screen.getByRole('button', { name: '自动下载 · 展示图 · 全部' }))
  fireEvent.click(screen.getByRole('radio', { name: '前20张' }))
  fireEvent.click(screen.getByRole('button', { name: '完成' }))
  expect(screen.getByRole('button', { name: '自动下载 · 展示图 · 前20张' })).toBeTruthy()
})
