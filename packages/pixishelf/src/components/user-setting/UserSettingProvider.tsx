'use client'

import React, { createContext, useContext, useMemo, useState } from 'react'

interface UserSettingContextType {
  settings: Record<string, unknown>
  updateSettingLocally: (key: string, value: unknown) => void
  updateSettingsLocally: (nextSettings: Record<string, unknown>) => void
}

const UserSettingContext = createContext<UserSettingContextType | undefined>(undefined)

export function UserSettingProvider({
  children,
  initialSettings
}: React.PropsWithChildren<{
  initialSettings?: Record<string, unknown>
}>) {
  const [settings, setSettings] = useState<Record<string, unknown>>(initialSettings ?? {})

  const contextValue = useMemo<UserSettingContextType>(
    () => ({
      settings,
      updateSettingLocally: (key, value) => {
        setSettings((prev) => ({ ...prev, [key]: value }))
      },
      updateSettingsLocally: (nextSettings) => {
        setSettings((prev) => ({ ...prev, ...nextSettings }))
      }
    }),
    [settings]
  )

  return <UserSettingContext.Provider value={contextValue}>{children}</UserSettingContext.Provider>
}

export function useUserSettings() {
  const context = useContext(UserSettingContext)
  if (!context) {
    throw new Error('useUserSettings must be used within UserSettingProvider')
  }
  return context
}
