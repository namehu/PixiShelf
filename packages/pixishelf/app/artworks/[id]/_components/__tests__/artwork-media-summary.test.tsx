import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ArtworkMediaSummary } from '../artwork-media-summary'

afterEach(cleanup)

describe('artwork media summary', () => {
  it.each([
    [1, '预计阅读不到 1 分钟'], [59, '预计阅读不到 1 分钟'],
    [60, '预计阅读约 1 分钟'], [61, '预计阅读约 2 分钟'], [120, '预计阅读约 2 分钟']
  ])('estimates %i logical items at one second each', (count, expected) => {
    render(<ArtworkMediaSummary count={count} totalBytes={3 * 1024 ** 3} />)
    expect(screen.getByLabelText('作品媒体信息').textContent).toContain(expected)
    expect(screen.getByText('3 GB')).toBeTruthy()
  })

  it('hides the estimate for an empty work and identifies incomplete sizes', () => {
    const { rerender } = render(<ArtworkMediaSummary count={0} totalBytes={0} />)
    expect(screen.queryByText(/预计阅读/)).toBeNull()
    expect(screen.getByText('0 B')).toBeTruthy()
    rerender(<ArtworkMediaSummary count={2} totalBytes={1024} unknownSizeCount={1} />)
    expect(screen.getByText(/已知本地文件/)).toBeTruthy()
    expect(screen.getByText('另有 1 个文件大小未知')).toBeTruthy()
  })
})
