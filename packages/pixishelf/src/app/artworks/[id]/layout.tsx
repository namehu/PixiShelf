import React from 'react'

interface RootLayoutProps {
  children: React.ReactNode
}

export default function RootLayout(props: RootLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-7xl mx-auto pt-16 lg:px-8">{props.children}</main>
    </div>
  )
}
