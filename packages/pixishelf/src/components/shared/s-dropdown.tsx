'use client'

import React from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuGroup,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'

export type SDropdownMenuItemType = 'item' | 'divider' | 'group'

export interface SDropdownMenuItem {
  key: string | number
  label?: React.ReactNode
  icon?: React.ReactNode
  disabled?: boolean
  danger?: boolean
  onClick?: () => void
  type?: SDropdownMenuItemType
  /** 仅当 type 为 group 时有效 */
  children?: SDropdownMenuItem[]
  className?: string
  /** 是否隐藏该项 */
  hidden?: boolean
}

export interface SDropdownProps {
  children?: React.ReactNode
  menu?: {
    items: SDropdownMenuItem[]
    /** 全局点击事件 */
    onClick?: (key: string | number, item: SDropdownMenuItem) => void
  }
  /** 弹出位置对齐方式 */
  align?: 'start' | 'end' | 'center'
  /** 触发器自定义样式类 */
  className?: string
  /** 下拉内容自定义样式类 */
  contentClassName?: string
  /** 是否禁用 */
  disabled?: boolean
  /** 模态模式 (默认 false) */
  modal?: boolean
}

/**
 * SDropdown
 * 封装 shadcn/ui DropdownMenu，提供类似 Antd 的配置化接口
 */
export function SDropdown({
  children,
  menu,
  align = 'end',
  className,
  contentClassName,
  disabled,
  modal = false,
}: SDropdownProps) {
  const renderItem = (item: SDropdownMenuItem) => {
    if (item.hidden) return null

    if (item.type === 'divider') {
      return <DropdownMenuSeparator key={item.key} className={item.className} />
    }

    if (item.type === 'group') {
      return (
        <DropdownMenuGroup key={item.key}>
          {item.label && <DropdownMenuLabel>{item.label}</DropdownMenuLabel>}
          {item.children?.map(renderItem)}
        </DropdownMenuGroup>
      )
    }

    return (
      <DropdownMenuItem
        key={item.key}
        disabled={item.disabled}
        onClick={() => {
          item.onClick?.()
          menu?.onClick?.(item.key, item)
        }}
        className={cn(
          'cursor-pointer flex items-center gap-2',
          item.danger && 'text-red-600 focus:text-red-600 focus:bg-red-50',
          item.className
        )}
      >
        {item.icon && <span className="w-4 h-4 flex items-center justify-center">{item.icon}</span>}
        <span className="flex-1">{item.label}</span>
      </DropdownMenuItem>
    )
  }

  return (
    <DropdownMenu modal={modal}>
      <DropdownMenuTrigger asChild disabled={disabled} className={className}>
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={cn('min-w-[160px]', contentClassName)}>
        {menu?.items.map(renderItem)}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
