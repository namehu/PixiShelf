'use client'

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { useAuthUser } from '@/components/auth'
import { userSettingsWithDefaultsSchema } from '@/schemas/user-setting.dto'
import type {
  ArtworkDisplayMode,
  ArtworkMediaAnchorInterval,
  VideoLongPressPlaybackRate,
  VideoSeekStepSeconds,
  UserSettings,
  UserSettingsWithDefaults
} from '@/schemas/user-setting.dto'

interface UserSettingState {
  ownerUserId: string | null
  settings: UserSettingsWithDefaults
  hydrateSettings: (nextSettings?: UserSettings, ownerUserId?: string | null) => void
  resetSettingsForUser: (ownerUserId: string | null) => void
  updateSettingLocally: <K extends keyof UserSettingsWithDefaults>(key: K, value: UserSettingsWithDefaults[K]) => void
  updateSettingsLocally: (nextSettings: Partial<UserSettingsWithDefaults>) => void
  updateSettingLocallyForUser: <K extends keyof UserSettingsWithDefaults>(
    ownerUserId: string | null,
    key: K,
    value: UserSettingsWithDefaults[K]
  ) => void
  updateSettingsLocallyForUser: (
    ownerUserId: string | null,
    nextSettings: Partial<UserSettingsWithDefaults>
  ) => void
}

const defaultSettings = userSettingsWithDefaultsSchema.parse({})

const normalizeSettings = (settings?: UserSettings): UserSettingsWithDefaults =>
  userSettingsWithDefaultsSchema.parse(settings ?? {})

function MediaPrivacyRootSync() {
  const currentUserId = useAuthUser()?.id ?? null
  const enabled = useUserSettingsStore(
    (state) =>
      currentUserId !== null && state.ownerUserId === currentUserId && state.settings.media_privacy_mode
  )

  useLayoutEffect(() => {
    document.documentElement.dataset.mediaPrivacy = enabled ? 'on' : 'off'
  }, [enabled])

  return null
}

const useUserSettingsStore = create<UserSettingState>((set) => ({
  ownerUserId: null,
  settings: defaultSettings,
  hydrateSettings: (nextSettings, ownerUserId) => {
    set((state) => ({
      ownerUserId: ownerUserId === undefined ? state.ownerUserId : ownerUserId,
      settings: normalizeSettings(nextSettings)
    }))
  },
  resetSettingsForUser: (ownerUserId) => {
    set({ ownerUserId, settings: defaultSettings })
  },
  updateSettingLocally: (key, value) => {
    set((state) => ({
      settings: {
        ...state.settings,
        [key]: value
      }
    }))
  },
  updateSettingsLocally: (nextSettings) => {
    set((state) => ({
      settings: {
        ...state.settings,
        ...nextSettings
      }
    }))
  },
  updateSettingLocallyForUser: (ownerUserId, key, value) => {
    set((state) => {
      if (state.ownerUserId !== ownerUserId) return state

      return {
        settings: {
          ...state.settings,
          [key]: value
        }
      }
    })
  },
  updateSettingsLocallyForUser: (ownerUserId, nextSettings) => {
    set((state) => {
      if (state.ownerUserId !== ownerUserId) return state

      return {
        settings: {
          ...state.settings,
          ...nextSettings
        }
      }
    })
  }
}))

export function UserSettingProvider({
  children,
  initialSettings,
  initialUserId
}: React.PropsWithChildren<{
  initialSettings?: UserSettings
  initialUserId?: string | null
}>) {
  const currentUserId = useAuthUser()?.id ?? null
  const serverOwnerUserId = initialUserId === undefined ? currentUserId : initialUserId
  const initializedRef = useRef(false)
  const [initialSnapshot] = useState(() => ({
    ownerUserId: currentUserId,
    settings: serverOwnerUserId === currentUserId ? normalizeSettings(initialSettings) : defaultSettings
  }))
  const serializedInitialSettings = JSON.stringify({
    ownerUserId: serverOwnerUserId,
    settings: initialSettings ?? {}
  })
  const lastHydratedSnapshotRef = useRef<string | null>(
    serverOwnerUserId === currentUserId ? serializedInitialSettings : null
  )

  if (!initializedRef.current) {
    useUserSettingsStore.setState(initialSnapshot)
    initializedRef.current = true
  }

  useLayoutEffect(() => {
    const store = useUserSettingsStore.getState()
    if (serverOwnerUserId !== currentUserId) {
      lastHydratedSnapshotRef.current = null
      if (store.ownerUserId !== currentUserId || store.settings !== defaultSettings) {
        store.resetSettingsForUser(currentUserId)
      }
      return
    }

    if (store.ownerUserId === currentUserId) return

    lastHydratedSnapshotRef.current = null
    store.resetSettingsForUser(currentUserId)
  }, [currentUserId, serverOwnerUserId])

  useEffect(() => {
    if (
      serverOwnerUserId !== currentUserId ||
      lastHydratedSnapshotRef.current === serializedInitialSettings
    ) {
      return
    }

    lastHydratedSnapshotRef.current = serializedInitialSettings
    useUserSettingsStore.getState().hydrateSettings(initialSettings, serverOwnerUserId)
  }, [currentUserId, initialSettings, serializedInitialSettings, serverOwnerUserId])

  return (
    <>
      <MediaPrivacyRootSync />
      {children}
    </>
  )
}

export function useUserSettings() {
  const currentUserId = useAuthUser()?.id ?? null
  const settings = useUserSettingsStore((state) =>
    state.ownerUserId === currentUserId ? state.settings : defaultSettings
  )
  const updateSettingLocally = useCallback(
    <K extends keyof UserSettingsWithDefaults>(key: K, value: UserSettingsWithDefaults[K]) => {
      useUserSettingsStore.getState().updateSettingLocallyForUser(currentUserId, key, value)
    },
    [currentUserId]
  )
  const updateSettingsLocally = useCallback(
    (nextSettings: Partial<UserSettingsWithDefaults>) => {
      useUserSettingsStore.getState().updateSettingsLocallyForUser(currentUserId, nextSettings)
    },
    [currentUserId]
  )

  return {
    settings,
    updateSettingLocally,
    updateSettingsLocally
  }
}

export function useUserSettingValue<K extends keyof UserSettingsWithDefaults>(key: K): UserSettingsWithDefaults[K] {
  const currentUserId = useAuthUser()?.id ?? null
  return useUserSettingsStore((state) =>
    state.ownerUserId === currentUserId ? state.settings[key] : defaultSettings[key]
  )
}

export function useArtworkDisplayMode(): ArtworkDisplayMode {
  return useUserSettingValue('artwork_display_mode')
}

export function usePreferredTags(): string[] {
  return useUserSettingValue('preferred_tags')
}

export function useArtworkMediaAnchorInterval(): ArtworkMediaAnchorInterval {
  return useUserSettingValue('artwork_media_anchor_interval')
}

export function useMediaPrivacyMode(): boolean {
  return useUserSettingValue('media_privacy_mode')
}

export function useVideoLongPressPlaybackRate(): VideoLongPressPlaybackRate {
  return useUserSettingValue('video_long_press_playback_rate')
}

export function useVideoSeekStepSeconds(): VideoSeekStepSeconds {
  return useUserSettingValue('video_seek_step_seconds')
}

export { useUserSettingsStore }
