import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '@/components/auth'
import { UserSettingProvider, useUserSettingsStore } from '../user-setting-provider'

describe('UserSettingProvider media privacy sync', () => {
  beforeEach(() => {
    document.documentElement.dataset.mediaPrivacy = 'off'
    useAuthStore.getState().setUser(null)
    useUserSettingsStore.getState().hydrateSettings({}, null)
  })

  afterEach(() => {
    cleanup()
    delete document.documentElement.dataset.mediaPrivacy
  })

  it('syncs the initial setting and later changes to the document root', () => {
    useAuthStore.getState().setUser({ id: 'user-1', name: 'User', email: null, image: null })
    render(
      <UserSettingProvider initialSettings={{ media_privacy_mode: true }} initialUserId="user-1">
        <div>content</div>
      </UserSettingProvider>
    )

    expect(document.documentElement.dataset.mediaPrivacy).toBe('on')

    act(() => {
      useUserSettingsStore.getState().updateSettingLocally('media_privacy_mode', false)
    })

    expect(document.documentElement.dataset.mediaPrivacy).toBe('off')
  })

  it('resets settings on an account change and rejects the previous account\'s late local update', () => {
    useAuthStore.getState().setUser({ id: 'user-1', name: 'User', email: null, image: null })
    render(
      <UserSettingProvider initialSettings={{ media_privacy_mode: true }} initialUserId="user-1">
        <div>content</div>
      </UserSettingProvider>
    )

    expect(useUserSettingsStore.getState().ownerUserId).toBe('user-1')
    expect(useUserSettingsStore.getState().settings.media_privacy_mode).toBe(true)

    act(() => {
      useAuthStore.getState().setUser({ id: 'user-2', name: 'Other', email: null, image: null })
    })

    expect(useUserSettingsStore.getState().ownerUserId).toBe('user-2')
    expect(useUserSettingsStore.getState().settings.media_privacy_mode).toBe(false)
    expect(document.documentElement.dataset.mediaPrivacy).toBe('off')

    act(() => {
      useUserSettingsStore.getState().updateSettingLocallyForUser('user-1', 'media_privacy_mode', true)
    })

    expect(useUserSettingsStore.getState().ownerUserId).toBe('user-2')
    expect(useUserSettingsStore.getState().settings.media_privacy_mode).toBe(false)
  })

  it('fails closed while refreshed server settings and the live auth user disagree', () => {
    useAuthStore.getState().setUser({ id: 'user-1', name: 'User', email: null, image: null })
    const { rerender } = render(
      <UserSettingProvider initialSettings={{ media_privacy_mode: true }} initialUserId="user-1">
        <div>content</div>
      </UserSettingProvider>
    )

    expect(document.documentElement.dataset.mediaPrivacy).toBe('on')

    rerender(
      <UserSettingProvider initialSettings={{ media_privacy_mode: false }} initialUserId="user-2">
        <div>content</div>
      </UserSettingProvider>
    )

    expect(useUserSettingsStore.getState().ownerUserId).toBe('user-1')
    expect(useUserSettingsStore.getState().settings.media_privacy_mode).toBe(false)
    expect(document.documentElement.dataset.mediaPrivacy).toBe('off')

    act(() => {
      useAuthStore.getState().setUser({ id: 'user-2', name: 'Other', email: null, image: null })
    })

    expect(useUserSettingsStore.getState().ownerUserId).toBe('user-2')
    expect(useUserSettingsStore.getState().settings.media_privacy_mode).toBe(false)
  })
})
