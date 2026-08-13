import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePathname } from 'next/navigation'
import AppHeader from '../app-header'
import MobileBottomNavigation from '../mobile-bottom-navigation'
import PageToolbar from '../page-toolbar'
import { getNavigationContainerSize, isMoreNavigationActive, isNavigationItemActive } from '../app-navigation'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(),
  useRouter: () => ({ push: vi.fn() })
}))

vi.mock('@/components/auth', () => ({
  useAuthUser: () => ({ id: '1', name: 'User', email: null, image: null }),
  useAuth: () => ({ logout: vi.fn() })
}))

vi.mock('../user-menu', () => ({
  default: () => <div data-testid="user-menu">账户菜单</div>
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('isNavigationItemActive', () => {
  it('keeps detail routes active under their parent section', () => {
    expect(isNavigationItemActive('/artworks/42', '/artworks')).toBe(true)
    expect(isNavigationItemActive('/artists/42', '/artists')).toBe(true)
    expect(isNavigationItemActive('/admin/statistics', '/admin')).toBe(true)
    expect(isNavigationItemActive('/viewer', '/viewer')).toBe(true)
  })

  it('does not match sibling routes or dashboard subpaths', () => {
    expect(isNavigationItemActive('/artworks-archive', '/artworks')).toBe(false)
    expect(isNavigationItemActive('/dashboard/other', '/dashboard')).toBe(false)
  })
})

describe('navigation shell helpers', () => {
  it('selects a stable container axis for each shell', () => {
    expect(getNavigationContainerSize('/artworks')).toBe('gallery')
    expect(getNavigationContainerSize('/artworks/42')).toBe('standard')
    expect(getNavigationContainerSize('/admin/tasks')).toBe('workbench')
    expect(getNavigationContainerSize('/dashboard')).toBe('standard')
  })

  it('marks secondary destinations as part of More navigation', () => {
    expect(isMoreNavigationActive('/artists/42')).toBe(true)
    expect(isMoreNavigationActive('/admin/tasks')).toBe(true)
    expect(isMoreNavigationActive('/settings/profile')).toBe(true)
    expect(isMoreNavigationActive('/artworks')).toBe(false)
  })
})

describe('AppHeader', () => {
  it('renders the global destinations and marks the current section', () => {
    vi.mocked(usePathname).mockReturnValue('/artworks/42')

    const { container } = render(<AppHeader />)

    expect(screen.getByRole('link', { name: '返回首页' }).getAttribute('href')).toBe('/dashboard')
    expect(screen.getByRole('link', { name: '作品' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '沉浸浏览' }).getAttribute('href')).toBe('/viewer')
    expect(screen.getByRole('link', { name: '管理' }).getAttribute('href')).toBe('/admin')
    expect(screen.getByTestId('user-menu')).toBeTruthy()
    expect(screen.getByRole('banner').className).toContain('hidden')
    expect(screen.getByRole('banner').className).toContain('lg:block')
    expect(container.querySelector('[data-slot="page-container"]')?.className).toContain('max-w-standard')
  })

  it('uses the gallery axis on the artwork index', () => {
    vi.mocked(usePathname).mockReturnValue('/artworks')
    const { container } = render(<AppHeader />)

    expect(container.querySelector('[data-slot="page-container"]')?.className).toContain('max-w-gallery')
  })
})

describe('MobileBottomNavigation', () => {
  it('keeps three core destinations visible and exposes secondary routes in More', () => {
    vi.mocked(usePathname).mockReturnValue('/tags')
    render(<MobileBottomNavigation />)

    const primaryNavigation = screen.getByRole('navigation', { name: '手机主导航' })
    expect(within(primaryNavigation).getByRole('link', { name: '首页' }).getAttribute('href')).toBe('/dashboard')
    expect(within(primaryNavigation).getByRole('link', { name: '作品' }).getAttribute('href')).toBe('/artworks')
    expect(within(primaryNavigation).getByRole('link', { name: '沉浸浏览' }).getAttribute('href')).toBe('/viewer')

    fireEvent.click(within(primaryNavigation).getByRole('button', { name: /更多/ }))

    const moreNavigation = screen.getByRole('navigation', { name: '更多导航' })
    expect(within(moreNavigation).getByRole('link', { name: '艺术家' }).getAttribute('href')).toBe('/artists')
    expect(within(moreNavigation).getByRole('link', { name: '标签' }).getAttribute('aria-current')).toBe('page')
    expect(within(moreNavigation).getByRole('link', { name: '系列' }).getAttribute('href')).toBe('/series')
    expect(within(moreNavigation).getByRole('link', { name: '管理' }).getAttribute('href')).toBe('/admin')
    expect(screen.getByRole('link', { name: '个人设置' }).getAttribute('href')).toBe('/settings/profile')
    expect(document.querySelectorAll('[data-slot="separator"]')).toHaveLength(2)
    expect(screen.getByRole('button', { name: '关闭更多导航' }).className).toContain('size-11')
  })

  it('marks the active utility destination inside More navigation', () => {
    vi.mocked(usePathname).mockReturnValue('/settings/profile')
    render(<MobileBottomNavigation />)

    fireEvent.click(screen.getByRole('button', { name: /更多/ }))

    expect(screen.getByRole('link', { name: '个人设置' }).getAttribute('aria-current')).toBe('page')
  })
})

describe('PageToolbar', () => {
  it('uses the same named container axes as the application header', () => {
    const { container } = render(<PageToolbar containerSize="gallery">搜索作品</PageToolbar>)

    expect(container.querySelector('[data-slot="page-container"]')?.className).toContain('max-w-gallery')
    expect(screen.getByText('搜索作品')).toBeTruthy()
  })
})
