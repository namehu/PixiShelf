import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchiveAddDialog } from '../archive-add-dialog'

const mocks = vi.hoisted(() => ({
  invalidateQueries: vi.fn(),
  mutate: vi.fn()
}))

vi.mock('@tanstack/react-query', () => ({
  useMutation: () => ({ isPending: false, mutate: mocks.mutate }),
  useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries })
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    archiveInbox: {
      create: { mutationOptions: (options: unknown) => options },
      list: { queryKey: () => ['archive-inbox', 'list'] },
      summary: { queryKey: () => ['archive-inbox', 'summary'] }
    }
  })
}))

describe('ArchiveAddDialog', () => {
  beforeEach(() => {
    mocks.mutate.mockReset()
    mocks.invalidateQueries.mockReset()
  })

  afterEach(() => {
    cleanup()
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
  })

  it('reads the clipboard on explicit action and appends without submitting', async () => {
    const readText = vi.fn().mockResolvedValue('https://e-hentai.org/s/page-token/1234567-1')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText } })

    render(<ArchiveAddDialog />)
    fireEvent.click(screen.getByRole('button', { name: '添加链接' }))

    const input = screen.getByLabelText('作品链接')
    fireEvent.change(input, { target: { value: 'https://e-hentai.org/g/1234567/token/' } })
    fireEvent.click(screen.getByRole('button', { name: '从剪贴板粘贴' }))

    await waitFor(() => {
      expect((input as HTMLTextAreaElement).value).toBe(
        'https://e-hentai.org/g/1234567/token/\nhttps://e-hentai.org/s/page-token/1234567-1'
      )
    })
    expect(readText).toHaveBeenCalledOnce()
    expect(screen.getByText('已粘贴 · 2 条链接可加入')).toBeTruthy()
    expect(mocks.mutate).not.toHaveBeenCalled()
  })

  it('keeps manual paste available when clipboard permission is denied', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')) }
    })

    render(<ArchiveAddDialog />)
    fireEvent.click(screen.getByRole('button', { name: '添加链接' }))
    fireEvent.click(screen.getByRole('button', { name: '从剪贴板粘贴' }))

    expect(await screen.findByText('浏览器未允许读取剪贴板，请在输入框内手动粘贴。')).toBeTruthy()
    expect(screen.getByLabelText('作品链接').hasAttribute('disabled')).toBe(false)
    expect(mocks.mutate).not.toHaveBeenCalled()
  })
})
