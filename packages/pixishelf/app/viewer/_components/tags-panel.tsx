'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger
} from '@/components/ui/drawer'
import { ScrollArea } from '@/components/ui/scroll-area'
import type { TRandomTagDto } from '@/schemas/tag.dto'
import { getTranslateName } from '@/utils/tags'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

interface TagsPanelProps {
  tags: TRandomTagDto[]
  trigger: ReactNode
}

export default function TagsPanel({ tags, trigger }: TagsPanelProps) {
  return (
    <Drawer>
      <DrawerTrigger asChild>{trigger}</DrawerTrigger>
      <DrawerContent className="max-h-[80dvh]">
        <DrawerHeader>
          <DrawerTitle>所有标签</DrawerTitle>
          <DrawerDescription>查看并打开当前作品的完整标签索引。</DrawerDescription>
        </DrawerHeader>

        <ScrollArea className="min-h-0 flex-1 px-4">
          <div className="flex flex-col gap-1 pb-4">
            {tags.length > 0 ? (
              tags.map((tag) => {
                const translatedName = getTranslateName(tag)

                return (
                  <DrawerClose key={tag.id} asChild>
                    <Link
                      href={`/tags/${tag.id}`}
                      className="flex min-h-12 flex-col justify-center rounded-md px-3 py-2 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
                    >
                      <PrivacySensitiveText className="text-sm font-medium text-foreground">
                        #{tag.name}
                      </PrivacySensitiveText>
                      {translatedName && (
                        <PrivacySensitiveText className="text-xs text-muted-foreground">
                          {translatedName}
                        </PrivacySensitiveText>
                      )}
                    </Link>
                  </DrawerClose>
                )
              })
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">暂无标签</p>
            )}
          </div>
        </ScrollArea>

        <DrawerFooter className="pb-[max(1rem,env(safe-area-inset-bottom))]">
          <DrawerClose asChild>
            <Button variant="outline">关闭</Button>
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
