'use client'

import { ListVideoIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger
} from '@/components/ui/drawer'
import type { NormalizedChapter } from './video-chapters'
import ChapterSidebar from './ChapterSidebar'

interface ChapterDrawerProps {
  chapters: NormalizedChapter[]
  currentChapterId?: string
  onChapterClick: (chapter: NormalizedChapter) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
  showTrigger?: boolean
}

export default function ChapterDrawer({
  chapters,
  currentChapterId,
  onChapterClick,
  open,
  onOpenChange,
  showTrigger = true
}: ChapterDrawerProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const actualOpen = open ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  if (chapters.length === 0) {
    return null
  }

  return (
    <Drawer open={actualOpen} onOpenChange={setOpen}>
      {showTrigger && (
        <DrawerTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="h-8 rounded-full bg-black/55 px-3 text-white shadow-sm hover:bg-black/70"
          >
            <ListVideoIcon className="size-4" />
            章节
          </Button>
        </DrawerTrigger>
      )}

      <DrawerContent className="border-white/10 bg-neutral-950 text-white">
        <DrawerHeader className="pb-2 text-left">
          <DrawerTitle>章节</DrawerTitle>
          <DrawerDescription className="text-white/60">点击即可跳转到对应时间点</DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-4">
          <ChapterSidebar
            chapters={chapters}
            currentChapterId={currentChapterId}
            onChapterClick={(chapter) => {
              onChapterClick(chapter)
              setOpen(false)
            }}
            className="border-white/10 bg-transparent"
          />
        </div>
      </DrawerContent>
    </Drawer>
  )
}
