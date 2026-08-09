import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePathname } from 'next/navigation'
import AppHeader from '../app-header'
import { isNavigationItemActive, usesContextualMobileToolbar } from '../app-navigation'

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
  })

  it('does not match sibling routes or dashboard subpaths', () => {
    expect(isNavigationItemActive('/artworks-archive', '/artworks')).toBe(false)
    expect(isNavigationItemActive('/dashboard/other', '/dashboard')).toBe(false)
  })
})

describe('usesContextualMobileToolbar', () => {
  it.each(['/artworks', '/artworks/42', '/artists', '/artists/42', '/tags', '/tags/42', '/series/42'])(
    'uses a single contextual mobile bar for %s',
    (pathname) => {
      expect(usesContextualMobileToolbar(pathname)).toBe(true)
    }
  )

  it.each(['/dashboard', '/series', '/admin', '/settings/profile'])('keeps the compact app bar for %s', (pathname) => {
    expect(usesContextualMobileToolbar(pathname)).toBe(false)
  })
})

describe('AppHeader', () => {
  it('renders the global destinations and marks the current section', () => {
    vi.mocked(usePathname).mockReturnValue('/artworks/42')

    render(<AppHeader />)

    expect(screen.getByRole('link', { name: '返回首页' }).getAttribute('href')).toBe('/dashboard')
    expect(screen.getByRole('link', { name: '作品' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('link', { name: '管理' }).getAttribute('href')).toBe('/admin')
    expect(screen.getByTestId('user-menu')).toBeTruthy()
    expect(screen.getByRole('banner').className).toContain('hidden lg:block')
  })

  it('exposes all primary destinations and management in the mobile menu', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard')
    render(<AppHeader />)

    fireEvent.click(screen.getByRole('button', { name: '打开导航菜单' }))

    const mobileNavigation = screen.getByRole('navigation', { name: '移动端主导航' })
    expect(within(mobileNavigation).getByRole('link', { name: '首页' }).getAttribute('href')).toBe('/dashboard')
    expect(within(mobileNavigation).getByRole('link', { name: '作品' }).getAttribute('href')).toBe('/artworks')
    expect(within(mobileNavigation).getByRole('link', { name: '艺术家' }).getAttribute('href')).toBe('/artists')
    expect(within(mobileNavigation).getByRole('link', { name: '标签' }).getAttribute('href')).toBe('/tags')
    expect(within(mobileNavigation).getByRole('link', { name: '系列' }).getAttribute('href')).toBe('/series')
    expect(within(mobileNavigation).getByRole('link', { name: '管理' }).getAttribute('href')).toBe('/admin')
    expect(screen.getByRole('link', { name: '个人设置' }).getAttribute('href')).toBe('/settings/profile')
  })
})
