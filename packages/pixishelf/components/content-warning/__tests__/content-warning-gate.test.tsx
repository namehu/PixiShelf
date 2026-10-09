import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { privacyStore } from '@/store/privacy-store'
import { privacySession } from '@/lib/privacy-session'
import { ContentWarningGate } from '../content-warning-gate'

const state = vi.hoisted(() => ({ pathname: '/dashboard', user: { id: 'user-1' } as { id: string } | null }))
vi.mock('next/navigation', () => ({
  usePathname: () => state.pathname,
  useSearchParams: () => new URLSearchParams(window.location.search)
}))
vi.mock('@/components/auth', () => ({ useAuthUser: () => state.user }))
vi.mock('sonner', () => ({ toast: { warning: vi.fn() } }))

let protectedContent: HTMLDivElement
beforeEach(() => {
  vi.spyOn(privacySession, 'start').mockImplementation(() => () => {})
  localStorage.clear()
  sessionStorage.clear()
  privacyStore.setState({ status: 'initializing', visit: null, remembered: null, storageError: false })
  state.pathname = '/dashboard'
  state.user = { id: 'user-1' }
  window.history.replaceState(null, '', '/dashboard')
  protectedContent = document.createElement('div')
  protectedContent.id = 'content-warning-protected-content'
  document.body.appendChild(protectedContent)
})
afterEach(() => {
  cleanup()
  protectedContent.remove()
  vi.restoreAllMocks()
})

function pending() {
  privacyStore.setState({ status: 'pending' })
}

describe('browser content warning', () => {
  it.each(['direct', 'privacy'] as const)('forces %s from the URL and consumes only the entry parameter', (mode) => {
    pending()
    window.history.replaceState({ marker: 'preserved' }, '', `/dashboard?entry=${mode}&page=2#items`)
    const view = render(<ContentWarningGate />)
    expect(privacyStore.getState().status).toBe(mode)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.documentElement.dataset.mediaPrivacy).toBe(mode === 'direct' ? 'off' : 'on')
    expect(protectedContent.inert).toBe(false)
    expect(window.location.search).toBe('?page=2')
    expect(window.location.hash).toBe('#items')
    expect(window.history.state).toEqual({ marker: 'preserved' })
    act(() => privacySession.toggle())
    view.rerender(<ContentWarningGate />)
    expect(privacyStore.getState().status).not.toBe(mode)
  })

  it('handles query-only navigation and overrides an existing mode', () => {
    privacySession.choose('privacy')
    const view = render(<ContentWarningGate />)
    window.history.replaceState(null, '', '/dashboard?entry=direct')
    view.rerender(<ContentWarningGate />)
    expect(privacyStore.getState().status).toBe('direct')
  })

  it.each(['entry=invalid', 'entry=', 'entry=direct&entry=privacy'])('ignores invalid or ambiguous %s', (query) => {
    pending()
    window.history.replaceState(null, '', `/dashboard?${query}`)
    render(<ContentWarningGate />)
    expect(screen.getByRole('alertdialog')).toBeTruthy()
    expect(privacyStore.getState().status).toBe('pending')
  })

  it('waits for authentication before consuming an entry choice', () => {
    state.user = null
    state.pathname = '/login'
    window.history.replaceState(null, '', '/login?entry=direct')
    const view = render(<ContentWarningGate />)
    expect(privacyStore.getState().status).toBe('initializing')
    expect(window.location.search).toBe('?entry=direct')
    state.user = { id: 'user-1' }
    view.rerender(<ContentWarningGate />)
    expect(privacyStore.getState().status).toBe('direct')
    expect(window.location.search).toBe('')
  })

  it('keeps initialization covered and inert without prematurely displaying the choice', () => {
    render(<ContentWarningGate />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.documentElement.dataset.contentWarning).toBe('pending')
    expect(document.documentElement.dataset.mediaPrivacy).toBe('on')
    expect(protectedContent.inert).toBe(true)
    expect(protectedContent.getAttribute('aria-hidden')).toBe('true')
  })

  it.each(['privacy', 'direct'] as const)(
    'applies %s before releasing the blocker, without remembering by default',
    (mode) => {
      pending()
      render(<ContentWarningGate />)
      expect(screen.getByRole('checkbox').getAttribute('aria-checked')).toBe('false')
      fireEvent.click(screen.getByRole('button', { name: mode === 'privacy' ? '隐私模式进入' : '原始模式进入' }))
      expect(privacyStore.getState().status).toBe(mode)
      expect(privacyStore.getState().remembered).toBeNull()
      expect(document.documentElement.dataset.mediaPrivacy).toBe(mode === 'privacy' ? 'on' : 'off')
      expect(document.documentElement.dataset.contentWarning).toBe('clear')
      expect(protectedContent.inert).toBe(false)
      expect(protectedContent.hasAttribute('aria-hidden')).toBe(false)
    }
  )

  it('remembers the selected mode when explicitly checked', () => {
    pending()
    render(<ContentWarningGate />)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: '原始模式进入' }))
    expect(privacyStore.getState().remembered?.mode).toBe('direct')
  })

  it('does not reprompt after privacy is disabled, navigation, logout or account changes', () => {
    pending()
    const view = render(<ContentWarningGate />)
    fireEvent.click(screen.getByRole('button', { name: '隐私模式进入' }))
    act(() => privacySession.toggle())
    for (const [pathname, user] of [
      ['/admin/artworks', { id: 'user-1' }],
      ['/artworks/42', { id: 'user-1' }],
      ['/login', null],
      ['/viewer', { id: 'user-2' }]
    ] as const) {
      state.pathname = pathname
      state.user = user
      view.rerender(<ContentWarningGate />)
      expect(document.documentElement.dataset.contentWarning).toBe('clear')
      expect(privacyStore.getState().status).toBe('direct')
    }
  })

  it.each(['/settings/preferences', '/settings/profile', '/login', '/api/test'])('does not gate %s', (pathname) => {
    pending()
    state.pathname = pathname
    render(<ContentWarningGate />)
    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(protectedContent.inert).toBe(false)
  })

  it('blocks admin and ignores Escape and outside pointer events', () => {
    pending()
    state.pathname = '/admin/artworks'
    render(<ContentWarningGate />)
    const dialog = screen.getByRole('alertdialog')
    fireEvent.keyDown(dialog, { key: 'Escape' })
    fireEvent.pointerDown(document.body)
    expect(privacyStore.getState().status).toBe('pending')
    expect(document.documentElement.dataset.contentWarning).toBe('pending')
  })

  it('reapplies browser mode after a server layout update resets root attributes', () => {
    privacySession.choose('direct')
    const view = render(<ContentWarningGate />)
    document.documentElement.dataset.contentWarning = 'pending'
    document.documentElement.dataset.mediaPrivacy = 'on'
    view.rerender(<ContentWarningGate />)
    expect(document.documentElement.dataset.contentWarning).toBe('clear')
    expect(document.documentElement.dataset.mediaPrivacy).toBe('off')
  })

  it('warns about unavailable storage and still accepts the choice', () => {
    pending()
    privacyStore.setState({ storageError: true })
    render(<ContentWarningGate />)
    expect(screen.getByRole('alert').textContent).toContain('无法记住选择')
    fireEvent.click(screen.getByRole('button', { name: '原始模式进入' }))
    expect(privacyStore.getState().status).toBe('direct')
  })
})
