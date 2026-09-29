import React, { type ReactElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import rootLayout from '../layout'

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  getUserSettings: vi.fn()
}))

vi.mock('next/headers', () => ({
  headers: mocks.headers
}))

vi.mock('@/services/user-setting-service', () => ({
  getUserSettings: mocks.getUserSettings
}))

function getMediaPrivacyAttribute(layout: ReactElement) {
  return (layout.props as { 'data-media-privacy'?: string })['data-media-privacy']
}

function getContentWarningAttribute(layout: ReactElement) {
  return (layout.props as { 'data-content-warning'?: string })['data-content-warning']
}

interface ProtectedContentProps {
  id?: string
  inert?: boolean
  'aria-hidden'?: boolean
}

function getProtectedContent(layout: ReactElement): ReactElement<ProtectedContentProps> | undefined {
  const body = (layout.props as { children: ReactElement<{ children?: React.ReactNode }> }).children
  const bodyChildren = React.Children.toArray(body.props.children)

  return bodyChildren.find(
    (child): child is ReactElement<ProtectedContentProps> =>
      React.isValidElement<ProtectedContentProps>(child) && child.props.id === 'content-warning-protected-content'
  )
}

describe('RootLayout media privacy state', () => {
  beforeEach(() => {
    mocks.headers.mockReset()
    mocks.getUserSettings.mockReset()
  })

  it('renders media privacy off when no authenticated setting exists', async () => {
    mocks.headers.mockResolvedValue(new Headers({ 'x-pathname': '/login' }))

    const layout = await rootLayout({ children: <div /> })

    expect(getMediaPrivacyAttribute(layout)).toBe('off')
    expect(getContentWarningAttribute(layout)).toBe('clear')
    expect(mocks.getUserSettings).not.toHaveBeenCalled()
  })

  it('renders media privacy on in the server response for an enabled account', async () => {
    mocks.headers.mockResolvedValue(
      new Headers({
        'x-pathname': '/dashboard',
        'x-user-session': JSON.stringify({
          userId: 'user-1',
          username: 'tester',
          name: 'Tester',
          email: 'tester@example.com',
          image: null
        })
      })
    )
    mocks.getUserSettings.mockResolvedValue({ media_privacy_mode: true })

    const layout = await rootLayout({ children: <div /> })

    expect(getMediaPrivacyAttribute(layout)).toBe('on')
    expect(getContentWarningAttribute(layout)).toBe('clear')
    expect(mocks.getUserSettings).toHaveBeenCalledWith('user-1')
  })

  it('server-renders the warning blocker for privacy-off browsing pages', async () => {
    mocks.headers.mockResolvedValue(
      new Headers({
        'x-pathname': '/dashboard',
        'x-user-session': JSON.stringify({
          userId: 'user-1',
          username: 'tester',
          name: 'Tester',
          email: 'tester@example.com',
          image: null
        })
      })
    )
    mocks.getUserSettings.mockResolvedValue({ media_privacy_mode: false })

    const layout = await rootLayout({ children: <div /> })

    expect(getContentWarningAttribute(layout)).toBe('pending')
    expect(getProtectedContent(layout)?.props.inert).toBe(true)
    expect(getProtectedContent(layout)?.props['aria-hidden']).toBe(true)
  })

  it('server-renders the warning blocker for privacy-off admin pages', async () => {
    mocks.headers.mockResolvedValue(
      new Headers({
        'x-pathname': '/admin/artworks',
        'x-user-session': JSON.stringify({
          userId: 'user-1',
          username: 'tester',
          name: 'Tester',
          email: 'tester@example.com',
          image: null
        })
      })
    )
    mocks.getUserSettings.mockResolvedValue({ media_privacy_mode: false })

    const layout = await rootLayout({ children: <div /> })

    expect(getContentWarningAttribute(layout)).toBe('pending')
    expect(getProtectedContent(layout)?.props.inert).toBe(true)
    expect(getProtectedContent(layout)?.props['aria-hidden']).toBe(true)
  })

  it('keeps the settings subtree available while privacy mode is disabled', async () => {
    mocks.headers.mockResolvedValue(
      new Headers({
        'x-pathname': '/settings/preferences',
        'x-user-session': JSON.stringify({
          userId: 'user-1',
          username: 'tester',
          name: 'Tester',
          email: 'tester@example.com',
          image: null
        })
      })
    )
    mocks.getUserSettings.mockResolvedValue({ media_privacy_mode: false })

    const layout = await rootLayout({ children: <div /> })

    expect(getContentWarningAttribute(layout)).toBe('clear')
    expect(getProtectedContent(layout)?.props.inert).toBeUndefined()
    expect(getProtectedContent(layout)?.props['aria-hidden']).toBeUndefined()
  })
})
