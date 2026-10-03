import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtworkDeletePreviewDrawer } from '../artwork-delete-preview'
import type { ArtworkDeletePreview } from '@/schemas/artwork-delete.dto'

const directory = 'artist/work'
function fixture(): ArtworkDeletePreview {
  return {
    artwork: { id: 42, title: '测试作品', createdVia: 'LOCAL_DIRECTORY', directory },
    mode: 'DIRECT_DELETE',
    directoryMode: 'WORK_DIRECTORY',
    canDelete: true,
    inspectionComplete: true,
    warnings: [],
    entries: [
      { path: directory, kind: 'DIRECTORY', selection: 'DIRECTORY', missing: false, reason: '清空后删除' },
      { path: `${directory}/image.jpg`, kind: 'MEDIA', selection: 'REQUIRED', missing: false, reason: '登记媒体' },
      {
        path: `${directory}/133479323-简介-links.txt`,
        kind: 'OTHER',
        selection: 'OPTIONAL',
        missing: false,
        reason: '附属文件'
      }
    ]
  }
}
const originalScrollTo = HTMLElement.prototype.scrollTo
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
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  HTMLElement.prototype.scrollTo = originalScrollTo
})
async function setup(preview = fixture(), onDelete = vi.fn().mockResolvedValue(undefined)) {
  const loadPreview = vi.fn().mockResolvedValue(preview)
  const onClose = vi.fn()
  render(<ArtworkDeletePreviewDrawer artworkId={42} loadPreview={loadPreview} onDelete={onDelete} onClose={onClose} />)
  await screen.findByText('测试作品 · 作品 #42')
  if (preview.mode !== 'ARCHIVE_TRASH' && preview.entries.length) {
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0))
  }
  return { onDelete, loadPreview, onClose }
}

