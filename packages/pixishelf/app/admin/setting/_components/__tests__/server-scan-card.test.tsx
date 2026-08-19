import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ServerScanCard } from '../server-scan-card'

describe('ServerScanCard', () => {
  it('exposes one safe discovery action and invokes its callback', () => {
    const onScanNewArtworks = vi.fn()

    render(
      <ServerScanCard
        scanPathData="/data/pixiv"
        isUpdatingPath={false}
        isScanning={false}
        healthStatus="ok"
        onUpdatePath={vi.fn()}
        onScanNewArtworks={onScanNewArtworks}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: '扫描新作品' }))

    expect(onScanNewArtworks).toHaveBeenCalledOnce()
    expect(screen.queryByText('强制全量重扫')).toBeNull()
    expect(screen.queryByText(/删除并重建/)).toBeNull()
  })
})
