import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentWarningGate } from '../content-warning-gate'

const testState = vi.hoisted(() => ({
  pathname: '/dashboard',
  privacyMode: false,
  settingsOwnerUserId: 'user-1' as string | null,
  actionBehavior: 'success' as 'success' | 'error' | 'pending',
  isExecuting: false,
  execute: vi.fn(),
  updateSettingLocallyForUser: vi.fn(),
  pendingActionCallbacks: null as null | {
    onError: (result: { error: { validationErrors?: { formErrors?: string[] }; serverError?: string } }) => void
    onSuccess: () => void
  },
  user: { id: 'user-1', name: 'User', email: null, image: null } as {
    id: string
    name: string | null
    email: string | null
    image: string | null
  } | null
}))

vi.mock('next/navigation', () => ({
  usePathname: () => testState.pathname
}))

vi.mock('@/components/auth', () => ({
  useAuthUser: () => testState.user,
  useAuthStore: {
    getState: () => ({ user: testState.user })
  }
}))

vi.mock('@/components/user-setting', () => ({
  useMediaPrivacyMode: () => testState.privacyMode,
  useUserSettingsStore: (
    selector: (state: {
      ownerUserId: string | null
      updateSettingLocallyForUser: typeof testState.updateSettingLocallyForUser
    }) => unknown
  ) =>
    selector({
      ownerUserId: testState.settingsOwnerUserId,
      updateSettingLocallyForUser: testState.updateSettingLocallyForUser
    })
}))

vi.mock('@/actions/user-setting-action', () => ({
  updateUserSettingAction: {}
}))

vi.mock('next-safe-action/hooks', () => ({
  useAction: (
    _action: unknown,
    callbacks: {
      onError: (result: { error: { validationErrors?: { formErrors?: string[] }; serverError?: string } }) => void
      onSuccess: () => void
    }
  ) => ({
    execute: (input: unknown) => {
      testState.execute(input)
      if (testState.actionBehavior === 'pending') {
        testState.pendingActionCallbacks = callbacks
        return
      }
      if (testState.actionBehavior === 'error') {
        callbacks.onError({ error: { serverError: '保存失败' } })
        return
      }

      testState.privacyMode = true
      callbacks.onSuccess()
    },
    isExecuting: testState.isExecuting
  })
}))

