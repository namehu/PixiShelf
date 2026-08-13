import React from 'react'
import { PageContainer } from '@/components/layout/page-container'
import { PageHeader } from '@/components/layout/page-header'
import { SettingsTabs } from './_components/settings-tabs'

interface SettingsLayoutProps {
  children: React.ReactNode
}

export default function SettingsLayout({ children }: SettingsLayoutProps) {
  return (
    <div className="min-h-dvh bg-background">
      <PageContainer size="standard" className="flex flex-col gap-6 py-6 sm:py-8">
        <PageHeader title="设置" description="管理个人资料与 PixiShelf 的浏览偏好。" />
        <SettingsTabs />
        <main>{children}</main>
      </PageContainer>
    </div>
  )
}
