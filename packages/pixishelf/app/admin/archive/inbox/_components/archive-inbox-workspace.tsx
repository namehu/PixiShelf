'use client'

import { ArchiveIcon, UserSearchIcon } from 'lucide-react'
import { parseAsString, useQueryStates } from 'nuqs'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArchiveInbox } from './archive-inbox'
import { ArchiveUploaderSources } from './archive-uploader-sources'

const workspaceQueryParsers = {
  tab: parseAsString.withDefault('inbox').withOptions({ clearOnDefault: true }),
  sourceId: parseAsString,
  discoveryView: parseAsString,
  itemId: parseAsString
}

export function ArchiveInboxWorkspace() {
  const [query, setQuery] = useQueryStates(workspaceQueryParsers)
  const activeTab = query.itemId ? 'inbox' : query.tab === 'uploaders' ? 'uploaders' : 'inbox'
  const mobileDetail = activeTab === 'uploaders' && Boolean(query.sourceId || query.discoveryView === 'ignored')

  return (
    <Tabs
      value={activeTab}
      onValueChange={(value) => {
        if (value === 'uploaders') {
          void setQuery({ tab: 'uploaders', itemId: null, sourceId: null, discoveryView: null }, { history: 'push' })
        } else {
          void setQuery({ tab: null, sourceId: null, discoveryView: null }, { history: 'push' })
        }
      }}
      className="mx-auto max-w-7xl pt-4"
      data-mobile-discovery-detail={mobileDetail ? '' : undefined}
    >
      <TabsList aria-label="归档收件工作区" className={mobileDetail ? 'max-lg:hidden' : undefined}>
        <TabsTrigger value="inbox">
          <ArchiveIcon data-icon="inline-start" aria-hidden="true" />
          收件队列
        </TabsTrigger>
        <TabsTrigger value="uploaders">
          <UserSearchIcon data-icon="inline-start" aria-hidden="true" />
          发现来源
        </TabsTrigger>
      </TabsList>
      <TabsContent value="inbox">
        <ArchiveInbox />
      </TabsContent>
      <TabsContent value="uploaders" forceMount className="data-[state=inactive]:hidden">
        <ArchiveUploaderSources
          active={activeTab === 'uploaders'}
          locatedSourceId={query.sourceId}
          ignored={query.discoveryView === 'ignored'}
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
            void setQuery({ tab: null, sourceId: null, discoveryView: null, itemId }, { history: 'push' })
          }}
        />
      </TabsContent>
    </Tabs>
  )
}
