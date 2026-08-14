import React from 'react'
import { PageContainer } from '@/components/layout/page-container'
import { AdminNav } from './_components/admin-nav'
import { AdminMobileNavigation } from './_components/admin-mobile-navigation'

interface RootLayoutProps {
  children: React.ReactNode
}

/**
 * 管理后台根布局
 */
export default function RootLayout(props: RootLayoutProps) {
  return (
    <div className="min-h-dvh bg-background">
      <PageContainer size="workbench" className="flex items-start px-0 lg:px-8">
        <aside className="sticky top-16 hidden h-[calc(100dvh-4rem)] w-60 shrink-0 self-start overflow-y-auto border-r border-sidebar-border bg-sidebar lg:block">
          <AdminNav />
        </aside>
        <div className="min-w-0 flex-1">
          <AdminMobileNavigation />
          <main className="min-w-0">{props.children}</main>
        </div>
      </PageContainer>
    </div>
  )
}
