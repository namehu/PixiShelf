'use client'

import React, { useState } from 'react'
import { CheckSquare, Square, Edit2, Save, X, Languages } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tag } from '@/types'
import { getTranslateName } from '@/utils/tags'

interface TagTableProps {
  tags: Tag[]
  onTagUpdate: (tagId: number, updates: { name?: string; name_zh?: string }) => void
  loading?: boolean
}

/**
 * 标签列表表格组件
 */
export function TagTable({ tags, onTagUpdate, loading = false }: TagTableProps) {
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
        <div className="hidden md:block p-6">
          <div className="animate-pulse space-y-4">
            {Array.from({ length: 5 }).map((_, index) => (
              <div key={index} className="flex items-center space-x-4">
                <div className="w-4 h-4 bg-neutral-200 rounded" />
                <div className="flex-1 h-4 bg-neutral-200 rounded" />
                <div className="w-20 h-4 bg-neutral-200 rounded" />
                <div className="w-16 h-4 bg-neutral-200 rounded" />
                <div className="w-24 h-4 bg-neutral-200 rounded" />
              </div>
            ))}
          </div>
        </div>
        <div className="md:hidden p-4 space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="border rounded-lg p-4 space-y-3 animate-pulse">
              <div className="h-4 bg-neutral-200 rounded w-1/2" />
              <div className="h-4 bg-neutral-200 rounded w-3/4" />
              <div className="flex gap-2">
                <div className="h-4 bg-neutral-200 rounded w-1/4" />
                <div className="h-4 bg-neutral-200 rounded w-1/4" />
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (tags.length === 0) {
    return (
      <div className="bg-white rounded-lg border border-neutral-200 p-8 md:p-12 text-center">
        <div className="text-neutral-400 mb-2">
          <svg className="w-10 h-10 md:w-12 md:h-12 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z"
            />
          </svg>
        </div>
        <h3 className="text-base md:text-lg font-medium text-neutral-900 mb-2">暂无标签数据</h3>
        <p className="text-sm md:text-base text-neutral-500">请检查筛选条件或等待数据加载</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg border border-neutral-200 overflow-hidden">
      {/* Mobile Card View */}
      <div className="md:hidden divide-y divide-neutral-200">
        {tags.map((tag) => {
          const tName = getTranslateName(tag)
          const isEditing = editingTag === tag.id

          return (
            <div key={tag.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0 mr-2">
                  <div className="font-medium text-neutral-900 break-all w-full">
                    {isEditing ? (
                      <Input
                        value={editValues.name}
                        onChange={(e) => setEditValues((prev) => ({ ...prev, name: e.target.value }))}
                        className="h-8 text-sm"
                        placeholder="标签名称"
                      />
                    ) : (
                      tag.name
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {isEditing ? (
                    <>
                      <Button size="sm" onClick={handleEditSave} className="h-8 w-8 p-0 bg-green-600">
                        <Save className="w-4 h-4" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={handleEditCancel} className="h-8 w-8 p-0">
                        <X className="w-4 h-4" />
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => handleEditStart(tag)} className="h-8 w-8 p-0">
                      <Edit2 className="w-4 h-4 text-neutral-500" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="pl-8 space-y-2">
                <div className="text-sm">
                  <span className="text-neutral-500 mr-2 inline-block w-16">中文翻译:</span>
                  {isEditing ? (
                    <div className="mt-1">
                      <Input
                        value={editValues.name_zh}
                        onChange={(e) => setEditValues((prev) => ({ ...prev, name_zh: e.target.value }))}
                        className="h-8 text-sm"
                        placeholder="中文翻译"
                      />
                    </div>
                  ) : (
                    <span className={tName ? 'text-neutral-900' : 'text-neutral-400 italic'}>{tName || '未翻译'}</span>
                  )}
                </div>

                <div className="flex items-center justify-between text-xs text-neutral-500 pt-1 border-t border-neutral-100 mt-2">
                  <span>作品: {tag.artworkCount}</span>
                  <span>{new Date(tag.createdAt).toLocaleDateString('zh-CN')}</span>
                </div>

                {!tName && !isEditing && (
                  <div className="pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => onTagUpdate(tag.id, {})}
                      className="w-full h-8 text-xs text-blue-600 border-blue-200 hover:bg-blue-50"
                    >
                      <Languages className="w-3 h-3" />
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Desktop Table View */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead className="bg-neutral-50 border-b border-neutral-200">
            <tr>
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
            {tags.map((tag) => {
              const tName = getTranslateName(tag)

              return (
                <tr key={tag.id} className="hover:bg-neutral-50 transition-colors">
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
                        {tName || <span className="text-neutral-400 italic">未翻译</span>}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-neutral-900">{tag.artworkCount}</div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-sm text-neutral-500">
                      {new Date(tag.createdAt).toLocaleDateString('zh-CN')}
                    </div>
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
                          {!tName && (
                            <Button
                              size="sm"
                              onClick={() => onTagUpdate(tag.id, {})}
                              variant="outline"
                              className="text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            >
                              <Languages className="w-3 h-3" />
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
