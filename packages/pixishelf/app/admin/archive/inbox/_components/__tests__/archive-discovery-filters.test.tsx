import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArchiveDiscoveryContentFilters } from '../archive-discovery-content-filters'
import {
  DEFAULT_DISCOVERY_FILTERS,
  DEFAULT_SOURCE_FILTERS,
  discoveryQueryFilters,
  filterDiscoverySources
} from '../archive-discovery-filter-state'
import { source } from './archive-uploader-sources-fixtures'
import { archiveDiscoveryFiltersSchema } from '@/lib/archive-discovery-filters'

const layout = vi.hoisted(() => ({ desktop: true }))
vi.mock('@/hooks/use-media-query', () => ({ useMediaQuery: () => layout.desktop }))
// Vaul's CSS animation completion is unavailable in jsdom; keep the real dialog/focus primitives.
vi.mock('@/components/ui/drawer', async () => {
  const dialog = await import('@/components/ui/dialog')
  return {
    Drawer: dialog.Dialog,
    DrawerTrigger: dialog.DialogTrigger,
    DrawerContent: dialog.DialogContent,
    DrawerHeader: dialog.DialogHeader,
    DrawerTitle: dialog.DialogTitle,
    DrawerDescription: dialog.DialogDescription
  }
})
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    }
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function Harness({ changed }: { changed: (value: unknown) => void }) {
  const [value, setValue] = useState(DEFAULT_DISCOVERY_FILTERS)
  return (
    <ArchiveDiscoveryContentFilters
      value={value}
      onChange={(next) => {
        changed(next)
        setValue(next)
      }}
    />
  )
}

describe('discovery filters', () => {
  it('filters the full source collection before pagination and excludes stopped sources by default', () => {
    const sources = Array.from({ length: 120 }, (_, index) => ({
      ...source,
      id: String(index),
      displayName: `Source ${index}`,
      sourceKind: 'UPLOADER',
      status: index === 110 ? 'ARCHIVED' : 'ACTIVE',
      latestRun: null
    })) as unknown as Parameters<typeof filterDiscoverySources>[0]
    expect(filterDiscoverySources(sources, DEFAULT_SOURCE_FILTERS)).toHaveLength(119)
    expect(
      filterDiscoverySources(sources, { ...DEFAULT_SOURCE_FILTERS, search: 'Source 119' }).map((item) => item.id)
    ).toEqual(['119'])
    expect(filterDiscoverySources(sources, { ...DEFAULT_SOURCE_FILTERS, search: '110' })).toEqual([])
    expect(
      filterDiscoverySources(sources, { ...DEFAULT_SOURCE_FILTERS, status: 'ARCHIVED' }).map((item) => item.id)
    ).toEqual(['110'])
    expect(filterDiscoverySources(sources, { ...DEFAULT_SOURCE_FILTERS, attention: true })).toEqual([])
    expect(
      filterDiscoverySources([{ ...sources[0]!, catalogCounts: null }], { ...DEFAULT_SOURCE_FILTERS, actionable: true })
    ).toEqual([])
  })

  it('converts inclusive local calendar dates into an exclusive next-day boundary', () => {
    const filters = discoveryQueryFilters({
      ...DEFAULT_DISCOVERY_FILTERS,
      dateFrom: '2026-10-09',
      dateTo: '2026-10-09'
    })
    expect(filters.postedFrom).toEqual(new Date(2026, 9, 9))
    expect(filters.postedBefore).toEqual(new Date(2026, 9, 10))
    expect(discoveryQueryFilters({ ...DEFAULT_DISCOVERY_FILTERS, unknownDate: true }).postedFrom).toBeUndefined()
    expect(archiveDiscoveryFiltersSchema.safeParse({ languages: ['translated'] }).success).toBe(false)
    expect(
      archiveDiscoveryFiltersSchema.safeParse({ postedFrom: new Date(2026, 9, 10), postedBefore: new Date(2026, 9, 9) })
        .success
    ).toBe(false)
    expect(archiveDiscoveryFiltersSchema.safeParse({ unknownDate: true, postedFrom: new Date() }).success).toBe(false)
  })

  it.each([true, false])('applies drafts atomically, cancels edits and removes chips (desktop=%s)', async (desktop) => {
    layout.desktop = desktop
    const changed = vi.fn()
    render(<Harness changed={changed} />)
    fireEvent.click(screen.getByRole('button', { name: '筛选' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '中文' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Manga' }))
    fireEvent.click(screen.getByRole('checkbox', { name: '仅看未绑定' }))
    expect(changed).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(changed).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '筛选' }))
    expect(screen.getByRole('checkbox', { name: '中文' }).getAttribute('aria-checked')).toBe('false')
    fireEvent.click(screen.getByRole('checkbox', { name: '语言未知' }))
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ languages: ['__unknown__'] }))
    fireEvent.click(screen.getByRole('button', { name: '移除语言未知' }))
    expect(changed).toHaveBeenLastCalledWith(expect.objectContaining({ languages: [] }))
  })
})
