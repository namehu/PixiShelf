import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPreferencesPage from '../page'
import { useUserSettingsStore } from '@/components/user-setting'
import { useAuthStore } from '@/components/auth'

const testState = vi.hoisted(() => ({
  execute: vi.fn()
}))

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})
afterEach(() => vi.unstubAllGlobals())

vi.mock('next-safe-action/hooks', () => ({
  useAction: () => ({
    execute: testState.execute,
    isExecuting: false
  })
}))

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn()
  }
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: { items: [] }
  })
}))

vi.mock('@/lib/trpc', () => ({
  useTRPC: () => ({
    tag: {
      list: {
        queryOptions: () => ({})
      }
    }
  })
}))

vi.mock('@/actions/user-setting-action', () => ({
  updateUserSettingAction: {}
}))

vi.mock('@/components/shared/multiple-selector', () => ({
  default: () => null
}))

vi.mock('@/components/ui/select', () => ({
  Select: ({
    children,
    onValueChange,
    value
  }: React.PropsWithChildren<{ onValueChange?: (value: string) => void; value?: string }>) => (
    <div>
      {children}
      {value && (
        <button
          type="button"
          aria-label={`更改选择 ${value}`}
          onClick={() => onValueChange?.(value === '3' ? '2' : '15')}
        />
      )}
    </div>
  ),
  SelectContent: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SelectGroup: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SelectItem: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SelectTrigger: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SelectValue: () => null
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange, ...props }: any) => (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} {...props} />
  )
}))

describe('SettingsPreferencesPage account preferences', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    testState.execute.mockReset()
    useAuthStore.getState().setUser(null)
    useUserSettingsStore.getState().hydrateSettings({}, null)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('does not offer an account privacy setting', () => {
    render(<SettingsPreferencesPage />)
    expect(screen.queryByRole('switch', { name: '隐私模式' })).toBeNull()
    expect(testState.execute).not.toHaveBeenCalled()
  })

  it('persists the video long-press rate as an account preference', () => {
    render(<SettingsPreferencesPage />)

    fireEvent.click(screen.getByRole('button', { name: '更改选择 3' }))

    expect(useUserSettingsStore.getState().settings.video_long_press_playback_rate).toBe(2)
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(testState.execute).toHaveBeenCalledWith({
      settings: [{ key: 'video_long_press_playback_rate', value: 2, type: 'number' }]
    })
  })

  it('discards a debounced save when the authenticated user changes', () => {
    useAuthStore.getState().setUser({ id: 'user-1', name: 'User', email: null, image: null })
    useUserSettingsStore.getState().hydrateSettings({}, 'user-1')
    render(<SettingsPreferencesPage />)

    fireEvent.click(screen.getByRole('button', { name: '更改选择 3' }))
    act(() => {
      useAuthStore.getState().setUser({ id: 'user-2', name: 'Other', email: null, image: null })
      vi.advanceTimersByTime(500)
    })

    expect(testState.execute).not.toHaveBeenCalled()
  })
})
