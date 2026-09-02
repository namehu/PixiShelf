'use client'

import { ArchiveIcon, UserSearchIcon } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArchiveInbox } from './archive-inbox'
import { ArchiveUploaderSources } from './archive-uploader-sources'

export function ArchiveInboxWorkspace() {
  return (
    <Tabs defaultValue="inbox" className="mx-auto max-w-7xl pt-4">
      <TabsList aria-label="归档收件工作区">
        <TabsTrigger value="inbox">
          <ArchiveIcon data-icon="inline-start" aria-hidden="true" />
          收件队列
        </TabsTrigger>
        <TabsTrigger value="uploaders">
          <UserSearchIcon data-icon="inline-start" aria-hidden="true" />
          上传者来源
        </TabsTrigger>
      </TabsList>
      <TabsContent value="inbox">
        <ArchiveInbox />
      </TabsContent>
      <TabsContent value="uploaders">
        <ArchiveUploaderSources />
      </TabsContent>
    </Tabs>
  )
}
