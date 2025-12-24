import PNav from '@/components/layout/PNav'
import React, { ReactNode } from 'react'

interface RootLayoutProps {
  children: React.ReactNode
}
/**
 * 根布局组件
 */
export default function RootLayout(props: RootLayoutProps) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* 导航栏 */}
      <PNav></PNav>
      {/* 主要内容 */}
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">{props.children}</main>
    </div>
  )
}
