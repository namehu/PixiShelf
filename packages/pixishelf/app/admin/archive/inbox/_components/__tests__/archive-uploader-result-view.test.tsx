import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArchiveUploaderResultViewToggle } from '../archive-uploader-result-visuals'
import type { ArchiveUploaderResultView } from '@/store/admin/use-admin-preferences-store'

vi.mock('@/components/source-preview/source-preview-button', () => ({ SourcePreviewButton: () => null }))

afterEach(cleanup)

function Harness() {
  const [value, setValue] = useState<ArchiveUploaderResultView>('list')
  return <ArchiveUploaderResultViewToggle value={value} onChange={setValue} />
}

describe('compact archive result view menu', () => {
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
