'use client'

import React, { useState } from 'react'
import { CheckSquare, Square, Edit2, Save, X, Languages, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tag } from '@/types'

interface TagTableProps {
  tags: Tag[]
  selectedTags: Set<number>
  onTagSelect: (tagId: number) => void
  onTagUpdate: (tagId: number, updates: { name?: string; name_zh?: string }) => void
  onTagTranslate: (tagId: number) => void
  loading?: boolean
  translatingTags: Set<number>
}

/**
 * 标签列表表格组件
 *
 * 功能：
 * - 标签数据展示
 * - 内联编辑功能
 * - 单个标签操作（编辑、自动翻译）
 */
export function TagTable({
  tags,
  selectedTags,
  onTagSelect,
  onTagUpdate,
  onTagTranslate,
  loading = false,
  translatingTags
}: TagTableProps) {
  const [editingTag, setEditingTag] = useState<number | null>(null)
  const [editValues, setEditValues] = useState<{ name: string; name_zh: string }>({ name: '', name_zh: '' })

  const handleEditStart = (tag: Tag) => {
    setEditingTag(tag.id)
    setEditValues({
      name: tag.name,
      name_zh: tag.name_zh || ''
    })
  }

  const handleEditSave = () => {
    if (editingTag) {
      onTagUpdate(editingTag, editValues)
      setEditingTag(null)
    }
  }

  const handleEditCancel = () => {
    setEditingTag(null)
    setEditValues({ name: '', name_zh: '' })
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
        <div className="p-6">
          <div className="animate-pulse space-y-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-center space-x-4">
                <div className="w-4 h-4 bg-neutral-200 rounded"></div>
                <div className="flex-1 h-4 bg-neutral-200 rounded"></div>
                <div className="w-20 h-4 bg-neutral-200 rounded"></div>
                <div className="w-16 h-4 bg-neutral-200 rounded"></div>
                <div className="w-24 h-4 bg-neutral-200 rounded"></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (tags.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-neutral-200 p-12 text-center">
        <div className="text-neutral-400 mb-2">
          <svg className="w-12 h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-neutral-900 mb-2">暂无标签数据</h3>
        <p className="text-neutral-500">请检查筛选条件或等待数据加载</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr>
              <th className="w-12 px-6 py-3 text-left">
                <span className="sr-only">选择</span>
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                标签名称
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                中文翻译
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                作品数量
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                创建时间
              </th>
              <th className="px-6 py-3 text-left text-xs font-medium text-neutral-500 uppercase tracking-wider">
                操作
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-neutral-200">
            {tags.map((tag) => (
              <tr key={tag.id} className="hover:bg-neutral-50 transition-colors">
                <td className="px-6 py-4 whitespace-nowrap">
                  <button onClick={() => onTagSelect(tag.id)} className="text-neutral-400 hover:text-neutral-600">
                    {selectedTags.has(tag.id) ? (
                      <CheckSquare className="w-4 h-4 text-blue-600" />
                    ) : (
                      <Square className="w-4 h-4" />
                    )}
                  </button>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {editingTag === tag.id ? (
                    <Input
                      value={editValues.name}
                      onChange={(e) => setEditValues((prev) => ({ ...prev, name: e.target.value }))}
                      className="w-full"
                      autoFocus
                    />
                  ) : (
                    <div className="text-sm font-medium text-neutral-900">{tag.name}</div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  {editingTag === tag.id ? (
                    <Input
                      value={editValues.name_zh}
                      onChange={(e) => setEditValues((prev) => ({ ...prev, name_zh: e.target.value }))}
                      className="w-full"
                      placeholder="中文翻译"
                    />
                  ) : (
                    <div className="text-sm text-neutral-900">
                      {tag.name_zh || <span className="text-neutral-400 italic">未翻译</span>}
                    </div>
                  )}
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-neutral-900">{tag.artworkCount}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="text-sm text-neutral-500">{new Date(tag.createdAt).toLocaleDateString('zh-CN')}</div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center gap-2">
                    {editingTag === tag.id ? (
                      <>
                        <Button
                          size="sm"
                          onClick={handleEditSave}
                          className="bg-green-600 hover:bg-green-700 text-white"
                        >
                          <Save className="w-3 h-3" />
                        </Button>
                        <Button size="sm" variant="outline" onClick={handleEditCancel}>
                          <X className="w-3 h-3" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleEditStart(tag)}
                          className="text-neutral-600 hover:text-neutral-900"
                        >
                          <Edit2 className="w-3 h-3" />
                        </Button>
                        {!tag.name_zh && (
                          <Button
                            size="sm"
                            onClick={() => onTagTranslate(tag.id)}
                            disabled={translatingTags.has(tag.id)}
                            className="bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                          >
                            {translatingTags.has(tag.id) ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Languages className="w-3 h-3" />
                            )}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
