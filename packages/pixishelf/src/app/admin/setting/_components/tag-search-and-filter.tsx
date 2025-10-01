'use client'

import React from 'react'
import { Search, Filter, ArrowUpDown } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { TagManagementParams } from '@/types'

interface TagSearchAndFilterProps {
  searchTerm: string
  onSearchChange: (value: string) => void
  translationFilter: 'all' | 'translated' | 'untranslated'
  onTranslationFilterChange: (value: 'all' | 'translated' | 'untranslated') => void
  sortBy: TagManagementParams['sort']
  onSortByChange: (value: TagManagementParams['sort']) => void
  sortOrder: 'asc' | 'desc'
  onSortOrderChange: (value: 'asc' | 'desc') => void
}

/**
 * 标签搜索和筛选组件
 *
 * 功能：
 * - 搜索框、筛选器、排序选择器
 * - 处理搜索、筛选、排序的状态变化
 */
export function TagSearchAndFilter({
  searchTerm,
  onSearchChange,
  translationFilter,
  onTranslationFilterChange,
  sortBy,
  onSortByChange,
  sortOrder,
  onSortOrderChange
}: TagSearchAndFilterProps) {
  return (
    <div className="bg-white rounded-lg border border-neutral-200 p-6 mb-6">
      <div className="flex flex-col lg:flex-row gap-4">
        {/* 搜索框 */}
        <div className="flex-1">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-neutral-400 w-4 h-4" />
            <Input
              type="text"
              placeholder="搜索标签名称..."
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="pl-10 pr-4 py-2 w-full border border-neutral-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            />
          </div>
        </div>

        {/* 翻译状态筛选 */}
        <div className="w-full lg:w-48">
          <Select value={translationFilter} onValueChange={onTranslationFilterChange}>
            <SelectTrigger className="w-full">
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-neutral-400" />
                <SelectValue placeholder="翻译状态" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部标签</SelectItem>
              <SelectItem value="translated">已翻译</SelectItem>
              <SelectItem value="untranslated">未翻译</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 排序方式 */}
        <div className="w-full lg:w-48">
          <Select value={sortBy} onValueChange={(value: any) => onSortByChange(value)}>
            <SelectTrigger className="w-full">
              <div className="flex items-center gap-2">
                <ArrowUpDown className="w-4 h-4 text-neutral-400" />
                <SelectValue placeholder="排序方式" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">按名称</SelectItem>
              <SelectItem value="name_zh">按名称（中文）</SelectItem>
              <SelectItem value="name_en">按名称（英文）</SelectItem>
              <SelectItem value="artworkCount">按作品数量</SelectItem>
              <SelectItem value="createdAt">按创建时间</SelectItem>
              <SelectItem value="updatedAt">按更新时间</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* 排序顺序 */}
        <div className="w-full lg:w-32">
          <Select value={sortOrder} onValueChange={onSortOrderChange}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="顺序" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asc">升序</SelectItem>
              <SelectItem value="desc">降序</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
