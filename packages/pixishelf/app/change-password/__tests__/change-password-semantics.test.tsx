import React from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
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
})
