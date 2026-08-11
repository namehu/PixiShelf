import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPreferencesPage from '../page'
import { useUserSettingsStore } from '@/components/user-setting'

const testState = vi.hoisted(() => ({
  execute: vi.fn()
}))

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
  SelectItem: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SelectTrigger: ({ children }: React.PropsWithChildren) => <div>{children}</div>,
  SelectValue: () => null
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange, ...props }: any) => (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onCheckedChange(!checked)} {...props} />
  )
}))

describe('SettingsPreferencesPage media privacy setting', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    testState.execute.mockReset()
    useUserSettingsStore.getState().hydrateSettings({ media_privacy_mode: false })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('updates the account setting locally and includes it in the debounced save', () => {
    render(<SettingsPreferencesPage />)

    fireEvent.click(screen.getByRole('switch', { name: '媒体隐私模式' }))

    expect(useUserSettingsStore.getState().settings.media_privacy_mode).toBe(true)
    expect(screen.getByText('已开启')).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(testState.execute).toHaveBeenCalledTimes(1)
    expect(testState.execute.mock.calls[0]?.[0]?.settings).toContainEqual({
      key: 'media_privacy_mode',
      value: true,
      type: 'boolean'
    })
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
})
