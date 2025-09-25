import React from 'react'
import { Metadata } from 'next'
import PNav from '@/components/layout/PNav'
import TagSquare from './_components/TagSquare'

export const metadata: Metadata = {
  title: '标签广场 - PixiShelf',
  description: '浏览和搜索所有标签，发现更多精彩作品'
}

/**
 * 标签广场页面
 */
export default function TagsPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <PNav></PNav>
      <div className="container mx-auto px-4 py-8">
        <TagSquare pageSize={24} cardMode="compact" className="max-w-7xl mx-auto" />
      </div>
    </div>
  )
}
