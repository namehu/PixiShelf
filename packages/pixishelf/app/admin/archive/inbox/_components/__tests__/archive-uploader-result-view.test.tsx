import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArchiveUploaderGalleryThumbnail, ArchiveUploaderResultViewToggle } from '../archive-uploader-result-visuals'
import type { ArchiveUploaderResultView } from '@/store/admin/use-admin-preferences-store'

afterEach(cleanup)

function Harness() {
  const [value, setValue] = useState<ArchiveUploaderResultView>('list')
  return <ArchiveUploaderResultViewToggle value={value} onChange={setValue} />
}

describe('compact archive result view menu', () => {
  it.each([false, true])('keeps covers display-only through loading and failure states (card=%s)', (card) => {
    const item = { id: 'catalog', title: 'Gallery', externalId: '123', thumbnailUrl: 'https://ehgt.org/cover.jpg' }
    const { container, rerender } = render(<ArchiveUploaderGalleryThumbnail item={item} card={card} />)
    const cover = container.querySelector('[data-discovery-thumbnail]')!
    const image = cover.querySelector('img')!
    expect(image.getAttribute('loading')).toBe('lazy')
    expect(image.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(image.getAttribute('alt')).toBe('')
    expect(image.classList.contains('opacity-0')).toBe(true)
    fireEvent.load(image)
    expect(image.classList.contains('opacity-0')).toBe(false)
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    fireEvent.error(image)
    expect(cover.querySelector('img')).toBeNull()
    expect(screen.getByLabelText('Gallery 没有可用首图')).toBeTruthy()
    rerender(<ArchiveUploaderGalleryThumbnail item={{ ...item, thumbnailUrl: null }} card={card} />)
    expect(screen.getByLabelText('Gallery 没有可用首图')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('shows only one trigger and switches modes through the menu', async () => {
    render(<Harness />)
    expect(screen.getAllByRole('button')).toHaveLength(1)
    expect(screen.queryByRole('menu')).toBeNull()
    for (const [action, label] of [
      ['显示首图预览', '首图预览'],
      ['使用卡片模式', '卡片'],
      ['使用纯列表', '纯列表']
    ]) {
      fireEvent.keyDown(screen.getByRole('button', { name: /^显示模式：/ }), { key: 'Enter' })
      const option = await screen.findByRole('menuitemradio', { name: action })
      expect(screen.getAllByRole('menuitemradio')).toHaveLength(3)
      fireEvent.click(option)
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
      expect(screen.getByRole('button', { name: `显示模式：${label}` })).toBeTruthy()
    }
  })

  it('marks the saved mode and closes on Escape without changing it', async () => {
    const onChange = vi.fn()
    render(<ArchiveUploaderResultViewToggle value="cards" onChange={onChange} />)
    const trigger = screen.getByRole('button', { name: '显示模式：卡片' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    const current = await screen.findByRole('menuitemradio', { name: '使用卡片模式' })
    expect(current.getAttribute('aria-checked')).toBe('true')
    expect(screen.getByRole('menuitemradio', { name: '使用纯列表' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.keyDown(current, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    expect(onChange).not.toHaveBeenCalled()
    await waitFor(() => expect(document.activeElement).toBe(trigger))
  })
})
