import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ContentWarningGate } from '../content-warning-gate'

const testState = vi.hoisted(() => ({
  pathname: '/dashboard',
  privacyMode: false,
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
  useAuthUser: () => testState.user
}))

vi.mock('@/components/user-setting', () => ({
  useMediaPrivacyMode: () => testState.privacyMode
}))

describe('ContentWarningGate', () => {
  let protectedContent: HTMLDivElement

  beforeEach(() => {
    testState.pathname = '/dashboard'
    testState.privacyMode = false
    testState.user = { id: 'user-1', name: 'User', email: null, image: null }
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
    expect(document.documentElement.dataset.contentWarning).toBe('pending')
    expect(protectedContent.inert).toBe(true)
    expect(protectedContent.getAttribute('aria-hidden')).toBe('true')

    fireEvent.click(screen.getByRole('button', { name: '我已年满 18 岁，继续访问' }))

    expect(screen.queryByRole('alertdialog')).toBeNull()
    expect(document.documentElement.dataset.contentWarning).toBe('clear')
    expect(protectedContent.inert).toBe(false)
    expect(protectedContent.hasAttribute('aria-hidden')).toBe(false)
  })

  it('does not block admin, login, unauthenticated, or privacy-mode routes', () => {
    const { rerender } = render(<ContentWarningGate />)

    testState.pathname = '/admin/artworks'
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

  it('keeps confirmation across non-admin navigation and resets it after visiting admin', () => {
    const { rerender } = render(<ContentWarningGate />)

    fireEvent.click(screen.getByRole('button', { name: '我已年满 18 岁，继续访问' }))

    testState.pathname = '/artworks/42'
    rerender(<ContentWarningGate />)
    expect(screen.queryByRole('alertdialog')).toBeNull()

    testState.pathname = '/admin'
    rerender(<ContentWarningGate />)

    act(() => {
      testState.pathname = '/viewer'
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
    fireEvent.click(screen.getByRole('button', { name: '我已年满 18 岁，继续访问' }))

    testState.privacyMode = true
    rerender(<ContentWarningGate />)
    testState.privacyMode = false
    rerender(<ContentWarningGate />)

    expect(screen.queryByRole('alertdialog')).toBeNull()
  })

  it('restores confirmed access when a server refresh reapplies pending attributes', () => {
    const { rerender } = render(<ContentWarningGate />)

    fireEvent.click(screen.getByRole('button', { name: '我已年满 18 岁，继续访问' }))
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
})
