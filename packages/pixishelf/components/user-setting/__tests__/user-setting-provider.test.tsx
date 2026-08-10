import React from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UserSettingProvider, useUserSettingsStore } from '../user-setting-provider'

describe('UserSettingProvider media privacy sync', () => {
  beforeEach(() => {
    document.documentElement.dataset.mediaPrivacy = 'off'
    useUserSettingsStore.getState().hydrateSettings({})
  })

  afterEach(() => {
    cleanup()
    delete document.documentElement.dataset.mediaPrivacy
  })

  it('syncs the initial setting and later changes to the document root', () => {
    render(
      <UserSettingProvider initialSettings={{ media_privacy_mode: true }}>
        <div>content</div>
      </UserSettingProvider>
    )

    expect(document.documentElement.dataset.mediaPrivacy).toBe('on')

    act(() => {
      useUserSettingsStore.getState().updateSettingLocally('media_privacy_mode', false)
    })

    expect(document.documentElement.dataset.mediaPrivacy).toBe('off')
  })
})
