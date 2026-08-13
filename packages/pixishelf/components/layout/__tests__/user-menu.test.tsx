import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UserMenu from '../user-menu'

const { logout } = vi.hoisted(() => ({ logout: vi.fn() }))

vi.mock('@/components/auth', () => ({
  useAuthUser: () => ({ id: '1', name: 'User', email: null, image: null }),
  useAuth: () => ({ logout })
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('UserMenu', () => {
  it('uses grouped menu items and real links for navigation', () => {
    render(<UserMenu />)

    fireEvent.pointerDown(screen.getByRole('menuitem', { name: '打开账户菜单' }), {
      button: 0,
      ctrlKey: false
    })

    const settings = screen.getByRole('menuitem', { name: '个人设置' })
    const changePassword = screen.getByRole('menuitem', { name: '修改密码' })
    expect(settings.tagName).toBe('A')
    expect(settings.getAttribute('href')).toBe('/settings/profile')
    expect(changePassword.tagName).toBe('A')
    expect(changePassword.getAttribute('href')).toBe('/change-password')
    expect(document.querySelectorAll('[data-slot="menubar-group"]')).toHaveLength(2)
  })
})
