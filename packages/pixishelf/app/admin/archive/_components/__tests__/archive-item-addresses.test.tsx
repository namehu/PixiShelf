import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArchiveItemAddresses } from '../archive-item-addresses'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('archive item addresses', () => {
  it('shows and copies full URLs and opens without a referrer', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
    const source = 'https://e-hentai.org/s/full-token/42-240'
    const download = 'https://media.hath.network:2333/full/path?key=signed-token'
    render(
      <ArchiveItemAddresses
        sourcePageUrl={source}
        lastDownloadUrl={download}
        lastDownloadAt="2026-09-16T12:00:00Z"
        lastDownloadAttempt={3}
      />
    )
    expect(screen.getByText(source).hasAttribute('data-privacy-sensitive')).toBe(true)
    expect(screen.getByText(download)).toBeTruthy()
    const link = screen.getByRole('link', { name: '打开下载地址' })
    expect(link.getAttribute('href')).toBe(download)
    expect(link.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(link.getAttribute('rel')).toContain('noreferrer')
    fireEvent.click(screen.getByRole('button', { name: '复制下载地址' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(download))
  })

  it('explains missing historical addresses without inventing a link', () => {
    render(
      <ArchiveItemAddresses
        sourcePageUrl={null}
        lastDownloadUrl={null}
        lastDownloadAt={null}
        lastDownloadAttempt={null}
      />
    )
    expect(screen.getByText('尚未记录下载地址；重试收到媒体响应后会记录。')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })
})
