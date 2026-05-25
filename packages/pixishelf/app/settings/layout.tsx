import React from 'react'
import PNav from '@/components/layout/PNav'
import { SettingsTabs } from './_components/settings-tabs'

interface SettingsLayoutProps {
  children: React.ReactNode
}

export default function SettingsLayout({ children }: SettingsLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50/60">
      <PNav showUserMenu={true}>
        <span className="text-lg font-semibold">个人设置</span>
      </PNav>
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
        <SettingsTabs />
        <main>{children}</main>
      </div>
    </div>
  )
}
