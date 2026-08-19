import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ScanStats } from '../scan-stats'

describe('ScanStats', () => {
  it('reports skipped existing artworks without destructive rebuild language', () => {
    render(
      <ScanStats
        result={{
          totalArtworks: 12,
          newArtists: 0,
          newTags: 0,
          skippedArtworks: 7,
          processingTime: 100,
          newArtworks: 12,
          newImages: 24,
          removedArtworks: 12,
          errors: []
        }}
      />
    )

    expect(screen.getByText('跳过已有作品')).toBeTruthy()
    expect(screen.getByText('7')).toBeTruthy()
    expect(screen.queryByText('重建 Pixiv 作品')).toBeNull()
    expect(screen.queryByText('强扫时删除并重新扫描')).toBeNull()
  })
})
