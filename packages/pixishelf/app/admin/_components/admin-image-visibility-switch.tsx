'use client'

import { useEffect } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAdminPreferencesStore } from '@/store/admin/use-admin-preferences-store'

type AdminImageVisibilityPreference = 'artist-images' | 'tag-covers'

interface AdminImageVisibilitySwitchProps {
  id: string
  label: string
  preference: AdminImageVisibilityPreference
}

export function AdminImageVisibilitySwitch({ id, label, preference }: AdminImageVisibilitySwitchProps) {
  const checked = useAdminPreferencesStore((state) =>
    preference === 'artist-images' ? state.showArtistImages : state.showTagCovers
  )
  const setChecked = useAdminPreferencesStore((state) =>
    preference === 'artist-images' ? state.setShowArtistImages : state.setShowTagCovers
  )

  useEffect(() => {
    void useAdminPreferencesStore.persist.rehydrate()
  }, [])

  return (
    <div className="flex items-center gap-2">
      <Switch id={id} checked={checked} onCheckedChange={setChecked} />
      <Label htmlFor={id} className="cursor-pointer">
        {label}
      </Label>
    </div>
  )
}
