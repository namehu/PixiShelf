import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProfileForm } from '../profile-form'

const mocks = vi.hoisted(() => ({ execute: vi.fn(), setUser: vi.fn() }))

vi.mock('@/components/auth', () => ({
  useAuthUser: () => ({ id: '1', name: 'Admin', email: 'admin@example.com', image: null }),
  useAuthStore: (selector: (state: { setUser: typeof mocks.setUser }) => unknown) =>
    selector({ setUser: mocks.setUser })
}))

vi.mock('@/actions/user-setting-action', () => ({ updateProfileAction: vi.fn() }))
vi.mock('next-safe-action/hooks', () => ({
  useAction: () => ({ execute: mocks.execute, isExecuting: false })
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('ProfileForm', () => {
  it('associates labels and focuses the first locally invalid field', () => {
    render(<ProfileForm />)
    const name = screen.getByRole('textbox', { name: '昵称' }) as HTMLInputElement
    const image = screen.getByRole('textbox', { name: '头像地址' }) as HTMLInputElement

    expect(name.name).toBe('name')
    expect(name.autocomplete).toBe('name')
    expect(image.name).toBe('image')
    expect(image.autocomplete).toBe('url')
    expect(screen.getByText('昵称').className).not.toContain('select-none')
    expect(screen.getByText('头像地址').className).not.toContain('select-none')

    fireEvent.change(name, { target: { value: '' } })
    fireEvent.change(image, { target: { value: 'not-a-url' } })
    fireEvent.submit(screen.getByRole('button', { name: '保存资料' }).closest('form')!)

    expect(screen.getByText('昵称不能为空')).toBeTruthy()
    expect(screen.getByText('头像地址格式不正确')).toBeTruthy()
    expect(document.activeElement).toBe(name)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