describe('delete preview', () => {
  it('defaults to all safe files, locks media, and submits exact choices', async () => {
    const { onDelete } = await setup()
    const media = screen.getByRole('checkbox', { name: `选择 ${directory}/image.jpg` }) as HTMLButtonElement
    const txt = screen.getByRole('checkbox', { name: `选择 ${directory}/133479323-简介-links.txt` })
    expect(media.disabled).toBe(true)
    expect(media.getAttribute('aria-checked')).toBe('true')
    expect(txt.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByText('133479323-简介-links.txt').hasAttribute('data-privacy-sensitive')).toBe(true)
    fireEvent.click(txt)
    expect(screen.getByRole('status').textContent).toContain('保留 1')
    expect(screen.getByRole('status').textContent).toContain('保留目录')
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() =>
      expect(onDelete).toHaveBeenCalledWith({ artworkId: 42, selectedPaths: [`${directory}/image.jpg`] })
    )
  })

  it('virtualizes 2,000 files, keeps selection after scrolling, and toggles all directory descendants', async () => {
    const preview = fixture()
    preview.entries = [
      preview.entries[0]!,
      preview.entries[1]!,
      ...Array.from({ length: 2000 }, (_, index) => ({
        path: `${directory}/${String(index).padStart(4, '0')}.txt`,
        kind: 'OTHER' as const,
        selection: 'OPTIONAL' as const,
        missing: false,
        reason: '附属文件'
      }))
    ]
    const { onDelete } = await setup(preview)
    expect(screen.getAllByRole('listitem').length).toBeLessThan(32)
    expect(screen.queryByRole('button', { name: '下一页' })).toBeNull()
    fireEvent.click(screen.getByRole('checkbox', { name: `选择 ${directory}/0000.txt` }))
    const scroll = screen.getByLabelText('删除文件列表')
    scroll.scrollTop = 2002 * 48 - 640
    fireEvent.scroll(scroll)
    const last = await screen.findByRole('checkbox', { name: `选择 ${directory}/1999.txt` })
    expect(last.getAttribute('aria-checked')).toBe('true')
    expect(screen.getAllByRole('listitem').length).toBeLessThan(32)
    fireEvent.click(last)
    scroll.scrollTop = 0
    fireEvent.scroll(scroll)
    expect(
      (await screen.findByRole('checkbox', { name: `选择 ${directory}/0000.txt` })).getAttribute('aria-checked')
    ).toBe('false')
    const dir = screen.getByRole('checkbox', { name: `选择 ${directory}` })
    expect(dir.getAttribute('aria-checked')).toBe('mixed')
    fireEvent.click(dir)
    fireEvent.click(dir)
    fireEvent.change(screen.getByLabelText('搜索路径'), { target: { value: '1999.txt' } })
    expect(
      (await screen.findByRole('checkbox', { name: `选择 ${directory}/1999.txt` })).getAttribute('aria-checked')
    ).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() =>
      expect(onDelete).toHaveBeenCalledWith({ artworkId: 42, selectedPaths: [`${directory}/image.jpg`] })
    )
  })

  it('keeps range explanations collapsed and reveals full file details on demand', async () => {
    const preview = fixture()
    preview.warnings = ['共享目录中的额外文件不可选。']
    await setup(preview)
    expect(screen.queryByText(preview.warnings[0]!)).toBeNull()
    expect(screen.queryByText('附属文件')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: `文件详情 ${directory}/133479323-简介-links.txt` }))
    expect(await screen.findByText(`${directory}/133479323-简介-links.txt`)).toBeTruthy()
    expect(screen.getByText('附属文件')).toBeTruthy()
    fireEvent.keyDown(screen.getByText('附属文件'), { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: '范围说明' }))
    expect(await screen.findByText(preview.warnings[0]!)).toBeTruthy()
  })

  it('disables incomplete previews and reloads', async () => {
    const preview = { ...fixture(), canDelete: false, inspectionComplete: false }
    const { loadPreview, onDelete } = await setup(preview)
    expect((screen.getByRole('button', { name: '确认删除' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '重新加载' }))
    await waitFor(() => expect(loadPreview).toHaveBeenCalledTimes(2))
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('shows shared media and extra files as disabled retained entries', async () => {
    const preview = fixture()
    preview.directoryMode = 'SHARED_DIRECTORY'
    preview.entries = preview.entries.map((entry) => ({ ...entry, selection: 'BLOCKED', reason: '共享引用，保留' }))
    const { onDelete } = await setup(preview)
    for (const checkbox of screen.getAllByRole('checkbox')) {
      expect((checkbox as HTMLButtonElement).disabled).toBe(true)
      expect(checkbox.getAttribute('aria-checked')).toBe('false')
    }
    expect(screen.getByRole('status').textContent).toContain('保留 2')
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith({ artworkId: 42, selectedPaths: [] }))
  })

  it('submits archive requests without a selection', async () => {
    const preview = fixture()
    preview.mode = 'ARCHIVE_TRASH'
    preview.entries = []
    const { onDelete } = await setup(preview)
    expect(screen.queryByRole('checkbox')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '确认移入回收站' }))
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith({ artworkId: 42 }))
  })

  it('does not submit twice or dismiss while pending', async () => {
    let resolve!: () => void
    const onDelete = vi.fn(
      () =>
        new Promise<void>((done) => {
          resolve = done
        })
    )
    const { onClose } = await setup(fixture(), onDelete)
    const button = screen.getByRole('button', { name: '确认删除' })
    fireEvent.click(button)
    fireEvent.click(button)
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onClose).not.toHaveBeenCalled()
    resolve()
    await waitFor(() => expect(screen.getByRole('button', { name: '确认删除' })).toBeTruthy())
  })

  it('does not retry an unconfirmed request', async () => {
    const onDelete = vi.fn().mockRejectedValue(new Error('network'))
    await setup(fixture(), onDelete)
    fireEvent.click(screen.getByRole('button', { name: '确认删除' }))
    await screen.findByText('删除结果未确认')
    expect((screen.getByRole('button', { name: '确认删除' }) as HTMLButtonElement).disabled).toBe(true)
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('shows a loading error without a delete control', async () => {
    render(
      <ArtworkDeletePreviewDrawer
        artworkId={42}
        loadPreview={vi.fn().mockRejectedValue(new Error('offline'))}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />
    )
    await screen.findByText('无法读取删除清单')
    expect(screen.queryByRole('button', { name: '确认删除' })).toBeNull()
  })
})
