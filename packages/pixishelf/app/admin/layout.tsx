import React from 'react'
import { AdminNav } from './_components/admin-nav'

interface RootLayoutProps {
  children: React.ReactNode
}

/**
 * Admin Root Layout
 */
export default function RootLayout(props: RootLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="flex flex-1 w-full max-w-7xl mx-auto items-start">
        <aside className="hidden md:block w-36 flex-shrink-0 sticky top-16 self-start h-[calc(100vh-4rem)]">
          <AdminNav className="h-full border-r-0 bg-transparent" />
        </aside>
        <main className="flex-1 w-full min-w-0">{props.children}</main>
      </div>
    </div>
  )
}
