import React from 'react'
import { Metadata } from 'next'
import TagExplorer from './_components/TagExplorer'

export const metadata: Metadata = {
  title: '标签广场 - PixiShelf',
  description: '浏览和搜索所有标签，发现更多精彩作品'
}

/**
 * 标签广场页面
 */
export default function TagsPage() {
  return <TagExplorer />
}
