'use client'

import React, { useState, useEffect } from 'react'
import { Search, RotateCcw } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { STableColumn } from './types'

interface SSearchProps {
  columns: STableColumn[]
  onSearch: (values: Record<string, any>) => void
  onReset: () => void
  initialValues?: Record<string, any>
}

export function SSearch({ columns, onSearch, onReset, initialValues = {} }: SSearchProps) {
  const [values, setValues] = useState<Record<string, any>>(initialValues)

  const searchColumns = columns.filter((col) => !col.hideInSearch)

  if (searchColumns.length === 0) {
    return null
  }

  const handleValueChange = (key: string, value: any) => {
    setValues((prev) => {
      const next = { ...prev, [key]: value }
      return next
    })
  }

  const handleSearch = () => {
    onSearch(values)
  }

  const handleReset = () => {
    setValues({})
    onReset()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  return (
    <div className="bg-white rounded-lg border border-neutral-200 p-4 md:p-6 mb-4 md:mb-6">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {searchColumns.map((col) => {
          const key = col.searchKey || col.key || (col.dataIndex as string)
          const placeholder = col.searchPlaceholder || `请输入${col.title}`
          
          if (col.valueEnum) {
            const options = col.valueEnum instanceof Map 
              ? Array.from(col.valueEnum.entries()).map(([k, v]) => ({ value: k, label: v.text }))
              : Object.entries(col.valueEnum).map(([k, v]) => ({ value: k, label: v.text }))

            return (
              <div key={key} className="w-full">
                <Select
                  value={values[key]?.toString()}
                  onValueChange={(val) => handleValueChange(key, val)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder={col.title} />
                  </SelectTrigger>
                  <SelectContent>
                    {options.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )
          }

          return (
            <div key={key} className="w-full">
              <div className="relative">
                <Input
                  placeholder={placeholder}
                  value={values[key] || ''}
                  onChange={(e) => handleValueChange(key, e.target.value)}
                  onKeyDown={handleKeyDown}
                  className="w-full"
                />
              </div>
            </div>
          )
        })}

        {/* 按钮组 */}
        <div className="flex items-center gap-2 md:col-span-1 lg:col-span-1">
          <Button onClick={handleSearch} className="flex-1 md:flex-none">
            <Search className="w-4 h-4 mr-2" />
            查询
          </Button>
          <Button variant="outline" onClick={handleReset} className="flex-1 md:flex-none">
            <RotateCcw className="w-4 h-4 mr-2" />
            重置
          </Button>
        </div>
      </div>
    </div>
  )
}
