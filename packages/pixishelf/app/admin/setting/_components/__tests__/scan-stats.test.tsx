import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ScanStats } from '../scan-stats'

describe('ScanStats', () => {
  it('describes removed artworks as force-rebuilt Pixiv data', () => {
    render(
      <ScanStats
        result={{
          totalArtworks: 12,
          newArtists: 0,
          newTags: 0,
          skippedArtworks: 0,
          processingTime: 100,
          newArtworks: 12,
          newImages: 24,
          removedArtworks: 12,
          errors: []
        }}
      />
    )

    expect(screen.getByText('重建 Pixiv 作品')).toBeTruthy()
    expect(screen.getByText('强扫时删除并重新扫描')).toBeTruthy()
    expect(screen.queryByText('已清理无效文件夹')).toBeNull()
  })
})
