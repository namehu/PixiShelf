import { beforeEach, describe, expect, it } from 'vitest'
import { ADMIN_PREFERENCES_STORAGE_KEY, useAdminPreferencesStore } from '../use-admin-preferences-store'

describe('useAdminPreferencesStore', () => {
  beforeEach(() => {
    useAdminPreferencesStore.setState({
      showArtistImages: true,
      showTagCovers: true,
      showArtworkPixivSync: true,
      archiveUploaderResultView: 'list'
    })
    localStorage.clear()
  })

  it('persists the image visibility preferences', () => {
    useAdminPreferencesStore.getState().setShowArtistImages(false)
    useAdminPreferencesStore.getState().setShowTagCovers(false)
    useAdminPreferencesStore.getState().setArchiveUploaderResultView('preview')

    expect(JSON.parse(localStorage.getItem(ADMIN_PREFERENCES_STORAGE_KEY) ?? '')).toEqual({
      state: {
        showArtistImages: false,
        showTagCovers: false,
        showArtworkPixivSync: true,
        archiveUploaderResultView: 'preview'
      },
      version: 2
    })
  })

  it('rehydrates the image visibility preferences from localStorage', async () => {
    localStorage.setItem(
      ADMIN_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        state: {
          showArtistImages: false,
          showTagCovers: true
        },
        version: 1
      })
    )

    await useAdminPreferencesStore.persist.rehydrate()

    expect(useAdminPreferencesStore.getState()).toMatchObject({
      showArtistImages: false,
      showTagCovers: true,
      showArtworkPixivSync: true,
      archiveUploaderResultView: 'list'
    })
  })

  it('migrates old preferences to the default pure-list uploader view', async () => {
    localStorage.setItem(
      ADMIN_PREFERENCES_STORAGE_KEY,
      JSON.stringify({
        state: { showArtistImages: false, showTagCovers: true, showArtworkPixivSync: false },
        version: 1
      })
    )

    await useAdminPreferencesStore.persist.rehydrate()

    expect(useAdminPreferencesStore.getState()).toMatchObject({
      showArtistImages: false,
      showTagCovers: true,
      showArtworkPixivSync: false,
      archiveUploaderResultView: 'list'
    })
  })
})
