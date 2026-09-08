'use client'

import { useState } from 'react'
import { PlayIcon, ArrowDownIcon, GalleryVerticalEndIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'

export function AutoBrowseEntry({ disabled, slideshowDisabled }: { disabled?: boolean; slideshowDisabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const artworkId = useArtworkAutoBrowseStore((state) => state.artworkId)
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) useArtworkAutoBrowseStore.getState().pause('overlay')
        setOpen(next)
      }}
    >
      <PopoverTrigger asChild>
        <Button variant="ghost" className="min-h-11" disabled={disabled || artworkId === null}>
          <PlayIcon data-icon="inline-start" />
          自动浏览
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-48 flex-col gap-1" data-auto-browse-controls>
        <Button
          variant="ghost"
          className="min-h-11 justify-start"
          onClick={() => {
            setOpen(false)
            useArtworkAutoBrowseStore.getState().start('scroll')
          }}
        >
          <ArrowDownIcon data-icon="inline-start" />
          自动滚动
        </Button>
        <Button
          variant="ghost"
          className="min-h-11 justify-start"
          disabled={slideshowDisabled}
          onClick={() => {
            setOpen(false)
            useArtworkAutoBrowseStore.getState().start('slideshow')
          }}
        >
          <GalleryVerticalEndIcon data-icon="inline-start" />
          自动轮播
        </Button>
      </PopoverContent>
    </Popover>
  )
}
