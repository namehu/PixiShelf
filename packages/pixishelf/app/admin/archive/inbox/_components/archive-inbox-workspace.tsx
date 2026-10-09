'use client'

import { ArchiveDeleteFailedResultProvider } from './archive-delete-failed-dialog'
import { ArchiveIcon, UserSearchIcon } from 'lucide-react'
import { parseAsString, useQueryStates } from 'nuqs'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AdminWorkbench } from '@/app/admin/_components/admin-workbench'
import { ArchiveInbox } from './archive-inbox'
import { ArchiveUploaderSources } from './archive-uploader-sources'

const workspaceQueryParsers = {
  tab: parseAsString.withDefault('uploaders').withOptions({ clearOnDefault: true }),
  sourceId: parseAsString,
  discoveryView: parseAsString,
  itemId: parseAsString
}

export function ArchiveInboxWorkspace() {
  const [query, setQuery] = useQueryStates(workspaceQueryParsers)
  const activeTab = query.itemId ? 'inbox' : query.tab === 'inbox' ? 'inbox' : 'uploaders'
  const discoveryDetail =
    activeTab === 'uploaders' &&
    Boolean(query.sourceId || query.discoveryView === 'ignored' || query.discoveryView === 'pending-creators')

  return (
    <ArchiveDeleteFailedResultProvider>
      <Tabs
        value={activeTab}
        onValueChange={(value) => {
          if (value === 'uploaders') {
            void setQuery({ tab: 'uploaders', itemId: null, sourceId: null, discoveryView: null }, { history: 'push' })
          } else {
            void setQuery({ tab: 'inbox', sourceId: null, discoveryView: null }, { history: 'push' })
          }
        }}
        className="w-full min-w-0"
        data-mobile-discovery-detail={discoveryDetail ? '' : undefined}
      >
        <AdminWorkbench
          title="归档收件箱"
          description="粘贴作品链接；解析、判断和归档会在后台继续进行。"
          eyebrow={null}
          className={
            discoveryDetail
              ? 'max-lg:pt-2 max-lg:[&>[data-slot=page-header]]:hidden'
              : '[&>[data-slot=page-header]]:sm:items-start'
          }
          actions={
            <TabsList aria-label="归档收件工作区" className={discoveryDetail ? 'hidden' : undefined}>
              <TabsTrigger value="uploaders">
                <UserSearchIcon data-icon="inline-start" aria-hidden="true" />
                发现来源
              </TabsTrigger>
              <TabsTrigger value="inbox">
                <ArchiveIcon data-icon="inline-start" aria-hidden="true" />
                收件队列
              </TabsTrigger>
            </TabsList>
          }
        >
          <TabsContent value="inbox" className="mx-auto w-full max-w-7xl">
            <ArchiveInbox />
          </TabsContent>
          <TabsContent value="uploaders" forceMount className="data-[state=inactive]:hidden">
            <ArchiveUploaderSources
              active={activeTab === 'uploaders'}
              locatedSourceId={query.sourceId}
              ignored={query.discoveryView === 'ignored'}
              pendingCreators={query.discoveryView === 'pending-creators'}
              onNavigatePendingCreators={() => {
                void setQuery(
                  { tab: 'uploaders', sourceId: null, discoveryView: 'pending-creators', itemId: null },
                  { history: 'push' }
                )
              }}
              onNavigateSource={(sourceId, history) => {
                void setQuery({ tab: 'uploaders', sourceId, discoveryView: null, itemId: null }, { history })
              }}
              onNavigateSourceList={(history) => {
                void setQuery({ tab: 'uploaders', sourceId: null, discoveryView: null, itemId: null }, { history })
              }}
              onNavigateIgnored={(ignored, history) => {
                void setQuery(
                  {
                    tab: 'uploaders',
                    sourceId: null,
                    discoveryView: ignored ? 'ignored' : null,
                    itemId: null
                  },
                  { history }
                )
              }}
              onNavigateInboxItem={(itemId) => {
                void setQuery({ tab: 'inbox', sourceId: null, discoveryView: null, itemId }, { history: 'push' })
              }}
            />
          </TabsContent>
        </AdminWorkbench>
      </Tabs>
    </ArchiveDeleteFailedResultProvider>
  )
}
