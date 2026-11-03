import React, { Suspense, isValidElement, type ReactElement, type ReactNode } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  StatisticsMetric as renderMetric,
  StatisticsLeaderboard as renderLeaderboard,
  StatisticsStorageSection as renderStorage,
  StoragePlaceholder,
  RankingPlaceholder
} from '../statistics-sections'
import renderPage from '../../page'

vi.mock('@/services/statistics-service', () => ({
  loadStatisticsSections: () => ({
    basic: Promise.resolve({ ok: true, value: { artworks: 1, artists: 1, tags: 1 } }),
    images: Promise.resolve({ ok: true, value: 0 }),
    artists: Promise.resolve({ ok: true, value: [] }),
    tags: Promise.resolve({ ok: true, value: [] }),
    storage: Promise.resolve({ ok: true, value: { totalBytes: 0, categories: [], unknownSizeCount: 0, computedAt: '2026-11-03T04:00:00.000Z' } })
  })
}))
vi.mock('@/components/privacy/privacy-sensitive-text', () => ({
  PrivacySensitiveText: ({ children }: { children: ReactNode }) => <span>{children}</span>
}))
afterEach(cleanup)

describe('statistics sections', () => {
  it('keeps page chrome synchronous and isolates all metrics and both rankings with Suspense', () => {
    const page = renderPage()
    const boundaries: ReactElement[] = []
    const visit = (node: unknown) => {
      if (Array.isArray(node)) return node.forEach(visit)
      if (!isValidElement(node)) return
      if (node.type === Suspense) boundaries.push(node)
      const props = node.props as { children?: unknown; value?: unknown }
      visit(props.children)
      visit(props.value)
    }
    visit(page)
    expect(boundaries).toHaveLength(7)
    expect((page.props as { title: string }).title).toBe('图库状态')
  })

  it('shows total, category sizes, measurement time and incomplete-size coverage', async () => {
    render(await renderStorage({ data: Promise.resolve({ ok: true, value: {
      totalBytes: 6 * 1024 ** 3,
      categories: [
        { type: 'IMAGE', bytes: 3 * 1024 ** 3 },
        { type: 'ANIMATION', bytes: 2 * 1024 ** 3 },
        { type: 'VIDEO', bytes: 1024 ** 3 },
        { type: 'UNKNOWN', bytes: 0 }
      ],
      unknownSizeCount: 2,
      computedAt: '2026-11-03T04:00:00.000Z'
    } }) }))
    expect(screen.getByText('媒体总占用')).toBeTruthy()
    for (const label of ['静态图片', '动图', '视频', '其他']) expect(screen.getByText(label)).toBeTruthy()
    expect(screen.getByText(/另有 2 个文件尚未登记大小/)).toBeTruthy()
    expect(document.querySelector('time')?.dateTime).toBe('2026-11-03T04:00:00.000Z')
    expect(screen.getByText('6')).toBeTruthy()
  })

  it('distinguishes storage loading, an empty library and a failed query', async () => {
    render(<StoragePlaceholder />)
    expect(screen.getByLabelText('媒体占用加载中').getAttribute('aria-busy')).toBe('true')
    cleanup()
    render(await renderStorage({ data: Promise.resolve({ ok: true, value: {
      totalBytes: 0, categories: [], unknownSizeCount: 0, computedAt: '2026-11-03T04:00:00.000Z'
    } }) }))
    expect(screen.getAllByText('0')).toHaveLength(4)
    expect(screen.queryByText('其他')).toBeNull()
    cleanup()
    render(await renderStorage({ data: Promise.resolve({ ok: false }) }))
    expect(screen.getByText('媒体占用加载失败')).toBeTruthy()
    expect(screen.queryByText('0')).toBeNull()
  })

  it('shows a real zero and a distinct localized failure, never a false zero on error', async () => {
    render(await renderMetric({ data: Promise.resolve({ ok: true, value: 0 }) }))
    expect(screen.getByText('0')).toBeTruthy()
    cleanup()
    render(await renderMetric({ data: Promise.resolve({ ok: false }) }))
    expect(screen.getByRole('status').textContent).toContain('加载失败')
    expect(screen.queryByText('0')).toBeNull()
  })

  it('renders successful content while a sibling is pending and shows a ranking error separately', async () => {
    let resolve!: (value: { ok: false }) => void
    const slow = renderLeaderboard({
      title: '热门艺术家',
      description: '排行',
      type: 'artist',
      data: new Promise((done) => {
        resolve = done
      })
    })
    const fast = await renderLeaderboard({
      title: '热门标签',
      description: '排行',
      type: 'tag',
      data: Promise.resolve({ ok: true, value: [{ id: 9, name: '标签 A', count: 3 }] })
    })
    render(fast)
    expect(screen.getByRole('link', { name: /标签 A/ }).getAttribute('href')).toBe('/tags/9')
    resolve({ ok: false })
    render(await slow)
    expect(screen.getByText('排行加载失败')).toBeTruthy()
    expect(screen.getByRole('link', { name: /标签 A/ })).toBeTruthy()
  })

  it('distinguishes loading, an empty leaderboard and an error', async () => {
    const { container } = render(<RankingPlaceholder title="热门艺术家" />)
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    cleanup()
    render(
      await renderLeaderboard({
        title: '热门艺术家',
        description: '排行',
        type: 'artist',
        data: Promise.resolve({ ok: true, value: [] })
      })
    )
    expect(screen.getByText('暂无排行数据')).toBeTruthy()
    expect(screen.queryByText('排行加载失败')).toBeNull()
  })
})
