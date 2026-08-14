import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ChangePasswordPage from '../page'

const actionState = vi.hoisted(() => ({
  onSuccess: undefined as undefined | (() => void)
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ back: vi.fn(), push: vi.fn() })
}))

vi.mock('@/components/auth', () => ({
  useAuth: () => ({ logout: vi.fn() })
}))

vi.mock('@/actions/auth-action', () => ({
  changePasswordAction: vi.fn()
}))

vi.mock('next-safe-action/hooks', () => ({
  useAction: (_action: unknown, options: { onSuccess: () => void }) => {
    actionState.onSuccess = options.onSuccess
    return { execute: vi.fn(), isExecuting: false }
  }
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn() }
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  vi.useRealTimers()
})

describe('ChangePasswordPage semantics', () => {
  it('keeps one main landmark before and after success', () => {
    vi.useFakeTimers()
    const { container } = render(<ChangePasswordPage />)

    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: '修改密码' })).toBeTruthy()

    act(() => actionState.onSuccess?.())

    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(screen.getByRole('heading', { name: '密码修改成功' })).toBeTruthy()
  })

  it('uses password autocomplete and focuses the first local validation error', () => {
    render(<ChangePasswordPage />)

    const currentPassword = screen.getByLabelText('当前密码') as HTMLInputElement
    const newPassword = screen.getByLabelText('新密码') as HTMLInputElement
    const confirmPassword = screen.getByLabelText('确认新密码') as HTMLInputElement

    expect(currentPassword.name).toBe('currentPassword')
    expect(currentPassword.autocomplete).toBe('current-password')
    expect(newPassword.autocomplete).toBe('new-password')
    expect(confirmPassword.autocomplete).toBe('new-password')

    fireEvent.submit(screen.getByRole('button', { name: '修改密码' }).closest('form')!)

    expect(screen.getByText('当前密码不能为空')).toBeTruthy()
    expect(screen.getByText('新密码不能为空')).toBeTruthy()
    expect(document.activeElement).toBe(currentPassword)
  })

  it('reports a confirmation mismatch before executing the action', () => {
    render(<ChangePasswordPage />)
    const currentPassword = screen.getByLabelText('当前密码')
    const newPassword = screen.getByLabelText('新密码')
    const confirmPassword = screen.getByLabelText('确认新密码')

    fireEvent.change(currentPassword, { target: { value: 'old-secret' } })
    fireEvent.change(newPassword, { target: { value: 'new-secret' } })
    fireEvent.change(confirmPassword, { target: { value: 'different-secret' } })

    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('66')

    fireEvent.submit(screen.getByRole('button', { name: '修改密码' }).closest('form')!)

    expect(screen.getByText('两次输入的新密码不一致。')).toBeTruthy()
    expect(document.activeElement).toBe(confirmPassword)
  })
})
