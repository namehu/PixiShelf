import React from 'react'
import { Metadata } from 'next'
import { TagSquare } from '@/components/tags'

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
      <div className="container mx-auto px-4 py-8">
        <TagSquare
          pageSize={24}
          showSearch={true}
          showFilters={true}
          cardMode="compact"
          className="max-w-7xl mx-auto"
        />
      </div>
    </div>
  )
}