describe('ContentWarningGate', () => {
  let protectedContent: HTMLDivElement

  beforeEach(() => {
    testState.pathname = '/dashboard'
    testState.privacyMode = false
    testState.settingsOwnerUserId = 'user-1'
    testState.actionBehavior = 'success'
    testState.isExecuting = false
    testState.pendingActionCallbacks = null
    testState.user = { id: 'user-1', name: 'User', email: null, image: null }
    testState.execute.mockReset()
    testState.updateSettingLocallyForUser.mockReset()
    document.documentElement.dataset.contentWarning = 'pending'
    protectedContent = document.createElement('div')
    protectedContent.id = 'content-warning-protected-content'
    protectedContent.inert = true
    protectedContent.setAttribute('aria-hidden', 'true')
    document.body.appendChild(protectedContent)
  })

  afterEach(() => {
    cleanup()
    protectedContent.remove()
    delete document.documentElement.dataset.contentWarning
  })

  it('blocks an authenticated non-admin route until the user confirms', () => {
    render(<ContentWarningGate />)

    expect(screen.getByRole('alertdialog', { name: '浏览前的小提示' })).toBeTruthy()
    expect(screen.queryByRole('main')).toBeNull()
    expect(document.documentElement.dataset.contentWarning).toBe('pending')
    expect(protectedContent.inert).toBe(true)
    expect(protectedContent.getAttribute('aria-hidden')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: '我已年满 18 岁，以原始状态进入' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.documentElement.dataset.contentWarning).toBe('clear')
    expect(protectedContent.inert).toBe(false)
    expect(protectedContent.hasAttribute('aria-hidden')).toBe(false)
  })

  it('blocks admin but exempts settings, login, unauthenticated, and privacy-mode routes', () => {
    const { rerender } = render(<ContentWarningGate />)

    testState.pathname = '/admin/artworks'
    rerender(<ContentWarningGate />)
    expect(screen.getByRole('alertdialog')).toBeTruthy()

    testState.pathname = '/settings/preferences'
    rerender(<ContentWarningGate />)
    expect(screen.queryByRole('alertdialog')).toBeNull()

    testState.pathname = '/login'
    rerender(<ContentWarningGate />)
    expect(screen.queryByRole('alertdialog')).toBeNull()

    testState.pathname = '/dashboard'
    testState.user = null
    rerender(<ContentWarningGate />)
    expect(screen.queryByRole('alertdialog')).toBeNull()

    testState.user = { id: 'user-1', name: 'User', email: null, image: null }
    testState.privacyMode = true
    rerender(<ContentWarningGate />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.documentElement.dataset.contentWarning).toBe('clear')
  })

  it('keeps confirmation across settings navigation and resets it when the user changes', () => {
    const { rerender } = render(<ContentWarningGate />)

    fireEvent.click(screen.getByRole('button', { name: '我已年满 18 岁，以原始状态进入' }))

    testState.pathname = '/settings/preferences'
    rerender(<ContentWarningGate />)
    expect(screen.queryByRole('alertdialog')).toBeNull()

    testState.pathname = '/viewer'
    rerender(<ContentWarningGate />)
    expect(screen.queryByRole('alertdialog')).toBeNull()

    act(() => {
      testState.user = { id: 'user-2', name: 'Other', email: null, image: null }
      rerender(<ContentWarningGate />)
    })

    expect(screen.getByRole('alertdialog', { name: '浏览前的小提示' })).toBeTruthy()
  })

  it('opens when privacy mode is disabled unless this visit was already confirmed', () => {
    testState.privacyMode = true
    const { rerender } = render(<ContentWarningGate />)

    expect(screen.queryByRole('alertdialog')).toBeNull()

    testState.privacyMode = false
    rerender(<ContentWarningGate />)
    fireEvent.click(screen.getByRole('button', { name: '我已年满 18 岁，以原始状态进入' }))

    testState.privacyMode = true
    rerender(<ContentWarningGate />)
    testState.privacyMode = false
    rerender(<ContentWarningGate />)

    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('restores confirmed access when a server refresh reapplies pending attributes', () => {
    const { rerender } = render(<ContentWarningGate />)

    fireEvent.click(screen.getByRole('button', { name: '我已年满 18 岁，以原始状态进入' }))
    document.documentElement.dataset.contentWarning = 'pending'
    protectedContent.inert = true
    protectedContent.setAttribute('aria-hidden', 'true')

    rerender(<ContentWarningGate />)

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.documentElement.dataset.contentWarning).toBe('clear')
    expect(protectedContent.inert).toBe(false)
    expect(protectedContent.hasAttribute('aria-hidden')).toBe(false)
  })

  it('cannot be dismissed with Escape or an outside pointer event', () => {
    render(<ContentWarningGate />)

    const dialog = screen.getByRole('alertdialog', { name: '浏览前的小提示' })
    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.pointerDown(document.body)

    expect(screen.getByRole('alertdialog', { name: '浏览前的小提示' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /关闭/i })).toBeNull()
  })

  it('enables privacy mode with the exact persisted setting before releasing the blocker', async () => {
    const { rerender } = render(<ContentWarningGate />)

    const privacyButton = screen.getByRole('button', { name: '开启隐私模式并进入' })
    await waitFor(() => expect(document.activeElement).toBe(privacyButton))
    fireEvent.click(privacyButton)

    expect(testState.execute).toHaveBeenCalledWith({
      settings: [{ key: 'media_privacy_mode', value: true, type: 'boolean' }]
    })
    expect(testState.updateSettingLocallyForUser).toHaveBeenCalledWith(
      'user-1',
      'media_privacy_mode',
      true
    )

    rerender(<ContentWarningGate />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(protectedContent.inert).toBe(false)
  })

  it('keeps the blocker and local privacy state unchanged when enabling privacy mode fails', () => {
    testState.actionBehavior = 'error'
    render(<ContentWarningGate />)

    fireEvent.click(screen.getByRole('button', { name: '开启隐私模式并进入' }))

    expect(screen.getByText('保存失败')).toBeTruthy()
    expect(testState.updateSettingLocallyForUser).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(protectedContent.inert).toBe(true)
  })

  it('disables both choices and shows progress while the privacy setting is saving', () => {
    testState.isExecuting = true
    render(<ContentWarningGate />)

    expect(screen.getByRole('button', { name: '开启隐私模式并进入' })).toHaveProperty('disabled', true)
    expect(screen.getByRole('button', { name: '我已年满 18 岁，以原始状态进入' })).toHaveProperty(
      'disabled',
      true
    )
    expect(screen.getByRole('status', { name: '正在开启隐私模式' })).toBeTruthy()
  })

  it('does not apply a previous user\'s late privacy-setting success to the current user', () => {
    testState.actionBehavior = 'pending'
    const { rerender } = render(<ContentWarningGate />)

    fireEvent.click(screen.getByRole('button', { name: '开启隐私模式并进入' }))

    act(() => {
      testState.user = { id: 'user-2', name: 'Other', email: null, image: null }
      testState.settingsOwnerUserId = 'user-2'
      rerender(<ContentWarningGate />)
    })
    act(() => {
      testState.pendingActionCallbacks?.onSuccess()
    })

    expect(testState.updateSettingLocallyForUser).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog', { name: '浏览前的小提示' })).toBeTruthy()
  })
})
