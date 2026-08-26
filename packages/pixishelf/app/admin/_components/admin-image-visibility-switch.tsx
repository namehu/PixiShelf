'use client'

import { useEffect } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useAdminPreferencesStore } from '@/store/admin/use-admin-preferences-store'

type AdminImageVisibilityPreference = 'artist-images' | 'tag-covers' | 'artwork-pixiv-sync'

interface AdminImageVisibilitySwitchProps {
  id: string
  label: string
  preference: AdminImageVisibilityPreference
}

export function AdminImageVisibilitySwitch({ id, label, preference }: AdminImageVisibilitySwitchProps) {
  const checked = useAdminPreferencesStore((state) =>
    preference === 'artist-images'
      ? state.showArtistImages
      : preference === 'tag-covers'
        ? state.showTagCovers
        : state.showArtworkPixivSync
  )
  const setChecked = useAdminPreferencesStore((state) =>
    preference === 'artist-images'
      ? state.setShowArtistImages
      : preference === 'tag-covers'
        ? state.setShowTagCovers
        : state.setShowArtworkPixivSync
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
