'use client'

import React, { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { userSettingsWithDefaultsSchema } from '@/schemas/user-setting.dto'
import type { ArtworkDisplayMode, UserSettings, UserSettingsWithDefaults } from '@/schemas/user-setting.dto'

interface UserSettingState {
  settings: UserSettingsWithDefaults
  hydrateSettings: (nextSettings?: UserSettings) => void
  updateSettingLocally: <K extends keyof UserSettingsWithDefaults>(key: K, value: UserSettingsWithDefaults[K]) => void
  updateSettingsLocally: (nextSettings: Partial<UserSettingsWithDefaults>) => void
}

const defaultSettings = userSettingsWithDefaultsSchema.parse({})

const normalizeSettings = (settings?: UserSettings): UserSettingsWithDefaults => userSettingsWithDefaultsSchema.parse(settings ?? {})

const useUserSettingsStore = create<UserSettingState>((set) => ({
  settings: defaultSettings,
  hydrateSettings: (nextSettings) => {
    set({ settings: normalizeSettings(nextSettings) })
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
  }
}))

export function UserSettingProvider({
  children,
  initialSettings
}: React.PropsWithChildren<{
  initialSettings?: UserSettings
}>) {
  const initializedRef = useRef(false)
  const [initialSnapshot] = useState<UserSettingsWithDefaults>(() => normalizeSettings(initialSettings))
  const serializedInitialSettings = JSON.stringify(initialSettings ?? {})
  const lastHydratedSnapshotRef = useRef<string>(serializedInitialSettings)

  if (!initializedRef.current) {
    useUserSettingsStore.setState({ settings: initialSnapshot })
    initializedRef.current = true
    lastHydratedSnapshotRef.current = JSON.stringify(initialSettings ?? {})
  }

  useEffect(() => {
    if (lastHydratedSnapshotRef.current === serializedInitialSettings) {
      return
    }

    lastHydratedSnapshotRef.current = serializedInitialSettings
    useUserSettingsStore.getState().hydrateSettings(initialSettings)
  }, [initialSettings, serializedInitialSettings])

  return <>{children}</>
}

export function useUserSettings() {
  const settings = useUserSettingsStore((state) => state.settings)
  const updateSettingLocally = useUserSettingsStore((state) => state.updateSettingLocally)
  const updateSettingsLocally = useUserSettingsStore((state) => state.updateSettingsLocally)

  return {
    settings,
    updateSettingLocally,
    updateSettingsLocally
  }
}

export function useUserSettingValue<K extends keyof UserSettingsWithDefaults>(key: K): UserSettingsWithDefaults[K] {
  return useUserSettingsStore((state) => state.settings[key])
}

export function useArtworkDisplayMode(): ArtworkDisplayMode {
  return useUserSettingValue('artwork_display_mode')
}

export function usePreferredTags(): string[] {
  return useUserSettingValue('preferred_tags')
}

export { useUserSettingsStore }
