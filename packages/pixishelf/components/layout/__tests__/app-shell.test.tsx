import React from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePathname } from 'next/navigation'
import { useAuthUser } from '@/components/auth'
import AppShell, { isHeaderlessPath } from '../app-shell'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn()
}))

vi.mock('@/components/auth', () => ({
  useAuthUser: vi.fn()
}))

vi.mock('@/components/content-warning/content-warning-gate', () => ({
  ContentWarningGate: () => null
}))

vi.mock('../app-header', () => ({
  default: () => <div data-testid="app-header">应用导航</div>
}))

vi.mock('../mobile-bottom-navigation', () => ({
  default: () => <div data-testid="mobile-bottom-navigation">手机导航</div>
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('isHeaderlessPath', () => {
  it.each(['/login', '/viewer', '/artworks/preview'])('hides application chrome for %s', (pathname) => {
    expect(isHeaderlessPath(pathname)).toBe(true)
  })

  it.each(['/dashboard', '/artworks', '/artworks/42', '/settings/profile', '/change-password', '/admin/tasks'])(
    'keeps application chrome for %s',
    (pathname) => {
      expect(isHeaderlessPath(pathname)).toBe(false)
    }
  )
})

describe('AppShell', () => {
  it('shows the header for an authenticated application route', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard')
    vi.mocked(useAuthUser).mockReturnValue({ id: '1', name: 'User', email: null, image: null })

    render(<AppShell>页面内容</AppShell>)

    expect(screen.getByTestId('app-header')).toBeTruthy()
    expect(screen.getByTestId('mobile-bottom-navigation')).toBeTruthy()
    expect(screen.getByRole('link', { name: '跳到主要内容' }).getAttribute('href')).toBe('#main-content')
    expect(screen.getByText('页面内容')).toBeTruthy()
    expect(screen.getByText('页面内容').closest('#main-content')?.className).toContain(
      'var(--app-mobile-navigation-offset)'
    )
  })

  it.each(['/login', '/viewer', '/artworks/preview'])('does not render the header on %s', (pathname) => {
    vi.mocked(usePathname).mockReturnValue(pathname)
    vi.mocked(useAuthUser).mockReturnValue({ id: '1', name: 'User', email: null, image: null })

    render(<AppShell>页面内容</AppShell>)

    expect(screen.queryByTestId('app-header')).toBeNull()
    expect(screen.queryByTestId('mobile-bottom-navigation')).toBeNull()
    expect(screen.queryByRole('link', { name: '跳到主要内容' })).toBeNull()
  })

  it('does not render authenticated chrome without a user', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard')
    vi.mocked(useAuthUser).mockReturnValue(null)

    render(<AppShell>页面内容</AppShell>)

    expect(screen.queryByTestId('app-header')).toBeNull()
    expect(screen.queryByTestId('mobile-bottom-navigation')).toBeNull()
  })
})
