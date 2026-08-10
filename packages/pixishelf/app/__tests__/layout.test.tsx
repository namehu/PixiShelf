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

describe('RootLayout media privacy state', () => {
  beforeEach(() => {
    mocks.headers.mockReset()
    mocks.getUserSettings.mockReset()
  })

  it('renders media privacy off when no authenticated setting exists', async () => {
    mocks.headers.mockResolvedValue(new Headers())

    const layout = await rootLayout({ children: <div /> })

    expect(getMediaPrivacyAttribute(layout)).toBe('off')
    expect(mocks.getUserSettings).not.toHaveBeenCalled()
  })

  it('renders media privacy on in the server response for an enabled account', async () => {
    mocks.headers.mockResolvedValue(
      new Headers({
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
    expect(mocks.getUserSettings).toHaveBeenCalledWith('user-1')
  })
})
