import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ADMIN_PREFERENCES_STORAGE_KEY,
  useAdminPreferencesStore
} from '@/store/admin/use-admin-preferences-store'
import { AdminImageVisibilitySwitch } from '../admin-image-visibility-switch'

describe('AdminImageVisibilitySwitch', () => {
  beforeEach(() => {
    useAdminPreferencesStore.setState({
      showArtistImages: true,
      showTagCovers: true,
      showArtworkPixivSync: true
    })
    localStorage.clear()
  })

  afterEach(cleanup)

  it('rehydrates and updates the artist and tag preferences independently', async () => {
    localStorage.setItem(
      ADMIN_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        state: {
          showArtistImages: false,
          showTagCovers: false
        },
        version: 1
      })
    )

    render(
      <>
        <AdminImageVisibilitySwitch id="artist-images" label="显示图片" preference="artist-images" />
        <AdminImageVisibilitySwitch id="tag-covers" label="显示封面" preference="tag-covers" />
      </>
    )

    const artistSwitch = screen.getByRole('switch', { name: '显示图片' })
    const tagSwitch = screen.getByRole('switch', { name: '显示封面' })

    await waitFor(() => {
      expect(artistSwitch.getAttribute('data-state')).toBe('unchecked')
      expect(tagSwitch.getAttribute('data-state')).toBe('unchecked')
    })

    fireEvent.click(artistSwitch)

    expect(artistSwitch.getAttribute('data-state')).toBe('checked')
    expect(tagSwitch.getAttribute('data-state')).toBe('unchecked')
    expect(JSON.parse(localStorage.getItem(ADMIN_PREFERENCES_STORAGE_KEY) ?? '').state).toEqual({
      showArtistImages: true,
      showTagCovers: false,
      showArtworkPixivSync: true
    })
  })
})
