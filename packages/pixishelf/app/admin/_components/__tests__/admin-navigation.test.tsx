import React from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePathname } from 'next/navigation'
import { getActiveAdminSection, isAdminNavigationItemActive } from '../../_constant'
import { AdminMobileNavigation } from '../admin-mobile-navigation'
import { AdminNav } from '../admin-nav'

vi.mock('next/navigation', () => ({
  usePathname: vi.fn()
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('getActiveAdminSection', () => {
  it('resolves the admin home and nested module routes', () => {
    expect(getActiveAdminSection('/admin')?.title).toBe('管理概览')
    expect(getActiveAdminSection('/admin/artworks/42')?.title).toBe('作品管理')
    expect(getActiveAdminSection('/admin/tasks')?.title).toBe('任务计划')
  })

  it('matches only an exact admin destination or its child route', () => {
    expect(isAdminNavigationItemActive('/admin/tasks/42', '/admin/tasks')).toBe(true)
    expect(isAdminNavigationItemActive('/admin/tasks-archive', '/admin/tasks')).toBe(false)
    expect(getActiveAdminSection(null)).toBeUndefined()
    expect(isAdminNavigationItemActive(null, '/admin/tasks')).toBe(false)
  })
})

describe('AdminNav', () => {
  it('groups every management destination and marks the active module', () => {
    vi.mocked(usePathname).mockReturnValue('/admin/artworks/42')
    render(<AdminNav />)

    const navigation = screen.getByRole('navigation', { name: '管理模块' })
    expect(within(navigation).getByText('概览')).toBeTruthy()
    expect(within(navigation).getByText('内容档案')).toBeTruthy()
    expect(within(navigation).getByText('系统工具')).toBeTruthy()
    expect(within(navigation).getByRole('link', { name: '管理概览' }).getAttribute('href')).toBe('/admin')
    expect(within(navigation).getByRole('link', { name: '作品管理' }).getAttribute('aria-current')).toBe('page')
    expect(within(navigation).getByRole('link', { name: '作品管理' }).className).toContain('min-h-11')
    expect(within(navigation).getAllByRole('link')).toHaveLength(11)
  })
})

describe('AdminMobileNavigation', () => {
  it('shows the current module and opens the same grouped navigation in a Sheet', () => {
    vi.mocked(usePathname).mockReturnValue('/admin/tasks')
    render(<AdminMobileNavigation />)

    expect(screen.getByText('任务计划')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '切换模块' }))

    const navigation = screen.getByRole('navigation', { name: '管理模块' })
    expect(within(navigation).getByRole('link', { name: '任务计划' }).getAttribute('aria-current')).toBe('page')
    expect(screen.getByRole('heading', { name: '管理模块' })).toBeTruthy()
  })
})
