'use client'

import React, { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'

type UserSettings = Record<string, unknown>

interface UserSettingState {
  settings: UserSettings
  hydrateSettings: (nextSettings?: UserSettings) => void
  updateSettingLocally: (key: string, value: unknown) => void
  updateSettingsLocally: (nextSettings: UserSettings) => void
}

const useUserSettingsStore = create<UserSettingState>((set) => ({
  settings: {},
  hydrateSettings: (nextSettings) => {
    set({ settings: nextSettings ?? {} })
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
  const [initialSnapshot] = useState<UserSettings>(() => initialSettings ?? {})
  const serializedInitialSettings = JSON.stringify(initialSettings ?? {})
  const lastHydratedSnapshotRef = useRef<string>(serializedInitialSettings)

  if (!initializedRef.current) {
    useUserSettingsStore.setState({ settings: initialSnapshot })
    initializedRef.current = true
    lastHydratedSnapshotRef.current = JSON.stringify(initialSnapshot)
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

export function useUserSettingValue<T = unknown>(key: string) {
  return useUserSettingsStore((state) => state.settings[key] as T)
}

export { useUserSettingsStore }
