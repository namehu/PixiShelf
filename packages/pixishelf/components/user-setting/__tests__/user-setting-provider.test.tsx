import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '@/components/auth'
import { UserSettingProvider, useUserSettingsStore } from '../user-setting-provider'

describe('UserSettingProvider account preference isolation', () => {
  beforeEach(() => {
    document.documentElement.dataset.mediaPrivacy = 'off'
    useAuthStore.getState().setUser(null)
    useUserSettingsStore.getState().hydrateSettings({}, null)
  })

  afterEach(() => {
    cleanup()
    delete document.documentElement.dataset.mediaPrivacy
  })

  it('does not change browser privacy when account preferences change', () => {
    useAuthStore.getState().setUser({ id: 'user-1', name: 'User', email: null, image: null })
    render(
      <UserSettingProvider initialSettings={{ video_seek_step_seconds: 15 }} initialUserId="user-1">
        <div>content</div>
      </UserSettingProvider>
    )

    expect(document.documentElement.dataset.mediaPrivacy).toBe('off')

    act(() => {
      useUserSettingsStore.getState().updateSettingLocally('video_seek_step_seconds', 5)
    })

    expect(document.documentElement.dataset.mediaPrivacy).toBe('off')
  })

  it("resets settings on an account change and rejects the previous account's late local update", () => {
    useAuthStore.getState().setUser({ id: 'user-1', name: 'User', email: null, image: null })
    render(
      <UserSettingProvider initialSettings={{ video_seek_step_seconds: 15 }} initialUserId="user-1">
        <div>content</div>
      </UserSettingProvider>
    )

    expect(useUserSettingsStore.getState().ownerUserId).toBe('user-1')
    expect(useUserSettingsStore.getState().settings.video_seek_step_seconds).toBe(15)

    act(() => {
      useAuthStore.getState().setUser({ id: 'user-2', name: 'Other', email: null, image: null })
    })

    expect(useUserSettingsStore.getState().ownerUserId).toBe('user-2')
    expect(useUserSettingsStore.getState().settings.video_seek_step_seconds).toBe(10)
    expect(document.documentElement.dataset.mediaPrivacy).toBe('off')

    act(() => {
      useUserSettingsStore.getState().updateSettingLocallyForUser('user-1', 'video_seek_step_seconds', 15)
    })

    expect(useUserSettingsStore.getState().ownerUserId).toBe('user-2')
    expect(useUserSettingsStore.getState().settings.video_seek_step_seconds).toBe(10)
  })

  it('fails closed while refreshed server settings and the live auth user disagree', () => {
    useAuthStore.getState().setUser({ id: 'user-1', name: 'User', email: null, image: null })
    const { rerender } = render(
      <UserSettingProvider initialSettings={{ video_seek_step_seconds: 15 }} initialUserId="user-1">
        <div>content</div>
      </UserSettingProvider>
    )

    expect(document.documentElement.dataset.mediaPrivacy).toBe('off')

    rerender(
      <UserSettingProvider initialSettings={{ video_seek_step_seconds: 5 }} initialUserId="user-2">
        <div>content</div>
      </UserSettingProvider>
    )

    expect(useUserSettingsStore.getState().ownerUserId).toBe('user-1')
    expect(useUserSettingsStore.getState().settings.video_seek_step_seconds).toBe(10)
    expect(document.documentElement.dataset.mediaPrivacy).toBe('off')

    act(() => {
      useAuthStore.getState().setUser({ id: 'user-2', name: 'Other', email: null, image: null })
    })

    expect(useUserSettingsStore.getState().ownerUserId).toBe('user-2')
    expect(useUserSettingsStore.getState().settings.video_seek_step_seconds).toBe(5)
  })
})
