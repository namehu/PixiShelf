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

vi.mock('../app-header', () => ({
  default: () => <div data-testid="app-header">应用导航</div>
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
    expect(screen.getByText('页面内容')).toBeTruthy()
  })

  it.each(['/login', '/viewer', '/artworks/preview'])('does not render the header on %s', (pathname) => {
    vi.mocked(usePathname).mockReturnValue(pathname)
    vi.mocked(useAuthUser).mockReturnValue({ id: '1', name: 'User', email: null, image: null })

    render(<AppShell>页面内容</AppShell>)

    expect(screen.queryByTestId('app-header')).toBeNull()
  })

  it('does not render authenticated chrome without a user', () => {
    vi.mocked(usePathname).mockReturnValue('/dashboard')
    vi.mocked(useAuthUser).mockReturnValue(null)

    render(<AppShell>页面内容</AppShell>)

    expect(screen.queryByTestId('app-header')).toBeNull()
  })
})
