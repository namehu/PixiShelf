import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ArchiveEhCookieSetting } from '../archive-eh-cookie-setting'

const state = vi.hoisted(() => ({
  status: { configured: true, encryptionAvailable: true, readable: true, updatedAt: null },
  save: vi.fn(),
  clear: vi.fn(),
  setQueryData: vi.fn()
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    setting: {
      getArchiveEhCookieStatus: { queryOptions: () => ({}), queryKey: () => ['eh-cookie-status'] },
      saveArchiveEhCookie: { mutationOptions: (options: object) => ({ ...options, kind: 'save' }) },
      clearArchiveEhCookie: { mutationOptions: (options: object) => ({ ...options, kind: 'clear' }) }
    }
  })
}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ setQueryData: state.setQueryData }),
  useQuery: () => ({ data: state.status, isLoading: false }),
  useMutation: (options: { kind: string; onSuccess: (result: typeof state.status) => void }) => ({
    isPending: false,
    mutate: (input: unknown) => {
      if (options.kind === 'save') state.save(input)
      else state.clear(input)
      options.onSuccess(state.status)
    }
  })
}))

describe('shared EH Cookie settings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.status = { configured: true, encryptionAvailable: true, readable: true, updatedAt: null }
  })
  afterEach(cleanup)

  it('shows only status, masks new input and clears it after saving', () => {
    render(<ArchiveEhCookieSetting />)
    const input = screen.getByLabelText('更新 Cookie') as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.type).toBe('password')
    expect(screen.getByText(/已配置/)).toBeTruthy()
    fireEvent.change(input, { target: { value: 'fixture=secret' } })
    fireEvent.click(screen.getByText('保存 Cookie'))
    expect(state.save).toHaveBeenCalledWith({ cookie: 'fixture=secret' })
    expect(input.value).toBe('')
    expect(state.setQueryData).toHaveBeenCalledWith(['eh-cookie-status'], state.status)
  })

  it('allows clearing configured credentials and disables saving without a deployment key', () => {
    state.status.encryptionAvailable = false
    render(<ArchiveEhCookieSetting />)
    expect((screen.getByLabelText('更新 Cookie') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByText('保存 Cookie') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('清除 Cookie'))
    expect(state.clear).toHaveBeenCalledOnce()
  })
})
