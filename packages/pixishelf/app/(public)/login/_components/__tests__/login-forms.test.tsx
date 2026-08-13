import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InitAdminForm } from '../init-admin-form'
import { LoginForm } from '../login-form'

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refreshUser: vi.fn()
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams('redirect=/artworks')
}))

vi.mock('@/components/auth', () => ({
  useAuth: () => ({ refreshUser: mocks.refreshUser })
}))

vi.mock('@/actions/auth-action', () => ({ loginUserAction: vi.fn() }))
vi.mock('@/actions/init-action', () => ({ initAdminAction: vi.fn() }))
vi.mock('next-safe-action/hooks', () => ({
  useAction: () => ({ execute: mocks.execute, isExecuting: false })
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

describe('LoginForm', () => {
  it('connects labels, autocomplete attributes, and local validation errors', () => {
    render(<LoginForm />)

    const username = screen.getByRole('textbox', { name: '用户名' }) as HTMLInputElement
    const password = screen.getByLabelText('密码') as HTMLInputElement

    expect(username.name).toBe('username')
    expect(username.autocomplete).toBe('username')
    expect(username.getAttribute('autocapitalize')).toBe('none')
    expect(password.name).toBe('password')
    expect(password.autocomplete).toBe('current-password')

    fireEvent.submit(screen.getByRole('button', { name: '登录' }).closest('form')!)

    expect(screen.getByText('用户名不能为空')).toBeTruthy()
    expect(screen.getByText('密码不能为空')).toBeTruthy()
    expect(username.getAttribute('aria-describedby')).toBe('login-username-error')
    expect(password.getAttribute('aria-describedby')).toBe('login-password-error')
    expect(document.activeElement).toBe(username)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('submits valid credentials without blocking copy or paste events', () => {
    const { container } = render(<LoginForm />)
    const username = screen.getByRole('textbox', { name: '用户名' })
    const password = screen.getByLabelText('密码')

    fireEvent.change(username, { target: { value: 'pixishelf' } })
    fireEvent.change(password, { target: { value: 'secret123' } })
    fireEvent.submit(screen.getByRole('button', { name: '登录' }).closest('form')!)

    expect(mocks.execute).toHaveBeenCalledWith({ username: 'pixishelf', password: 'secret123' })
    expect(container.querySelector('[onpaste], [oncopy]')).toBeNull()
  })
})

describe('InitAdminForm', () => {
  it('validates the local username constraints before executing', () => {
    render(<InitAdminForm />)

    fireEvent.change(screen.getByRole('textbox', { name: '用户名' }), { target: { value: 'ab' } })
    fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'secret123' } })
    fireEvent.change(screen.getByLabelText('确认密码'), { target: { value: 'secret123' } })
    fireEvent.submit(screen.getByRole('button', { name: '创建管理员' }).closest('form')!)

    expect(screen.getByText('用户名需要 3–20 个字符。')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: '用户名' }))
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('uses new-password autocomplete and submits a trimmed username', () => {
    render(<InitAdminForm />)
    const username = screen.getByRole('textbox', { name: '用户名' }) as HTMLInputElement
    const password = screen.getByLabelText('密码') as HTMLInputElement
    const confirmation = screen.getByLabelText('确认密码') as HTMLInputElement

    expect(password.autocomplete).toBe('new-password')
    expect(confirmation.autocomplete).toBe('new-password')

    fireEvent.change(username, { target: { value: '  admin  ' } })
    fireEvent.change(password, { target: { value: 'secret123' } })
    fireEvent.change(confirmation, { target: { value: 'secret123' } })
    fireEvent.submit(screen.getByRole('button', { name: '创建管理员' }).closest('form')!)

    expect(mocks.execute).toHaveBeenCalledWith({ username: 'admin', password: 'secret123' })
  })
})
