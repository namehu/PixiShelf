import React from 'react'

interface RootLayoutProps {
  children: React.ReactNode
}
/**
 * 根布局组件
 */
export default function RootLayout(props: RootLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      <main className="max-w-7xl mx-auto ">{props.children}</main>
    </div>
  )
}
