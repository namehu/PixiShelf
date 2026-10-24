import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArtistDiscoveryActions, ArtistDiscoverySources } from '../artist-discovery-sources'

const source = {
  id: 'one',
  providerKey: 'e-hentai',
  sourceKind: 'TITLE_QUERY' as const,
  displayName: 'Saved collection',
  status: 'ACTIVE' as const
}
afterEach(cleanup)

describe('artist discovery source controls', () => {
  it('offers creation for an unbound artist', () => {
    const onCreate = vi.fn()
    render(<ArtistDiscoverySources sources={[]} onCreate={onCreate} />)
    fireEvent.click(screen.getByRole('button', { name: '未关联归档来源，创建关键词来源' }))
    expect(onCreate).toHaveBeenCalledOnce()
  })
  it('links a single disabled source and masks its name without masking the status', () => {
    render(<ArtistDiscoverySources sources={[{ ...source, status: 'ARCHIVED' }]} onCreate={vi.fn()} />)
    expect(screen.getByRole('link', { name: source.displayName }).getAttribute('href')).toBe(
      '/admin/archive/inbox?tab=uploaders&sourceId=one'
    )
    expect(screen.getByText(source.displayName).hasAttribute('data-privacy-sensitive')).toBe(true)
    expect(screen.getByText('已停用').closest('[data-privacy-sensitive]')).toBeNull()
    expect(screen.getByText('关键词')).toBeTruthy()
  })
  it('lists all bindings in a keyboard-accessible popover, with privacy markers inside the portal', () => {
    render(
      <ArtistDiscoverySources
        sources={[
          source,
          { ...source, id: 'two', sourceKind: 'UPLOADER', displayName: 'Uploader', status: 'ARCHIVED' }
        ]}
        onCreate={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: '已关联 2 个' }))
    expect(screen.getByRole('list', { name: '已关联归档来源' })).toBeTruthy()
    expect(screen.getAllByRole('link')).toHaveLength(2)
    expect(screen.getByText('Uploader').hasAttribute('data-privacy-sensitive')).toBe(true)
    expect(screen.getByText('上传者')).toBeTruthy()
    expect(screen.getByText('已停用')).toBeTruthy()
  })
  it('provides an encoded external title search and an independent create action', () => {
    const onCreate = vi.fn()
    render(<ArtistDiscoveryActions name="Artist & Name" onCreate={onCreate} />)
    fireEvent.keyDown(screen.getByRole('button', { name: '归档来源操作' }), { key: 'ArrowDown' })
    const link = screen.getByRole('menuitem', { name: '在 E-Hentai 搜索' })
    expect(new URL(link.getAttribute('href')!).searchParams.get('f_search')).toBe('title:"artist & name"')
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    expect(link.getAttribute('referrerpolicy')).toBe('no-referrer')
    fireEvent.click(screen.getByRole('menuitem', { name: '创建关键词来源' }))
    expect(onCreate).toHaveBeenCalledOnce()
  })
  it('disables invalid searches and keeps the editable creation path available', () => {
    render(<ArtistDiscoveryActions name={'Artist "Name"'} onCreate={vi.fn()} />)
    fireEvent.keyDown(screen.getByRole('button', { name: '归档来源操作' }), { key: 'ArrowDown' })
    expect(screen.getByRole('menuitem', { name: '在 E-Hentai 搜索' }).getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText(/名称包含不支持的搜索字符/)).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: '创建关键词来源' }).getAttribute('aria-disabled')).not.toBe('true')
  })
})
